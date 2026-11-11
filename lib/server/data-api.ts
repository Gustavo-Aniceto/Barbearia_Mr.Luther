import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from './db';

// ---------------------------------------------------------------------------
// Camada de dados do servidor.
// * Tabelas, colunas e funções são validadas contra o catálogo do Postgres.
// * Valores SEMPRE vão como parâmetros ($1, $2…), com cast para o tipo da coluna.
// * A execução acontece como app_user (RLS) — a autorização final é do banco.
// * Funções: só as que app_user pode executar (internas têm EXECUTE revogado).
// ---------------------------------------------------------------------------

export class DataError extends Error { constructor(message: string, public status = 400, public code?: string) { super(message); } }

type Catalog = { tables: Map<string, Map<string, string>>; functions: Map<string, { retset: boolean; rettype: string; args: { name: string; type: string }[] }> };
let catalog: { at: number; value: Catalog } | undefined;

async function getCatalog(): Promise<Catalog> {
  if (catalog && Date.now() - catalog.at < 5 * 60_000) return catalog.value;
  const pool = getPool();
  const cols = await pool.query<{ table_name: string; column_name: string; data_type: string }>(`
    select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'`);
  const fns = await pool.query<{ name: string; retset: boolean; rettype: string; args: { name: string; type: string }[] }>(`
    select p.proname as name, p.proretset as retset, format_type(p.prorettype, null) as rettype,
      coalesce((select json_agg(json_build_object('name', x.n, 'type', format_type(x.t, null)) order by x.i)
        from unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) with ordinality as x(n, t, i)), '[]') as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('app_user', p.oid, 'EXECUTE')
      and p.prorettype <> 'trigger'::regtype`);
  const tables = new Map<string, Map<string, string>>();
  for (const r of cols.rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, new Map());
    tables.get(r.table_name)!.set(r.column_name, r.data_type);
  }
  const functions = new Map(fns.rows.map((f) => [f.name, f]));
  catalog = { at: Date.now(), value: { tables, functions } };
  return catalog.value;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const q = (s: string) => `"${s}"`;

class Params {
  values: unknown[] = [];
  add(v: unknown, type: string) {
    this.values.push(serialize(v, type));
    return `$${this.values.length}::${type}`;
  }
}
function serialize(v: unknown, type: string) {
  if (v === null || v === undefined) return null;
  if (type.endsWith('[]')) return Array.isArray(v) ? v : [v];
  if (type === 'jsonb' || type === 'json') return JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

function where(filters: [string, string][] = [], cols: Map<string, string>, p: Params) {
  const conds: string[] = [];
  for (const [col, raw] of filters) {
    const type = cols.get(col);
    if (!type) throw new DataError(`Coluna inválida: ${col}`);
    const dot = raw.indexOf('.');
    let op = raw.slice(0, dot), val = raw.slice(dot + 1), neg = false;
    if (op === 'not') { neg = true; const d = val.indexOf('.'); op = val.slice(0, d); val = val.slice(d + 1); }
    let c: string;
    if (OPS[op]) {
      const isLike = op.includes('like');
      c = `${q(col)}${isLike ? '::text' : ''} ${OPS[op]} ${p.add(isLike ? val.replace(/\*/g, '%') : val, isLike ? 'text' : type)}`;
    } else if (op === 'is') {
      if (!['null', 'true', 'false'].includes(val)) throw new DataError('Filtro inválido');
      c = `${q(col)} is ${val}`;
    } else if (op === 'in') {
      const list = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).filter(Boolean);
      if (!list.length || list.length > 500) throw new DataError('Lista inválida');
      c = `${q(col)} = any(${p.add(list, `${type}[]`)})`;
    } else throw new DataError(`Operador não suportado: ${op}`);
    conds.push(neg ? `not (${c})` : c);
  }
  return conds.length ? ` where ${conds.join(' and ')}` : '';
}

export type DataRequest =
  | { op: 'select'; table: string; filters?: [string, string][]; select?: string; order?: string; limit?: number; offset?: number }
  | { op: 'insert'; table: string; rows: Record<string, unknown>[] }
  | { op: 'update'; table: string; filters: [string, string][]; patch: Record<string, unknown> }
  | { op: 'delete'; table: string; filters: [string, string][] }
  | { op: 'rpc'; fn: string; args?: Record<string, unknown> };

