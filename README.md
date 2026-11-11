# MR.LUDER Barbearia

Site institucional, agendamento online, área do cliente, painel do barbeiro e painel administrativo completo da **MR.LUDER BARBEARIA** (Av. Emílio Ribas, 797 – Vila Tijuco, Guarulhos/SP).

**Stack:** Next.js 16 (App Router, TypeScript) · Neon PostgreSQL · Neon Managed Better Auth · Neon Object Storage · Vercel.

## Como está organizado
```
app/                 rotas do Next.js (servidor): auth, dados, upload, mídia, saúde, cron, webhooks
app/actions/         server actions de cadastro, login e logout
lib/server/          conexão com o banco (transação + RLS), auth, storage, API de dados
client/              interface (site, conta, painéis) — fala só com /app/api
migrations/          SQL versionado (aplicado no build por scripts/migrate.mjs)
tests/db/            testes de regras de negócio, RLS e concorrência
docs/                configuração, arquitetura, operação, LGPD, pagamentos
```

## Começar
- **Produção:** siga `docs/CONFIGURACAO.md`, que cobre conectar o Neon, habilitar o Auth, criar o bucket e criar o proprietário.
- **Local:** `cp .env.example .env.local`, `npm install`, `npm run migrate`, `npm run dev`.
- **Testes de banco:** `npm run test:db` (requer Postgres 16+ local): 79 verificações.

## Segurança em uma frase
O navegador não tem credencial nenhuma. Toda operação passa pelo servidor, que valida a sessão do Neon Auth e executa no banco como `app_user` com RLS. Agendamentos conflitantes são impossíveis por constraint, e finanças e estoque rodam em transações. Detalhes em `docs/ARQUITETURA.md`.

## Documentação
- `docs/CONFIGURACAO.md`: variáveis de ambiente e passo a passo Neon + Vercel
- `docs/ARQUITETURA.md`: modelo de segurança, identidade e preparação para múltiplas unidades
- `docs/OPERACAO.md`: backups, recuperação, monitoramento e migrations
- `docs/LGPD.md`: recursos de proteção de dados e pendências jurídicas
- `docs/PAGAMENTOS.md`: Asaas × Mercado Pago e como ativar
