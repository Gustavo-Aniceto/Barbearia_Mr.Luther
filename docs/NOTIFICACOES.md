# Avisos ao cliente (e-mail e SMS)

O cliente recebe avisos com **data, horário, profissional, serviços, valor, código, endereço** e links para a
área do cliente e para o WhatsApp da barbearia.

| Evento | Quando | Aviso interno | E-mail | SMS |
|---|---|---|---|---|
| Agendamento realizado | cliente ou equipe marca um horário | sim | sim | sim |
| Agendamento confirmado | equipe confirma | sim | sim | — |
| Lembrete | véspera, na rotina diária (06h de Brasília) | sim | sim | sim |
| Reagendamento / cancelamento | qualquer lado altera | sim | sim | sim |
| Plano contratado / ativo / vencendo | assinatura e pagamento | sim | sim | — |
| Pedido realizado / pago | loja | sim | sim | — |

Cada evento pode ser ligado ou desligado em **Admin → Configurações → Notificações**.
Avisos de agendamento, plano e pedido são transacionais: saem mesmo para quem não aceitou novidades e ofertas.

## Como funciona

1. As funções do banco gravam o aviso em `notification_logs` (um registro por canal).
2. Logo após a ação (agendar, cancelar, confirmar, contratar…) o servidor envia a fila em segundo plano
   (`lib/server/notify.ts`), sem atrasar a resposta. A rotina diária (`/api/cron/renewals`) cria os lembretes e reenvia o que ficou pendente.
3. Status: `aguardando_integracao` → `enviando` → `enviada` (com o id do Brevo) ou `falhou` (com o motivo).
   Até 5 tentativas; erros de dados (e-mail ou celular inválido) falham na hora. Avisos com mais de 48 h expiram.
4. Sem provedor configurado nada é enviado nem marcado como enviado.

## Configurar o Brevo (uma vez)

1. Crie a conta em brevo.com (o plano gratuito envia até 300 e-mails por dia).
2. **Remetente:** em *Senders, Domains & Dedicated IPs → Senders*, cadastre o e-mail que vai aparecer como remetente e confirme o código.
   O ideal é um e-mail de domínio próprio (ex.: contato@mrluder.com.br) autenticado em *Domains*. Com Gmail/Hotmail funciona,
   mas a entrega é pior e pode cair no spam.
3. **Chave:** em *SMTP & API → API Keys*, gere uma chave.
4. **SMS (opcional, pago):** compre créditos de SMS no Brevo. Cada SMS de até 160 caracteres consome 1 crédito; os textos já saem sem acentos.
5. Na Vercel (projeto `mrluder-barbearia` → Settings → Environment Variables, ambiente Production):
   - `BREVO_API_KEY` = a chave (marque **Sensitive**)
   - `NOTIFY_EMAIL_FROM` = o e-mail verificado
   - `NOTIFY_SMS_SENDER` = `MRLUDER` (só se for usar SMS)
   - opcionais: `NOTIFY_EMAIL_NAME`, `NOTIFY_REPLY_TO`
6. Faça um novo deploy (Deployments → Redeploy). Para testar, faça um agendamento com a sua conta.

Nunca coloque a chave no código, no GitHub ou no chat.
