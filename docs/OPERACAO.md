# Operação: backups, monitoramento e recuperação

## Backups (duas camadas)
1. **Restore nativo do Neon (PITR):** o Neon permite restaurar o banco, ou criar um branch, a partir de qualquer ponto dentro da janela de histórico do plano. A janela é curta no plano Free e configurável nos pagos. Confira o valor atual no Console, em **Settings → Instant restore**.
2. **Backup diário automático (ativo):** a rotina diária do site (`/api/cron/renewals`, 06h UTC = 03h de Brasília)
   exporta os dados de todas as tabelas para `db/mrluder-AAAAMMDDTHHMM.json.gz` no bucket privado `mrluder-backups`
   (`lib/server/backup.ts`) e apaga cópias com mais de 30 dias. A estrutura está nas migrations.
   Se o backup falhar, a rotina responde 500 e o erro aparece nos logs da Vercel (Functions → `/api/cron/renewals`).
   As contas de login (senhas) ficam no Neon Auth e não entram no arquivo.
3. **Opcional, dump completo via GitHub Actions:** `.github/workflows/backup.yml` (pg_dump) continua disponível. Para usar, cadastre em
   GitHub → Settings → Secrets `BACKUP_DATABASE_URL` (conexão direta), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `BACKUP_BUCKET=mrluder-backups` e a variável `BACKUP_ENABLED=true`.

### Restaurar o backup diário
1. Neon Console → crie um branch novo a partir de `production` (ou um projeto novo).
2. `DATABASE_URL="<conexão direta do branch novo>" node scripts/migrate.mjs`
3. Baixe o arquivo do bucket `mrluder-backups` (Neon Console → Storage) e rode
   `DATABASE_URL="<mesma conexão>" node scripts/restore-backup.mjs mrluder-AAAAMMDDTHHMM.json.gz`
   (tudo numa transação: se falhar, nada muda).
4. Confira o site apontando um preview para o branch e, estando certo, troque `DATABASE_URL`/`DATABASE_URL_UNPOOLED` na Vercel.

As imagens do Object Storage acompanham os branches do Neon (copy-on-write). Excluir um objeto, porém, é definitivo: o sistema nunca apaga arquivos automaticamente.

## Estratégia de recuperação
| Situação | Ação |
|---|---|
| Erro de operação recente (registro apagado, alteração errada) | Neon Console → **Restore** → criar branch no ponto anterior, conferir e então restaurar ou copiar só os dados necessários |
| Corrupção ou perda total | Criar um branch novo, aplicar as migrations e restaurar o arquivo diário com `scripts/restore-backup.mjs` (acima). Depois, atualizar `DATABASE_URL` na Vercel |
| Deploy com defeito | Vercel → Deployments → **Instant Rollback** para o deploy anterior. Migrations são só aditivas, então o rollback de código é seguro |
| Credencial vazada | Neon: resetar a senha do papel e revogar a credencial de storage. Vercel: atualizar as variáveis e fazer redeploy. Trocar o `NEON_AUTH_COOKIE_SECRET` encerra todas as sessões |

**Objetivo:** perda máxima de dados (RPO) igual à janela de PITR ou 24 h pelo dump; tempo de recuperação (RTO) inferior a 1 h. Teste uma restauração a cada trimestre e registre o resultado.

## Monitoramento
- **Saúde:** `GET /api/health` responde 200 quando banco, storage e auth estão operacionais e 503 caso contrário, sem expor dados. Cadastre essa URL num monitor de uptime (Vercel, Better Stack, UptimeRobot) com alerta por e-mail ou WhatsApp.
- **Erros e logs:** Vercel → Observability / Logs, para erros de rota com stack trace no servidor. O navegador recebe só mensagens genéricas.
- **Banco:** Neon Console → Monitoring (conexões, CPU, armazenamento) e logs do Object Storage.
- **Auditoria de negócio:** painel `/admin/auditoria` (quem alterou o quê, com valores antes e depois).
- **Rotina diária:** o Vercel Cron chama `/api/cron/renewals` às 06:00 (Brasília) para processar vencimentos de planos.

## Migrations
- Arquivos `migrations/NNNN_descricao.sql`, aplicados em ordem pelo `scripts/migrate.mjs` no build, dentro de transação e com trava, e registrados em `app.schema_migrations` com checksum.
- **Nunca edite uma migration já aplicada.** O script recusa a alteração. Crie a próxima numeração.
- Teste antes num branch do Neon: `neon branches create --name teste-migration` e rode `DATABASE_URL=<branch> npm run migrate`.
