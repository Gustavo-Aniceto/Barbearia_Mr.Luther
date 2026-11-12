'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { ORDER_STATUS, SUB_STATUS, WEEKDAYS, duration, fmtDate, fmtDateTime, money, useAuth, useLoad } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Icon, Input, Loading, Modal, MoneyInput, Pager, SearchBox, Select, Tabs, useConfirm, useTable, useToast } from '../lib/ui';
import { EntityModal, exportCsv, usePaymentMethods } from '../panel/Layout';
import { ExpiringPlansCard, FixedSlotsCard } from '../panel/FixedSlots';

// ------------------------------------------------------------------ Serviços
export function Services() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const svcs = useLoad(() => db.select('services', {}, { order: 'sort_order.asc' }));
  const cats = useLoad(() => db.select('service_categories', {}, { order: 'sort_order.asc' }));
  const barbers = useLoad(() => db.select('barbers', { active: true }, { order: 'sort_order.asc' }));
  const links = useLoad(() => db.select('barber_services'));
  const combos = useLoad(() => db.select('service_combo_items'));
  const [edit, setEdit] = useState<any>(null);
  const [cat, setCat] = useState<any>(null);
  const [linkFor, setLinkFor] = useState<any>(null);
  if (svcs.error) return <ErrorBox error={svcs.error} onRetry={svcs.reload} />;
  const catName = (id: string) => cats.data?.find((c: any) => c.id === id)?.name;
  return (
    <>
      <div className="toolbar"><span className="spacer" />
        {can('servicos.editar') && <Button variant="line" size="sm" onClick={() => setCat({ active: true, sort_order: 0 })}>Nova categoria</Button>}
        {can('servicos.criar') && <Button size="sm" onClick={() => setEdit({ active: true, bookable_online: true, extra_buffer_minutes: 0, sort_order: 0, is_combo: false })}>Novo serviço</Button>}
      </div>
      {cats.data && cats.data.length > 0 && <div className="toolbar">{cats.data.map((c: any) => <button key={c.id} className="chip" style={{ borderColor: 'var(--line)' }} onClick={() => can('servicos.editar') && setCat(c)}>{c.name}{!c.active && ' (inativa)'}</button>)}</div>}
      <section className="card">
        {svcs.loading ? <Loading /> : !svcs.data?.length ? <Empty title="Nenhum serviço cadastrado" text="Cadastre nome, preço e duração. O site e a agenda passam a exibir automaticamente." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Serviço</th><th className="num">Preço</th><th className="num">Duração</th><th>Profissionais</th><th>Agenda online</th><th /></tr></thead>
            <tbody>{svcs.data.map((s: any) => {
              const bl = (links.data || []).filter((l: any) => l.service_id === s.id);
              return (
                <tr key={s.id}><td><div className="cell-strong">{s.name}{s.is_combo && <> <Badge tone="info">Combo</Badge></>}{!s.active && <> <Badge>Inativo</Badge></>}</div><div className="cell-sub">{catName(s.category_id)}{s.is_combo && ` · inclui ${(combos.data || []).filter((c: any) => c.combo_id === s.id).map((c: any) => svcs.data!.find((x: any) => x.id === c.service_id)?.name).join(', ')}`}</div></td>
                  <td className="num">{s.price_is_minimum && <div className="cell-sub">a partir de</div>}{money(s.price)}</td><td className="num">{duration(s.duration_minutes)}{s.extra_buffer_minutes > 0 && <div className="cell-sub">+{s.extra_buffer_minutes} min intervalo</div>}</td>
                  <td>{bl.length ? bl.map((l: any) => barbers.data?.find((b: any) => b.id === l.barber_id)?.display_name).filter(Boolean).join(', ') : <span className="field-error">Nenhum vinculado</span>}</td>
                  <td>{s.bookable_online && s.active ? <Badge tone="ok">Sim</Badge> : <Badge>Não</Badge>}</td>
                  <td className="actions">{can('servicos.editar') && <><Button size="sm" variant="ghost" onClick={() => setLinkFor(s)}>Profissionais</Button><Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Editar</Button></>}</td></tr>
              );
            })}</tbody></table></div>
        )}
      </section>
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar serviço' : 'Novo serviço'} initial={{ ...(edit || {}), combo_items: (combos.data || []).filter((c: any) => c.combo_id === edit?.id).map((c: any) => c.service_id) }}
        fields={[
          { key: 'name', label: 'Nome', required: true }, { key: 'category_id', label: 'Categoria', type: 'select', options: (cats.data || []).map((c: any) => ({ value: c.id, label: c.name })) },
          { key: 'price', label: 'Preço', type: 'money', required: true, min: 0 }, { key: 'price_is_minimum', label: 'Preço "a partir de" (valor final definido no atendimento)', type: 'toggle' }, { key: 'duration_minutes', label: 'Duração (minutos)', type: 'number', required: true, min: 5, max: 480 },
          { key: 'extra_buffer_minutes', label: 'Intervalo adicional após (min)', type: 'number', min: 0, max: 120, hint: 'Tempo de preparo/limpeza bloqueado na agenda' },
          { key: 'sort_order', label: 'Ordem de exibição', type: 'number' },
          { key: 'description', label: 'Descrição', type: 'textarea' }, { key: 'photo_url', label: 'Fotografia (opcional)', type: 'image', folder: 'servicos' },
          { key: 'active', label: 'Ativo', type: 'toggle' }, { key: 'bookable_online', label: 'Disponível para agendamento online', type: 'toggle' }, { key: 'is_combo', label: 'É um combo de serviços', type: 'toggle' },
        ]}
        extra={(v, set) => v.is_combo && (
          <div className="span-2"><span className="field-label">Serviços incluídos no combo</span>
            <div className="toolbar" style={{ marginTop: 6 }}>{(svcs.data || []).filter((s: any) => !s.is_combo && s.id !== edit?.id).map((s: any) => (
              <label key={s.id} className="check"><input type="checkbox" checked={(v.combo_items || []).includes(s.id)} onChange={(e) => set('combo_items', e.target.checked ? [...(v.combo_items || []), s.id] : v.combo_items.filter((x: string) => x !== s.id))} />{s.name}</label>
            ))}</div></div>
        )}
        danger={edit?.id && can('servicos.excluir') ? <Button variant="ghost" onClick={async () => {
          if (!(await confirm({ title: 'Excluir serviço?', text: 'Se o serviço já foi usado em atendimentos, ele não pode ser excluído; desative-o.', danger: true, confirm: 'Excluir' }))) return;
          try { await db.remove('services', { id: edit.id }); toast.ok('Serviço excluído'); setEdit(null); svcs.reload(); } catch (e) { toast.error((e as Error).message); }
        }}>Excluir</Button> : undefined}
        onSave={async (v) => {
          const row = { name: v.name, category_id: v.category_id || null, price: v.price, price_is_minimum: !!v.price_is_minimum, duration_minutes: v.duration_minutes, extra_buffer_minutes: v.extra_buffer_minutes ?? 0, sort_order: v.sort_order ?? 0,
            description: v.description || null, photo_url: v.photo_url || null, active: !!v.active, bookable_online: !!v.bookable_online, is_combo: !!v.is_combo };
          const saved = edit.id ? (await db.update('services', { id: edit.id }, row))[0] : await db.insert('services', row);
          if (edit.id) await db.remove('service_combo_items', { combo_id: saved.id }).catch(() => {});
          if (v.is_combo && v.combo_items?.length) await db.insert('service_combo_items', v.combo_items.map((s: string) => ({ combo_id: saved.id, service_id: s })));
          toast.ok('Serviço salvo'); svcs.reload(); combos.reload();
          if (!edit.id) setTimeout(() => setLinkFor(saved), 50);
        }} />
      <EntityModal open={!!cat} onClose={() => setCat(null)} title={cat?.id ? 'Editar categoria' : 'Nova categoria'} initial={cat || {}}
        fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'sort_order', label: 'Ordem', type: 'number' }, { key: 'active', label: 'Ativa', type: 'toggle' }]}
        onSave={async (v) => { const row = { name: v.name, sort_order: v.sort_order ?? 0, active: !!v.active }; cat.id ? await db.update('service_categories', { id: cat.id }, row) : await db.insert('service_categories', row); cats.reload(); }} />
      {linkFor && <LinkBarbers service={linkFor} barbers={barbers.data || []} links={(links.data || []).filter((l: any) => l.service_id === linkFor.id)} onClose={() => setLinkFor(null)} onSaved={links.reload} />}
    </>
  );
}

