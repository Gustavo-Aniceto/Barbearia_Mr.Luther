import 'server-only';

/** Lê uma variável de ambiente obrigatória do servidor. Nunca use NEXT_PUBLIC_ para segredos. */
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}. Veja .env.example e docs/CONFIGURACAO.md.`);
  return v;
}
