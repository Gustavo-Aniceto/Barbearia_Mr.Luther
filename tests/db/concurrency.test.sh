#!/usr/bin/env bash
# Dois clientes tentam reservar o MESMO horário simultaneamente.
# A sessão A reserva e segura a transação aberta; a sessão B tenta no meio do caminho.
# Esperado: B recebe "acabou de ser reservado" (constraint de exclusão), nunca dupla reserva.
# Pré-requisito: business_rules.test.sql executado (usuários e serviços de teste).
set -uo pipefail
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54322} -U postgres -d ${PGDATABASE:-mrluder_neon} -X -At -q"
SLOT="((now() at time zone 'America/Sao_Paulo')::date + 3 + time '09:00') at time zone 'America/Sao_Paulo'"
B1="(select id from barbers where display_name = 'Barbeiro Um')"
SVC="array[(select id from services where name = 'Serviço Teste A')]"

$P -c "update business_settings set booking_window_days = 30" >/dev/null

$P <<SQL > /tmp/sessA.out 2>&1 &
begin;
select test.login('cliente1@teste.local');
set local role app_user;
select book_appointment($SVC, $SLOT, $B1) is not null;
select pg_sleep(2);
commit;
SQL
sleep 0.7
$P <<SQL > /tmp/sessB.out 2>&1
select test.login('cliente2@teste.local');
set role app_user;
select book_appointment($SVC, $SLOT, $B1);
SQL
wait

COUNT=$($P -c "select count(*) from appointments where barber_id = $B1 and starts_at = $SLOT and status not in ('cancelado_cliente','cancelado_barbearia')")
if grep -qE "acabou de ser reservado|indisponível" /tmp/sessB.out && [ "$COUNT" = "1" ]; then
  echo "  ok - reserva simultânea do mesmo horário: apenas 1 confirmada, a outra recebe aviso claro"
else
  echo "  FALHOU - concorrência (registros: $COUNT)"; cat /tmp/sessA.out /tmp/sessB.out; exit 1
fi