function LinkBarbers({ service, barbers, links, onClose, onSaved }: { service: any; barbers: any[]; links: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<Record<string, { on: boolean; type: string; value: string }>>(() => Object.fromEntries(barbers.map((b) => {
    const l = links.find((x) => x.barber_id === b.id);
    return [b.id, { on: !!l, type: l?.commission_type || '', value: l?.commission_value ?? '' }];
  })));
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Quem realiza: ${service.name}`} footer={<Button loading={busy} onClick={async () => {
      setBusy(true);
      try {
        await db.remove('barber_services', { service_id: service.id }).catch(() => {});
        const rows = Object.entries(state).filter(([, s]) => s.on).map(([bid, s]) => ({ barber_id: bid, service_id: service.id, commission_type: s.type || null, commission_value: s.type ? Number(s.value || 0) : null }));
        if (rows.length) await db.insert('barber_services', rows);
        toast.ok('Profissionais vinculados'); onSaved(); onClose();
      } catch (e) { toast.error((e as Error).message); }
      setBusy(false);
    }}>Salvar</Button>}>
      {barbers.length === 0 ? <Empty title="Cadastre barbeiros primeiro" /> : (
        <ul className="list-plain">{barbers.map((b) => { const s = state[b.id]; return (
          <li key={b.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 110px', gap: 10 }}>
            <label className="check"><input type="checkbox" checked={s.on} onChange={(e) => setState({ ...state, [b.id]: { ...s, on: e.target.checked } })} /><span>{b.display_name}<br /><span className="cell-sub">padrão: {b.commission_type === 'percentual' ? `${Number(b.commission_value)}%` : money(b.commission_value)}</span></span></label>
            <Select aria-label="Comissão específica" disabled={!s.on} value={s.type} onChange={(e) => setState({ ...state, [b.id]: { ...s, type: e.target.value } })}><option value="">Usar padrão</option><option value="percentual">% específico</option><option value="fixo">R$ fixo</option></Select>
            <Input aria-label="Valor da comissão" type="number" min={0} disabled={!s.on || !s.type} value={s.value} onChange={(e) => setState({ ...state, [b.id]: { ...s, value: e.target.value } })} />
          </li>); })}</ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Produtos e estoque
export function Products() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'produtos' | 'movimentos'>('produtos');
  const prods = useLoad(() => db.select('products', {}, { order: 'name.asc' }));
  const cats = useLoad(() => db.select('product_categories', {}, { order: 'name.asc' }));
  const moves = useLoad(() => db.select('inventory_movements', {}, { order: 'created_at.desc', limit: 300 }), [tab]);
  const [edit, setEdit] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [newCat, setNewCat] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const t = useTable((prods.data || []).filter((p: any) => !onlyLow || (p.track_stock && p.stock <= p.min_stock)), { search: (p: any) => `${p.name} ${p.sku || ''}`, initialSort: 'name' });
  const low = (prods.data || []).filter((p: any) => p.active && p.track_stock && p.stock <= p.min_stock);
  if (prods.error) return <ErrorBox error={prods.error} onRetry={prods.reload} />;
  return (
    <>
      {low.length > 0 && <div className="notice warn"><Icon name="box" /><span><strong>{low.length} produto(s) com estoque baixo:</strong> {low.map((p: any) => `${p.name} (${p.stock})`).join(', ')}</span></div>}
      <Tabs tabs={[{ id: 'produtos', label: 'Produtos', count: prods.data?.length }, { id: 'movimentos', label: 'Movimentações' }]} value={tab} onChange={setTab} />
      {tab === 'produtos' ? (<>
        <div className="toolbar"><SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar por nome ou SKU" /><label className="check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />Só estoque baixo</label><span className="spacer" />
          {can('produtos.exportar') && <Button size="sm" variant="line" onClick={() => exportCsv('produtos', (prods.data || []).map((p: any) => ({ nome: p.name, sku: p.sku, preco: p.price, custo: p.cost, estoque: p.stock, minimo: p.min_stock, ativo: p.active })))}>Exportar CSV</Button>}
          {can('produtos.editar') && <Button size="sm" variant="line" onClick={() => setNewCat(true)}>Nova categoria</Button>}
          {can('produtos.criar') && <Button size="sm" onClick={() => setEdit({ active: true, track_stock: true, stock: 0, min_stock: 0 })}>Novo produto</Button>}</div>
        <section className="card">
          {prods.loading ? <Loading /> : t.total === 0 ? <Empty title="Nenhum produto" text="Cadastre os produtos para vender no site e no balcão." /> : (<>
            <div className="table-wrap"><table className="table"><thead><tr><th />{t.th('name', 'Produto')}{t.th('price', 'Preço')}{t.th('cost', 'Custo')}<th className="num">Margem</th>{t.th('stock', 'Estoque')}<th>Status</th><th /></tr></thead>
              <tbody>{t.rows.map((p: any) => (
                <tr key={p.id}><td>{p.photo_url ? <img className="thumb" src={p.photo_url} alt="" /> : <span className="thumb" style={{ display: 'block' }} />}</td>
                  <td><div className="cell-strong">{p.name}</div><div className="cell-sub">{p.sku}{p.category_id && ` · ${cats.data?.find((c: any) => c.id === p.category_id)?.name}`}</div></td>
                  <td className="num">{money(p.price)}</td><td className="num">{p.cost != null ? money(p.cost) : '–'}</td>
                  <td className="num">{p.cost != null && Number(p.price) > 0 ? `${Math.round(((p.price - p.cost) / p.price) * 100)}%` : '–'}</td>
                  <td className="num">{p.track_stock ? <span className={p.stock <= p.min_stock ? 'field-error' : ''}>{p.stock}</span> : 'não controla'}</td>
                  <td><Badge tone={p.active ? 'ok' : 'muted'}>{p.active ? 'À venda' : 'Pausado'}</Badge></td>
                  <td className="actions">{can('produtos.editar') && <>{p.track_stock && <Button size="sm" variant="ghost" onClick={() => setMove(p)}>Estoque</Button>}<Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Editar</Button></>}</td></tr>
              ))}</tbody></table></div>
            <Pager page={t.page} pageSize={t.size} total={t.total} onPage={t.setPage} /></>)}
        </section>
      </>) : (
        <section className="card">
          {moves.loading ? <Loading /> : !moves.data?.length ? <Empty title="Sem movimentações" /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th className="num">Qtd.</th><th>Motivo</th></tr></thead>
              <tbody>{moves.data.map((m: any) => <tr key={m.id}><td>{fmtDateTime(m.created_at)}</td><td>{prods.data?.find((p: any) => p.id === m.product_id)?.name}</td><td><Badge tone={m.quantity > 0 ? 'ok' : 'warn'}>{m.kind}</Badge></td><td className="num">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td><td className="cell-sub">{m.reason}</td></tr>)}</tbody></table></div>
          )}
        </section>
      )}
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar produto' : 'Novo produto'} initial={edit || {}}
        fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'sku', label: 'Código / SKU' },
          { key: 'category_id', label: 'Categoria', type: 'select', options: (cats.data || []).map((c: any) => ({ value: c.id, label: c.name })) },
          { key: 'price', label: 'Preço de venda', type: 'money', required: true, min: 0 }, { key: 'cost', label: 'Custo de aquisição', type: 'money', min: 0 },
          ...(edit?.id ? [] : [{ key: 'stock', label: 'Estoque inicial', type: 'number' as const, min: 0 }]), { key: 'min_stock', label: 'Estoque mínimo (alerta)', type: 'number', min: 0 },
          { key: 'description', label: 'Descrição', type: 'textarea' }, { key: 'photo_url', label: 'Fotografia', type: 'image', folder: 'produtos' },
          { key: 'active', label: 'À venda', type: 'toggle' }, { key: 'track_stock', label: 'Controlar estoque', type: 'toggle' }]}
        danger={edit?.id && can('produtos.excluir') ? <Button variant="ghost" onClick={async () => {
          if (!(await confirm({ title: 'Excluir produto?', text: 'Produtos com vendas ou movimentações não podem ser excluídos; pause a venda.', danger: true, confirm: 'Excluir' }))) return;
          try { await db.remove('products', { id: edit.id }); setEdit(null); prods.reload(); } catch (e) { toast.error((e as Error).message); }
        }}>Excluir</Button> : undefined}
        onSave={async (v) => {
          const row: any = { name: v.name, sku: v.sku, category_id: v.category_id || null, price: v.price, cost: v.cost, min_stock: v.min_stock ?? 0, description: v.description, photo_url: v.photo_url, active: !!v.active, track_stock: !!v.track_stock };
          if (edit.id) await db.update('products', { id: edit.id }, row);
          else { const p = await db.insert('products', { ...row, stock: 0 }); if (Number(v.stock) > 0) await db.rpc('record_inventory', { p_product: p.id, p_kind: 'entrada', p_quantity: Number(v.stock), p_reason: 'Estoque inicial', p_unit_cost: v.cost }); }
          toast.ok('Produto salvo'); prods.reload();
        }} />
      <EntityModal open={!!move} onClose={() => setMove(null)} title={`Estoque: ${move?.name || ''}`} initial={{ kind: 'entrada' }}
        fields={[{ key: 'kind', label: 'Movimento', type: 'select', required: true, options: [{ value: 'entrada', label: 'Entrada (compra)' }, { value: 'saida', label: 'Saída (uso interno, perda)' }, { value: 'ajuste', label: 'Ajuste de inventário (+/−)' }] },
          { key: 'quantity', label: 'Quantidade', type: 'number', required: true, hint: `Atual: ${move?.stock}. No ajuste, use negativo para reduzir.` }, { key: 'unit_cost', label: 'Custo unitário (entradas)', type: 'money' }, { key: 'reason', label: 'Motivo', span: true }]}
        onSave={async (v) => { await db.rpc('record_inventory', { p_product: move.id, p_kind: v.kind, p_quantity: Math.trunc(v.quantity), p_reason: v.reason, p_unit_cost: v.unit_cost }); toast.ok('Estoque atualizado'); prods.reload(); moves.reload(); }} />
      <EntityModal open={newCat} onClose={() => setNewCat(false)} title="Nova categoria de produto" initial={{}} fields={[{ key: 'name', label: 'Nome', required: true }]}
        onSave={async (v) => { await db.insert('product_categories', { name: v.name }); cats.reload(); }} />
    </>
  );
}

// ------------------------------------------------------------------ Pedidos
export function Orders() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const pms = usePaymentMethods();
  const [status, setStatus] = useState('');
  const orders = useLoad(() => db.select('orders', status ? { status } : {}, { order: 'created_at.desc', limit: 300 }), [status]);
  const items = useLoad(async () => { const ids = (orders.data || []).map((o: any) => o.id); return ids.length ? db.select('order_items', { order_id: `in.(${ids.join(',')})` }) : []; }, [orders.data]);
  const customers = useLoad(() => db.select('customers', {}, { select: 'id,full_name,phone', limit: 5000 }));
  const [pay, setPay] = useState<any>(null);
  const [pos, setPos] = useState(false);
  const cname = (id: string) => customers.data?.find((c: any) => c.id === id)?.full_name || '—';
  const next: Record<string, string[]> = { pago: ['em_separacao', 'pronto_retirada', 'enviado'], em_separacao: ['pronto_retirada', 'enviado'], pronto_retirada: ['entregue'], enviado: ['entregue'] };
  return (
    <>
      <div className="toolbar">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Status"><option value="">Todos</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <span className="spacer" />
        {can('pedidos.criar') && <Button size="sm" onClick={() => setPos(true)}>Venda no balcão</Button>}
      </div>
      <section className="card">
        {orders.loading ? <Loading /> : !orders.data?.length ? <Empty title="Nenhum pedido" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
            <tbody>{orders.data.map((o: any) => (
              <tr key={o.id}><td><div className="cell-strong">#{o.code}</div><div className="cell-sub">{fmtDateTime(o.created_at)} · {o.fulfillment}</div></td><td>{cname(o.customer_id)}</td>
                <td className="cell-sub">{(items.data || []).filter((i: any) => i.order_id === o.id).map((i: any) => `${i.quantity}× ${i.product_name}`).join(', ')}</td>
                <td className="num">{money(o.total)}{Number(o.discount) > 0 && <div className="cell-sub">−{money(o.discount)}</div>}</td>
                <td><Badge tone={o.status === 'cancelado' ? 'muted' : o.status === 'aguardando_pagamento' ? 'warn' : o.status === 'entregue' ? 'done' : 'ok'}>{ORDER_STATUS[o.status]}</Badge></td>
                <td className="actions">{can('pedidos.editar') && <>
                  {o.status === 'aguardando_pagamento' && <Button size="sm" onClick={() => setPay(o)}>Receber</Button>}
                  {(next[o.status] || []).filter((s) => (o.fulfillment === 'retirada' ? s !== 'enviado' : s !== 'pronto_retirada')).map((s) => <Button key={s} size="sm" variant="ghost" onClick={async () => { try { await db.rpc('update_order_status', { p_order: o.id, p_status: s }); orders.reload(); } catch (e) { toast.error((e as Error).message); } }}>{ORDER_STATUS[s]}</Button>)}
                  {!['cancelado', 'entregue'].includes(o.status) && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Cancelar pedido?', text: o.status === 'aguardando_pagamento' ? 'A cobrança pendente será cancelada.' : 'O estoque será devolvido e a receita precisa ser estornada ao cliente.', danger: true, confirm: 'Cancelar pedido' })) { try { await db.rpc('update_order_status', { p_order: o.id, p_status: 'cancelado' }); orders.reload(); } catch (e) { toast.error((e as Error).message); } } }}>Cancelar</Button>}
                </>}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>
      {pay && <ReceiveModal title={`Receber pedido #${pay.code} · ${money(pay.total)}`} pms={pms} onClose={() => setPay(null)} onConfirm={async (pm) => { await db.rpc('receive_payment', { p_ref_type: 'pedido', p_ref_id: pay.id, p_payment_method_id: pm }); toast.ok('Pagamento registrado; estoque atualizado'); orders.reload(); }} />}
      {pos && <PosSale onClose={() => setPos(false)} onDone={() => { setPos(false); orders.reload(); }} customers={customers.data || []} />}
    </>
  );
}

