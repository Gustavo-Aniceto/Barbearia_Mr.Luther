# Pagamentos online e assinaturas recorrentes

## Situação atual

- Pagamentos são **registrados manualmente** no balcão (dinheiro, Pix, cartão e formas configuráveis). Faturado, recebido e a receber ficam separados.
- Assinaturas nascem como "aguardando pagamento" e são ativadas quando o pagamento é registrado.
- A integração com gateway está **preparada**, mas não ativada:
  - `public.gateway_confirm_payment(...)`: confirma um pagamento vindo do gateway de forma idempotente (só o servidor pode chamar);
  - `app/api/webhooks/payments`: rota que recebe o webhook do Asaas ou do Mercado Pago e chama essa função;
  - `payment_settings`: provedor, ambiente e chave **pública**. Chaves secretas nunca vão para o banco nem para o navegador.

## Comparação (verificar tarifas atuais antes de contratar)

| | Asaas | Mercado Pago |
|---|---|---|
| Recorrência via API | Assinaturas com boleto, Pix ou cartão; gera as cobranças automaticamente | API de assinaturas (`/preapproval`), com ou sem plano associado |
| Cartão recusado | Cobrança automática no vencimento enquanto o cartão for válido | Novas tentativas automáticas (até 4, numa janela de 10 dias) |
| Pix recorrente | Pix Automático e Pix Recorrente documentados | Pix disponível nos meios de pagamento |
| Webhook | Eventos de cobrança/assinatura com token no header | Notificação com id; consultar o pagamento na API |
| Tarifas | Página de parceiros mostra valores por cobrança recebida (promocionais, variam por plano) | Consultar a página oficial de taxas |

**Recomendação inicial:** o **Asaas** encaixa melhor no modelo de planos mensais da barbearia, pois cobra por boleto, Pix ou cartão no mesmo fluxo de assinatura e tem lembretes automáticos de cobrança. O **Mercado Pago** é vantajoso se os clientes já usam a conta Mercado Pago. Decida após comparar as tarifas vigentes no contrato.

Fontes:
- Asaas — Assinaturas (API): https://docs.asaas.com/reference/assinaturas-1.md
- Asaas — FAQ Assinaturas: https://docs.asaas.com/docs/faq-assinaturas
- Mercado Pago — API de Assinaturas: https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview
- Mercado Pago — Assinaturas (visão geral): https://www.mercadopago.com.br/developers/pt/guides/online-payments/subscriptions/introduction

## Para ativar

1. Criar conta no provedor e obter as credenciais de **sandbox**.
2. Na Vercel, cadastrar `PAYMENT_PROVIDER=asaas` e `ASAAS_WEBHOOK_TOKEN` (ou `MERCADOPAGO_ACCESS_TOKEN`).
3. Cadastrar no painel do provedor a URL `https://<seu-dominio>/api/webhooks/payments`.
4. Implementar a rota `app/api/payments/charge`, que cria a cobrança/assinatura no provedor com `externalReference = transactions.id` e devolve o link de pagamento ao site. A Área do Cliente › Planos já indica onde o botão de pagar online entra.
5. Testar no sandbox: pagamento aprovado, recusado e webhook duplicado.
6. Em Configurações › Pagamentos online, escolher o provedor e ativar.

Nunca armazene número de cartão, CVV ou validade. O cartão é digitado no checkout do provedor.
