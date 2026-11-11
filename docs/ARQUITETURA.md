# Arquitetura

```
Navegador ──(cookie httpOnly do Neon Auth)──► Next.js 16 na Vercel (Node, região iad1)
                                               ├─ /api/auth/*        → Neon Managed Better Auth (proxy oficial)
                                               ├─ server actions     → cadastro, login e logout
                                               ├─ /api/data          → operações de dados validadas
                                               ├─ /api/upload        → Neon Object Storage (S3) + media_files
                                               ├─ /api/media/*       → entrega de imagens registradas
                                               ├─ /api/health        → monitoramento
                                               ├─ /api/cron/*        → rotinas agendadas (Vercel Cron)
                                               └─ /api/webhooks/*    → gateway de pagamento
                                                        │ pg (pool TCP + attachDatabasePool)
                                                        ▼
                                               Neon PostgreSQL
                                               ├─ schema neon_auth   (usuários e sessões, gerenciado pelo Neon)
                                               ├─ schema app         (identidade da transação, provisionamento, migrations)
                                               └─ schema public      (negócio, RLS em todas as tabelas)
```

## Segurança em camadas
1. **Sessão:** o Neon Auth emite um cookie httpOnly. O servidor valida a sessão com `auth.getSession()` em cada requisição; o navegador nunca recebe credenciais de banco, storage ou auth.
2. **Servidor:** `/api/data` aceita só tabelas, colunas, operadores e funções que existem no catálogo. Os valores vão sempre como parâmetros. Mutações exigem a mesma origem (proteção contra CSRF).
3. **Banco:** cada requisição roda numa transação com `SET LOCAL ROLE app_user` e `app.profile_id`. As políticas RLS e as funções `SECURITY DEFINER` checam papel × módulo × ação (`has_permission`). Funções internas (provisionamento, confirmação de pagamento, bootstrap, rotinas) têm EXECUTE revogado para `app_user`.
4. **Integridade:** a constraint de exclusão `appointments_no_overlap` (btree_gist) impede dois agendamentos sobrepostos no mesmo barbeiro, mesmo com requisições simultâneas. Pagamentos, pedidos, estoque e comissões ficam em transações únicas.

## Identidade
- `neon_auth.user.id` (Better Auth) → `profiles.auth_user_id`. O vínculo é criado por `app.ensure_profile()`, chamado pelo servidor após o cadastro ou no primeiro acesso, de forma idempotente.
- Não há chave estrangeira para o schema `neon_auth`, que é gerenciado pelo provedor. O vínculo é resolvido no servidor a partir da sessão.

## Preparado para crescer
- **Multiunidade:** a tabela `units` e a coluna `unit_id` (com padrão "matriz") já existem nas tabelas operacionais (barbeiros, serviços, agenda, produtos, pedidos, financeiro, planos). Para abrir uma filial, basta incluir a unidade e filtrar por `unit_id` nas telas e políticas, sem migrar dados.
- **Escala:** o pool usa conexões com PgBouncer do Neon e `attachDatabasePool` (Fluid compute). O Neon faz autoscaling de compute.
- **Branches:** cada branch do Neon tem banco, usuários e arquivos isolados, o que é útil para preview deployments e testes de migration.

## Testes
- `npm run test:db` (Postgres local 16+): 79 verificações de regras de negócio, RLS e concorrência, executadas exatamente como o servidor executa (`app_user` + `app.profile_id`).