export function ReceiveModal({ title, pms, onClose, onConfirm }: { title: string; pms: any[]; onClose: () => void; onConfirm: (pm: string) => Promise<void> }) {
  const [pm, setPm] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  return (
    <Modal open onClose={onClose} title={title} footer={<Button disabled={!pm} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(pm); onClose(); } catch (e) { toast.error((e as Error).message); } setBusy(false); }}>Confirmar recebimento</Button>}>
      <Field label="Forma de pagamento"><Select value={pm} onChange={(e) => setPm(e.target.value)}><option value="">Selecione</option>{pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <p className="cell-sub">Registre somente pagamentos efetivamente recebidos. Nenhum dado de cartão é armazenado.</p>
    </Modal>
  );
}

function PosSale({ onClose, onDone, customers }: { onClose: () => void; onDone: () => void; customers: any[] }) {
  const toast = useToast();
  const pms = usePaymentMethods();
  const prods = useLoad(() => db.select('products', { active: true }, { order: 'name.asc' }));
  const barbers = useLoad(() => db.select('barbers', { active: true }));
  const [cust, setCust] = useState(''); const [cart, setCart] = useState<Record<string, number>>({}); const [pm, setPm] = useState(''); const [barber, setBarber] = useState(''); const [busy, setBusy] = useState(false);
  const total = Object.entries(cart).reduce((a, [id, q]) => a + q * Number(prods.data?.find((p: any) => p.id === id)?.price || 0), 0);
  return (
    <Modal open onClose={onClose} title="Venda no balcão" wide footer={<><strong style={{ marginRight: 'auto' }}>Total {money(total)}</strong><Button loading={busy} disabled={!cust || !pm || total === 0} onClick={async () => {
      setBusy(true);
      try {
        const id = await db.rpc<string>('place_order', { p_items: Object.entries(cart).filter(([, q]) => q > 0).map(([product_id, quantity]) => ({ product_id, quantity })), p_customer_id: cust, p_sold_by_barber: barber || null });
        await db.rpc('receive_payment', { p_ref_type: 'pedido', p_ref_id: id, p_payment_method_id: pm });
        await db.rpc('update_order_status', { p_order: id, p_status: 'entregue' });
        toast.ok('Venda registrada'); onDone();
      } catch (e) { toast.error((e as Error).message); }
      setBusy(false);
    }}>Registrar venda paga</Button></>}>
      <div className="form-grid">
        <Field label="Cliente"><Select value={cust} onChange={(e) => setCust(e.target.value)}><option value="">Selecione</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Select></Field>
        <Field label="Forma de pagamento"><Select value={pm} onChange={(e) => setPm(e.target.value)}><option value="">Selecione</option>{pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Vendido por (comissão)" hint="Opcional"><Select value={barber} onChange={(e) => setBarber(e.target.value)}><option value="">Ninguém</option>{(barbers.data || []).map((b: any) => <option key={b.id} value={b.id}>{b.display_name}</option>)}</Select></Field>
      </div>
      {prods.loading ? <Loading /> : <ul className="list-plain">{(prods.data || []).map((p: any) => <li key={p.id}><span>{p.name} <span className="cell-sub">{money(p.price)} · {p.track_stock ? `${p.stock} em estoque` : ''}</span></span>
        <span className="qty"><button onClick={() => setCart({ ...cart, [p.id]: Math.max(0, (cart[p.id] || 0) - 1) })} aria-label="Menos">−</button><span>{cart[p.id] || 0}</span><button onClick={() => setCart({ ...cart, [p.id]: (cart[p.id] || 0) + 1 })} disabled={p.track_stock && (cart[p.id] || 0) >= p.stock} aria-label="Mais">+</button></span></li>)}</ul>}
    </Modal>
  );
}

// ------------------------------------------------------------------ Planos e assinaturas
export function Plans() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const pms = usePaymentMethods();
  const [tab, setTab] = useState<'planos' | 'assinaturas' | 'fixos'>('planos');
  const plans = useLoad(() => db.select('plans', {}, { order: 'sort_order.asc' }));
  const benefits = useLoad(() => db.select('plan_benefits'));
  const services = useLoad(() => db.select('services', { active: true }));
  const subs = useLoad(() => db.select('subscriptions', {}, { order: 'created_at.desc', limit: 500 }), [tab]);
  const customers = useLoad(() => db.select('customers', {}, { select: 'id,full_name,phone', limit: 5000 }));
  const [edit, setEdit] = useState<any>(null);
  const [ben, setBen] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const [subStatus, setSubStatus] = useState('');
  return (
    <>
      <Tabs tabs={[{ id: 'planos', label: 'Planos', count: plans.data?.length }, { id: 'assinaturas', label: 'Assinaturas', count: subs.data?.filter((s: any) => s.status === 'ativa').length }, { id: 'fixos', label: 'Horários fixos' }]} value={tab} onChange={setTab} />
      {tab === 'fixos' ? <><FixedSlotsCard showBarber /><ExpiringPlansCard /></> : tab === 'planos' ? (
        <>
          <div className="toolbar"><div className="notice" style={{ flex: 1 }}><Icon name="wallet" /><span>Cobrança recorrente automática usa o Asaas quando o pagamento online está ligado (Configurações › Pagamentos). Com ele desligado, a assinatura é ativada quando você registra o pagamento recebido na barbearia.</span></div>
            {can('planos.criar') && <Button size="sm" onClick={() => setEdit({ active: true, period_months: '1', product_discount_percent: 0, sort_order: 0 })}>Novo plano</Button>}</div>
          {!plans.data?.length ? <section className="card"><Empty title="Nenhum plano criado" text="Crie planos com serviços incluídos, quantidade por período, descontos e regras." /></section> : plans.data.map((p: any) => (
            <section className="card" key={p.id}>
              <div className="card-head"><h2>{p.name} · {money(p.price)}/{p.period_months === 1 ? 'mês' : `${p.period_months} meses`} {!p.active && <Badge>Inativo</Badge>}</h2>
                {can('planos.editar') && <span><Button size="sm" variant="ghost" onClick={() => setBen({ plan_id: p.id })}>Adicionar benefício</Button><Button size="sm" variant="line" onClick={() => setEdit({ ...p, period_months: String(p.period_months) })}>Editar plano</Button></span>}</div>
              <ul className="list-plain">{(benefits.data || []).filter((b: any) => b.plan_id === p.id).map((b: any) => (
                <li key={b.id}><span>{b.description}{b.service_id && <span className="cell-sub"> · {services.data?.find((s: any) => s.id === b.service_id)?.name} · {b.quantity_per_period ? `${b.quantity_per_period}× por período` : 'ilimitado'}</span>}</span>
                  {can('planos.editar') && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Remover benefício?', text: 'Assinantes deixam de ter este benefício.', danger: true, confirm: 'Remover' })) { try { await db.remove('plan_benefits', { id: b.id }); benefits.reload(); } catch (e) { toast.error((e as Error).message); } } }}>Remover</Button>}</li>
              ))}</ul>
              {Number(p.product_discount_percent) > 0 && <p className="cell-sub">{Number(p.product_discount_percent)}% de desconto em produtos · {p.max_active_subscriptions ? `limite de ${p.max_active_subscriptions} assinantes` : 'sem limite de assinantes'}</p>}
            </section>
          ))}
        </>
      ) : (
        <section className="card">
          <div className="card-head"><Select value={subStatus} onChange={(e) => setSubStatus(e.target.value)} style={{ width: 'auto' }}><option value="">Todos os status</option>{Object.entries(SUB_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          {subs.loading ? <Loading /> : !subs.data?.length ? <Empty title="Nenhuma assinatura" /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Plano</th><th>Status</th><th>Vigência</th><th /></tr></thead>
              <tbody>{subs.data.filter((s: any) => !subStatus || s.status === subStatus).map((s: any) => (
                <tr key={s.id}><td>{customers.data?.find((c: any) => c.id === s.customer_id)?.full_name}</td><td>{plans.data?.find((p: any) => p.id === s.plan_id)?.name}</td>
                  <td><Badge tone={s.status === 'ativa' ? 'ok' : ['pendente', 'inadimplente'].includes(s.status) ? 'warn' : 'muted'}>{SUB_STATUS[s.status]}</Badge>{!s.auto_renew && s.status === 'ativa' && <div className="cell-sub">não renova</div>}</td>
                  <td>{s.current_period_end ? `até ${fmtDate(s.current_period_end)}` : '–'}</td>
                  <td className="actions">{can('planos.editar') && <>
                    {['pendente', 'inadimplente'].includes(s.status) && <Button size="sm" onClick={() => setPay(s)}>Receber</Button>}
                    {s.status === 'ativa' && <Button size="sm" variant="ghost" onClick={() => db.rpc('set_subscription_status', { p_sub: s.id, p_status: 'suspensa' }).then(subs.reload, (e) => toast.error(e.message))}>Suspender</Button>}
                    {s.status === 'suspensa' && <Button size="sm" variant="ghost" onClick={() => db.rpc('set_subscription_status', { p_sub: s.id, p_status: 'ativa' }).then(subs.reload, (e) => toast.error(e.message))}>Reativar</Button>}
                    {!['cancelada', 'expirada'].includes(s.status) && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Cancelar assinatura?', text: 'Cobranças pendentes serão canceladas e os benefícios encerrados.', danger: true, confirm: 'Cancelar assinatura' })) db.rpc('set_subscription_status', { p_sub: s.id, p_status: 'cancelada' }).then(subs.reload, (e) => toast.error(e.message)); }}>Cancelar</Button>}
                  </>}</td></tr>
              ))}</tbody></table></div>
          )}
        </section>
      )}
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar plano' : 'Novo plano'} initial={edit || {}}
        fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'price', label: 'Valor por período', type: 'money', required: true, min: 0 },
          { key: 'period_months', label: 'Periodicidade', type: 'select', required: true, options: [{ value: '1', label: 'Mensal' }, { value: '3', label: 'Trimestral' }, { value: '6', label: 'Semestral' }, { value: '12', label: 'Anual' }] },
          { key: 'product_discount_percent', label: 'Desconto em produtos (%)', type: 'number', min: 0, max: 100 }, { key: 'max_active_subscriptions', label: 'Limite de assinantes', type: 'number', min: 1, hint: 'Vazio = sem limite' },
          { key: 'sort_order', label: 'Ordem', type: 'number' }, { key: 'description', label: 'Descrição', type: 'textarea' }, { key: 'usage_rules', label: 'Regras de utilização', type: 'textarea' },
          { key: 'max_per_week', label: 'Limite por semana', type: 'number', min: 1, max: 14, hint: 'Ex.: 1 = um atendimento por semana. Vazio = sem limite' },
          { key: 'contract_conditions', label: 'Condições de contratação', type: 'textarea' }, { key: 'active', label: 'Ativo (visível no site)', type: 'toggle' }]}
        extra={(v, set) => <WeekdayPicker value={v.allowed_weekdays} onChange={(d) => set('allowed_weekdays', d)} />}
        onSave={async (v) => { const wd: number[] | null = v.allowed_weekdays && v.allowed_weekdays.length && v.allowed_weekdays.length < 7 ? v.allowed_weekdays : null;
          const row = { name: v.name, price: v.price, period_months: Number(v.period_months), product_discount_percent: v.product_discount_percent ?? 0, max_active_subscriptions: v.max_active_subscriptions, sort_order: v.sort_order ?? 0, description: v.description, usage_rules: v.usage_rules, contract_conditions: v.contract_conditions, active: !!v.active, allowed_weekdays: wd, max_per_week: v.max_per_week ?? null };
          edit.id ? await db.update('plans', { id: edit.id }, row) : await db.insert('plans', row); toast.ok('Plano salvo'); plans.reload(); }} />
      <EntityModal open={!!ben} onClose={() => setBen(null)} title="Benefício do plano" initial={ben || {}}
        fields={[{ key: 'service_id', label: 'Serviço incluído', type: 'select', options: (services.data || []).map((s: any) => ({ value: s.id, label: s.name })), hint: 'Deixe vazio para benefício apenas descritivo' },
          { key: 'quantity_per_period', label: 'Quantidade por período', type: 'number', min: 1, hint: 'Vazio = ilimitado' }, { key: 'description', label: 'Descrição exibida', required: true, span: true, placeholder: 'Ex.: 2 cortes por mês' }]}
        onSave={async (v) => { await db.insert('plan_benefits', { plan_id: ben.plan_id, service_id: v.service_id || null, quantity_per_period: v.quantity_per_period, description: v.description }); benefits.reload(); }} />
      {pay && <ReceiveModal title="Receber assinatura" pms={pms} onClose={() => setPay(null)} onConfirm={async (pm) => { await db.rpc('receive_payment', { p_ref_type: 'assinatura', p_ref_id: pay.id, p_payment_method_id: pm }); toast.ok('Assinatura ativa'); subs.reload(); }} />}
    </>
  );
}

/** Dias da semana em que o plano pode ser usado (nenhum marcado = todos os dias). */
function WeekdayPicker({ value, onChange }: { value: number[] | null | undefined; onChange: (d: number[]) => void }) {
  const sel = value && value.length ? value : [0, 1, 2, 3, 4, 5, 6];
  return (
    <fieldset className="weekday-picker">
      <legend>Dias em que o plano vale</legend>
      <div>{WEEKDAYS.map((w, i) => (
        <label key={i} className="chip-check"><input type="checkbox" checked={sel.includes(i)}
          onChange={(e) => onChange((e.target.checked ? [...sel, i] : sel.filter((x) => x !== i)).sort((a, b) => a - b))} />{w.slice(0, 3)}</label>
      ))}</div>
      <small className="muted">Ex.: segunda a quinta para planos com preço menor. Todos marcados = vale qualquer dia.</small>
    </fieldset>
  );
}
