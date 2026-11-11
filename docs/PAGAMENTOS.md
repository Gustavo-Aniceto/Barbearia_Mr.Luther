# Pagamentos online (Asaas)

O cliente paga **planos mensais** e **pedidos da loja** pela fatura do Asaas, escolhendo **Pix, boleto ou cartão**.
O site confirma sozinho quando o pagamento entra. Pagamentos no balcão continuam funcionando como antes.

## Como funciona

| Etapa | O que acontece |
|---|---|
| Cliente contrata um plano | Plano fica "aguardando pagamento" e aparece o botão **Pagar online** (Área do cliente → Planos) |
| Primeiro pagamento online | O site cadastra o pagador no Asaas (pede o CPF uma única vez, que **não** fica guardado no site), cria a **assinatura recorrente** e abre a fatura |
| Pagamento confirmado | O Asaas avisa o site (webhook) → o lançamento é baixado, o plano fica **ativo** por 1 ciclo, a comissão/indicação é processada e o cliente recebe e-mail |
| Todo mês | O Asaas gera a nova fatura e envia ao cliente. Pagou → o plano renova. Venceu sem pagar → plano fica **inadimplente** (benefícios suspensos) até o pagamento |
| Cliente cancela no site | A renovação é desligada aqui e a assinatura é **removida no Asaas** (para de gerar faturas). Benefícios já pagos valem até o fim do período |
| Pedido da loja | Botão **Pagar online** em Área do cliente → Pedidos, enquanto o pedido aguarda pagamento. Pago → estoque baixa e o pedido segue |

Garantias:
- Cada pagamento do Asaas só é contado **uma vez**, mesmo se o aviso chegar repetido (`payment_transactions.gateway_reference`).
- O webhook só é aceito com o token secreto (`asaas-access-token`), conferido em tempo constante.
- Número de cartão, validade e CVV são digitados **somente na página do Asaas**.

Código: `lib/server/asaas.ts`, `app/api/payments/checkout`, `app/api/payments/setup`, `app/api/webhooks/payments`,
`lib/server/payments.ts` e a migration `0010_asaas.sql`.

## Configuração (uma vez)

1. **Conta Asaas** em asaas.com, aprovada (envio de documentos).
2. **Chave de API:** Asaas → menu do usuário → **Integrações → Chaves de API → Gerar chave**.
   Chaves `$aact_prod_…` cobram de verdade; `$aact_hmlg_…` são do ambiente de testes (sandbox.asaas.com). O site detecta o ambiente pela chave.
3. **Na Vercel** (projeto `mrluder-barbearia` → Settings → Environment Variables, Production):
   - `ASAAS_API_KEY` = a chave (marque **Sensitive**). Nunca envie a chave por chat, e-mail ou GitHub.
   - `PAYMENT_PROVIDER=asaas` e `ASAAS_WEBHOOK_TOKEN` (segredo aleatório de 32+ caracteres) — já configurados.
4. **Novo deploy** e registro do webhook: `POST /api/payments/setup` com `Authorization: Bearer <CRON_SECRET>`
   (cria o webhook no Asaas apontando para `/api/webhooks/payments`, com o token; pode repetir sem duplicar).
5. **Admin → Configurações → Pagamentos online:** provedor **Asaas**, ambiente, e ligar **Habilitar pagamentos online**.
6. **Teste:** contrate um plano com a sua conta, pague R$ via Pix e confira o plano ficar ativo.

## Tarifas

Conferir na conta Asaas (variam por plano e promoções). Referência pública em 11/2026: Pix e boleto R$ 1,99 por cobrança recebida;
cartão de crédito à vista R$ 0,49 + 2,99%; crédito do cartão liberado 32 dias após a confirmação (antecipação opcional).

Fontes:
- Asaas — autenticação e ambientes: https://docs.asaas.com/docs/autenticação
- Asaas — criar assinatura: https://docs.asaas.com/reference/criar-nova-assinatura
- Asaas — criar cobrança: https://docs.asaas.com/reference/criar-nova-cobranca
- Asaas — criar cliente: https://docs.asaas.com/reference/criar-novo-cliente
- Asaas — webhooks: https://docs.asaas.com/docs/criar-novo-webhook-pela-api e https://docs.asaas.com/docs/webhook-para-cobrancas
