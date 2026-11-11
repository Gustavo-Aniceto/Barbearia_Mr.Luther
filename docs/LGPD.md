# LGPD — recursos implementados e pendências

> A plataforma oferece **apoio técnico e administrativo** à Lei nº 13.709/2018. A implementação sozinha **não garante conformidade jurídica**. As bases legais, os prazos de retenção, o encarregado (DPO) e os textos legais devem ser revisados pelos responsáveis da MR.LUDER com orientação jurídica.

## Implementado

- **Transparência:** Termos de Uso e Política de Privacidade versionados (`legal_documents`), com histórico de versões. Os textos iniciais são **modelos marcados para revisão**.
- **Consentimento:** aceite dos termos obrigatório no cadastro; marketing por e-mail e por WhatsApp são **opcionais e desmarcados**. Cada mudança gera um novo registro em `consent_records`, com data, versão e user-agent.
- **Direitos do titular:** canal público `/meus-dados` (cópia, correção, informações, portabilidade, exclusão/anonimização e revogação), com protocolo e prazo. O titular baixa a cópia em JSON (`export_my_data`). O painel LGPD acompanha cada solicitação.
- **Anonimização** (`anonymize_customer`): remove nome, contatos, observações e endereço, e mantém os registros financeiros e fiscais sem identificação.
- **Minimização:** só se coleta nome, e-mail e telefone; a data de nascimento é opcional. Depoimentos publicam apenas o primeiro nome e a inicial do sobrenome.
- **Segurança:** RLS em todas as tabelas; permissões verificadas no banco; senhas gerenciadas pelo Neon Managed Better Auth; credenciais de banco e storage somente no servidor (Vercel); auditoria das alterações administrativas (`audit_logs`, com valores antes e depois); sessão com expiração.

## A definir pelos responsáveis

1. **Retenção:** prazos para clientes inativos, notificações, logs de auditoria e solicitações. Sugestão técnica: agendar uma rotina (pg_cron) depois da definição jurídica.
2. **Encarregado/DPO** e e-mail de privacidade (Configurações › Estabelecimento).
3. **Região e transferência internacional:** o banco, o auth e os arquivos ficam no Neon em `aws-us-east-1` (EUA), e as funções na Vercel em `iad1`. O Object Storage do Neon ainda não está disponível em São Paulo. Isso é **transferência internacional de dados** (LGPD, arts. 33 a 36): registre a base legal e os subprocessadores (Neon, AWS, Vercel, provedor de e-mail e de pagamento) na política de privacidade.
4. **Backups:** restore nativo do Neon e dump diário criptografado em trânsito no Object Storage (veja `docs/OPERACAO.md`). Documente o teste de restauração.

## Processo de resposta a incidentes (modelo)

1. **Detectar e conter:** resetar a senha do papel do banco no Neon, revogar a credencial de storage, trocar `NEON_AUTH_COOKIE_SECRET` na Vercel (encerra as sessões) e bloquear os usuários envolvidos.
2. **Avaliar:** usar `audit_logs`, os logs da Vercel e os do Neon para levantar quais dados, quantos titulares e qual período foram afetados.
3. **Comunicar:** se houver risco ou dano relevante, comunicar a ANPD e os titulares no prazo e na forma da regulamentação vigente.
4. **Corrigir e registrar:** aplicar a correção, registrar a lição aprendida e revisar as políticas RLS afetadas.