export async function executeData(client: PoolClient, req: DataRequest): Promise<unknown> {
  const cat = await getCatalog();
  if (req.op === 'rpc') {
    if (!IDENT.test(req.fn)) throw new DataError('Função inválida');
    const fn = cat.functions.get(req.fn);
    if (!fn) throw new DataError('Função não encontrada ou não permitida', 404);
    const p = new Params();
    const args = req.args || {};
    for (const k of Object.keys(args)) if (!fn.args.some((a) => a.name === k)) throw new DataError(`Parâmetro inválido: ${k}`);
    const list = fn.args.filter((a) => Object.prototype.hasOwnProperty.call(args, a.name)).map((a) => `${q(a.name)} => ${p.add(args[a.name], a.type)}`).join(', ');
    const call = `public.${q(req.fn)}(${list})`;
    if (fn.retset) return (await client.query(`select coalesce(json_agg(t), '[]') as r from ${call} t`, p.values)).rows[0].r;
    if (fn.rettype === 'void') { await client.query(`select ${call}`, p.values); return null; }
    return (await client.query(`select to_json(${call}) as r`, p.values)).rows[0].r;
  }

  if (!IDENT.test(req.table)) throw new DataError('Tabela inválida');
  const cols = cat.tables.get(req.table);
  if (!cols) throw new DataError('Tabela não encontrada', 404);
  const p = new Params();

  if (req.op === 'select') {
    let sel = '*';
    if (req.select && req.select !== '*') {
      sel = req.select.split(',').map((c) => { const t = c.trim(); if (!cols.has(t)) throw new DataError(`Coluna inválida: ${t}`); return q(t); }).join(', ');
    }
    let sql = `select ${sel} from public.${q(req.table)}${where(req.filters, cols, p)}`;
    if (req.order) {
      sql += ' order by ' + req.order.split(',').map((o) => {
        const [c, dir, nulls] = o.split('.');
        if (!cols.has(c)) throw new DataError(`Coluna inválida: ${c}`);
        return `${q(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : ''}`;
      }).join(', ');
    }
    sql += ` limit ${Math.min(Math.max(Number(req.limit) || 1000, 1), 5000)}`;
    if (req.offset) sql += ` offset ${Math.max(Number(req.offset) | 0, 0)}`;
    return (await client.query(`select coalesce(json_agg(t), '[]') as r from (${sql}) t`, p.values)).rows[0].r;
  }

  if (req.op === 'insert') {
    if (!Array.isArray(req.rows) || !req.rows.length || req.rows.length > 200) throw new DataError('Registros inválidos');
    const keys = Object.keys(req.rows[0]);
    for (const k of keys) if (!cols.has(k)) throw new DataError(`Coluna inválida: ${k}`);
    const values = req.rows.map((r) => `(${keys.map((k) => (r[k] === undefined ? 'default' : p.add(r[k], cols.get(k)!))).join(', ')})`).join(', ');
    const sql = `insert into public.${q(req.table)} (${keys.map(q).join(', ')}) values ${values} returning *`;
    return (await client.query(`with ins as (${sql}) select coalesce(json_agg(ins), '[]') as r from ins`, p.values)).rows[0].r;
  }

  if (req.op === 'update') {
    const keys = Object.keys(req.patch || {});
    if (!keys.length) throw new DataError('Nada para atualizar');
    const sets = keys.map((k) => { if (!cols.has(k)) throw new DataError(`Coluna inválida: ${k}`); return `${q(k)} = ${p.add(req.patch[k], cols.get(k)!)}`; }).join(', ');
    const w = where(req.filters, cols, p);
    if (!w) throw new DataError('Atualização sem filtro não permitida');
    return (await client.query(`with up as (update public.${q(req.table)} set ${sets}${w} returning *) select coalesce(json_agg(up), '[]') as r from up`, p.values)).rows[0].r;
  }

  if (req.op === 'delete') {
    const w = where(req.filters, cols, p);
    if (!w) throw new DataError('Exclusão sem filtro não permitida');
    return (await client.query(`with del as (delete from public.${q(req.table)}${w} returning *) select coalesce(json_agg(del), '[]') as r from del`, p.values)).rows[0].r;
  }
  throw new DataError('Operação inválida');
}

/** Converte erros do Postgres em respostas claras sem vazar detalhes internos. */
export function toHttpError(e: unknown): { status: number; body: { message: string; code?: string } } {
  if (e instanceof DataError) return { status: e.status, body: { message: e.message, code: e.code } };
  const pg = e as { code?: string; message?: string };
  if (pg && typeof pg.code === 'string') {
    if (pg.code === '42501') return { status: 403, body: { message: /permission denied|row-level security/i.test(pg.message || '') ? 'Você não tem permissão para esta ação' : pg.message!, code: pg.code } };
    if (pg.code === 'P0001') return { status: 400, body: { message: pg.message!, code: pg.code } };
    if (pg.code === '23505') return { status: 409, body: { message: 'Já existe um registro com estes dados', code: pg.code } };
    if (pg.code === '23503') return { status: 409, body: { message: 'Este registro está em uso e não pode ser removido. Desative-o.', code: pg.code } };
    if (pg.code === '23P01') return { status: 409, body: { message: 'Este horário acabou de ser reservado. Escolha outro horário.', code: pg.code } };
    if (pg.code.startsWith('22') || pg.code.startsWith('23')) return { status: 400, body: { message: 'Dados inválidos. Confira os campos e tente de novo.', code: pg.code } };
  }
  console.error('[data-api]', e);
  return { status: 500, body: { message: 'Erro interno. Tente novamente em instantes.' } };
}
