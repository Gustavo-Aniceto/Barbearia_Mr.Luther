# Configuração em produção (Neon + Vercel)

## Situação atual (provisionado em 11/11/2026)
- **Neon:** projeto `mrluder-barbearia` (`little-wind-00306751`), região `aws-us-east-1`, branch `production` (`br-icy-math-bbz9yvfx`), Postgres 18.
- **Auth:** Managed Better Auth habilitado, com e-mail e senha, verificação obrigatória por código (OTP), `localhost` bloqueado e domínio `https://mrluder-barbearia.vercel.app` liberado.
- **Object Storage:** buckets privados `mrluder-media` e `mrluder-backups`, mais a credencial `vercel-mrluder-barbearia` (storage:read/write).
- **Vercel:** projeto `mrluder-barbearia` ligado ao GitHub (`main` = produção), com todas as variáveis de Production cadastradas como *sensitive*.

O que ainda depende de você: **SMTP próprio** (hoje usa o remetente compartilhado do Neon, só para testes), **bootstrap do proprietário** (passo 4 abaixo) e, se quiser, os **segredos do backup** no GitHub (`docs/OPERACAO.md`).

As seções abaixo descrevem como refazer tudo do zero (outro ambiente ou recuperação).

## 1. Banco de dados (Neon Postgres)
1. Na Vercel: **mrluder-barbearia → Storage → Create Database → Neon**.
   - Região: **US East (N. Virginia) — aws-us-east-1**. Hoje o Object Storage do Neon está disponível em us-east-1, us-east-2, eu-central-1 e ap-southeast-1, e é preciso ter banco, auth e arquivos no mesmo projeto.
   - Conecte aos ambientes Production e Preview.
2. A integração cria `DATABASE_URL`, `DATABASE_URL_UNPOOLED` e afins no projeto.
3. No próximo deploy, o build roda `scripts/migrate.mjs`, que cria todas as tabelas, políticas RLS, funções e dados-base.

## 2. Autenticação (Managed Better Auth)
1. No **Neon Console**, abra o projeto criado → **Auth** → habilite.
2. Em **Settings → Better Auth**:
   - **Sign-up with Email**: ligado;
   - **Verify at Sign-up**: ligado, método **código (OTP)**. O site já tem a tela para digitar o código;
   - **Domínios confiáveis**: adicione `https://mrluder-barbearia.vercel.app` e o domínio próprio, quando houver;
   - **Email provider**: configure SMTP próprio antes de abrir para o público. O e-mail compartilhado do Neon é só para testes.
3. Copie a **Auth URL** para a variável `NEON_AUTH_BASE_URL` na Vercel. `NEON_AUTH_COOKIE_SECRET` e `CRON_SECRET` já foram gerados e cadastrados no projeto.

## 3. Arquivos (Neon Object Storage)
Pelo terminal, com a CLI do Neon autenticada (`npx neon@latest auth`):
```bash
neon buckets create mrluder-media              # privado (padrão)
neon buckets create mrluder-backups            # para o backup diário
neon credentials create --scope storage:read --scope storage:write
```
A resposta traz `token_id` e `s3_secret_access_key`. O segredo aparece **uma única vez**. Cadastre na Vercel:

| Variável | Valor |
|---|---|
| `AWS_ACCESS_KEY_ID` | `token_id` |
| `AWS_SECRET_ACCESS_KEY` | `s3_secret_access_key` |
| `AWS_ENDPOINT_URL_S3` | `s3_endpoint` do branch (Console → Object storage, ou API `.../branches/{id}/storage`) |
| `AWS_REGION` | `us-east-1` |

`STORAGE_BUCKET=mrluder-media` já está cadastrado.

## 4. Publicar e criar o proprietário
1. Na Vercel, faça **Redeploy** do último deploy, ou um push. As migrations rodam no build.
2. Abra `https://mrluder-barbearia.vercel.app/api/health`. Deve responder `"status": "ok"`.
3. Crie a conta do dono pelo site (`/cadastro`) e confirme o código recebido por e-mail.
4. No **Neon Console → SQL Editor**, rode uma única vez:
   ```sql
   select public.bootstrap_owner('email-do-dono@dominio.com');
   ```
5. Entre de novo: o painel `/admin` mostra o passo a passo inicial (horários, equipe, serviços).

## Desenvolvimento local
```bash
cp .env.example .env.local   # preencha com um branch de desenvolvimento do Neon
npm install
npm run migrate
npm run dev                  # http://localhost:3000
```
Use **um branch do Neon** para desenvolvimento (`neon branches create --name dev`), nunca o de produção.
