'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/api';
import { Link, money, duration, fmtTime, fmtLongDate, isoDay, addDays, useAuth, useQuery, navigate, whatsappLink, WEEKDAYS } from '../lib/core';
import { Button, Icon, Loading, Empty, ErrorBox, Field, Textarea, useToast } from '../lib/ui';
import { SiteLayout } from './Home';
import { useSite } from './data';

type Slot = { barber_id: string; barber_name: string; starts_at: string };
const STEPS = ['Serviços', 'Profissional', 'Data e horário', 'Confirmação'];

export function Booking() {
  const { site, error, reload } = useSite();
  const { session } = useAuth();
  const q = useQuery();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>(() => (q.get('servicos') || q.get('servico') || '').split(',').filter(Boolean));
  const [barber, setBarber] = useState<string>(q.get('barbeiro') || '');
  const [step, setStep] = useState(() => (q.get('inicio') ? 3 : selected.length ? (q.get('barbeiro') ? 2 : 1) : 0));
  const [day, setDay] = useState<string>(q.get('dia') || '');
  const [slot, setSlot] = useState<Slot | null>(q.get('inicio') ? { starts_at: q.get('inicio')!, barber_id: q.get('b') || '', barber_name: q.get('bn') || '' } : null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsErr, setSlotsErr] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [usePlan, setUsePlan] = useState(false);
  const [subs, setSubs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; code?: string } | null>(null);

  useEffect(() => { if (session) db.rpc<any[]>('my_subscriptions').then((s) => setSubs(s.filter((x) => x.status === 'ativa'))).catch(() => {}); }, [session]);

  const services = site?.services.filter((s) => s.bookable_online && s.barber_ids.length) || [];
  const chosen = services.filter((s) => selected.includes(s.id));
  const total = chosen.reduce((a, s) => a + Number(s.price), 0);
  const minutes = chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const eligibleBarbers = (site?.barbers || []).filter((b) => b.accepts_online_booking && chosen.every((s) => b.service_ids.includes(s.id)));
  const planCovers = subs.some((s) => s.benefits.some((b: any) => selected.includes(b.service_id) && (b.quantity == null || b.used < b.quantity)));

  const days = useMemo(() => {
    if (!site) return [];
    const n = Math.min(Number(site.settings.booking_window_days) || 30, 45);
    const start = isoDay();
    return Array.from({ length: n }, (_, i) => addDays(start, i)).map((d) => {
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      return { d, wd, open: !!site.hours.find((h) => h.weekday === wd && h.is_open) };
    });
  }, [site]);

  useEffect(() => {
    if (step !== 2 || !day || !selected.length) return;
    setSlots(null); setSlotsErr(null);
    db.rpc<Slot[]>('get_available_slots', { p_date: day, p_service_ids: selected, p_barber_id: barber || null })
      .then(setSlots).catch((e) => setSlotsErr(e.message));
  }, [step, day, barber, selected.join(',')]);

  useEffect(() => { if (step === 2 && !day) { const first = days.find((x) => x.open); if (first) setDay(first.d); } }, [step, days]);

  if (error) return <SiteLayout><div className="wrap page"><ErrorBox error={error} onRetry={reload} /></div></SiteLayout>;
  if (!site) return <SiteLayout><Loading /></SiteLayout>;

  const uniqueSlots = slots ? Object.values(slots.reduce<Record<string, Slot>>((acc, s) => { acc[s.starts_at] ||= s; return acc; }, {})) : null;
  const toggle = (id: string) => { setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); setSlot(null); };
  const resumeUrl = () => `/agendar?servicos=${selected.join(',')}${barber ? `&barbeiro=${barber}` : ''}${slot ? `&inicio=${encodeURIComponent(slot.starts_at)}&b=${slot.barber_id}&bn=${encodeURIComponent(slot.barber_name)}&dia=${day}` : ''}`;

  async function confirm() {
    if (!session) { navigate(`/entrar?voltar=${encodeURIComponent(resumeUrl())}`); return; }
    setBusy(true);
    try {
      const id = await db.rpc<string>('book_appointment', {
        p_service_ids: selected, p_starts_at: slot!.starts_at, p_barber_id: barber || slot!.barber_id || null,
        p_customer_notes: notes || null, p_use_subscription: usePlan && planCovers,
      });
      const mine = await db.rpc<any[]>('my_appointments');
      setDone({ id, code: mine.find((a) => a.id === id)?.code });
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast.error((e as Error).message);
      if (/horário|disponível/i.test((e as Error).message)) { setSlot(null); setStep(2); }
    }
    setBusy(false);
  }

  if (done) {
    const s = site.settings;
    return (
      <SiteLayout>
        <div className="wrap page">
          <div className="panel confirmation">
            <div className="seal"><Icon name="check" size={28} /></div>
            <h1 className="page-title">Horário reservado</h1>
            <p className="page-lead" style={{ margin: 0 }}>
              {fmtLongDate(slot!.starts_at)}, às {fmtTime(slot!.starts_at)}, com {slot!.barber_name || eligibleBarbers.find((b) => b.id === barber)?.name}.
              {done.code && <> Código <strong>#{done.code}</strong>.</>}
            </p>
            <p className="muted">Você acompanha o status, reagenda ou cancela pela sua conta. Cancelamentos online até {s.cancel_min_hours}h antes.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link to="/conta" className="btn btn-primary btn-md">Ver meus agendamentos</Link>
              {s.whatsapp && <a className="btn btn-line btn-md" target="_blank" rel="noreferrer"
                href={whatsappLink(s.whatsapp, `Olá! Acabei de agendar pelo site: ${chosen.map((c) => c.name).join(' + ')} em ${fmtLongDate(slot!.starts_at)} às ${fmtTime(slot!.starts_at)}${done.code ? ` (código #${done.code})` : ''}.`)}>Avisar pelo WhatsApp</a>}
            </div>
          </div>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="wrap page">
        <h1 className="page-title">Agendar horário</h1>
        <p className="page-lead">Só mostramos horários realmente livres, já considerando a duração dos serviços e a agenda de cada profissional.</p>
        <ol className="steps" aria-label="Etapas do agendamento">
          {STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>{s}</li>)}
        </ol>
        <div className="booking">
          <div>
            {step === 0 && (
              services.length === 0 ? (
                <Empty title="Agenda online em preparação" text="Ainda não há serviços disponíveis para reserva online. Fale com a barbearia pelo WhatsApp."
                  action={site.settings.whatsapp && <a className="btn btn-primary btn-md" href={whatsappLink(site.settings.whatsapp)} target="_blank" rel="noreferrer">Chamar no WhatsApp</a>} />
              ) : (
                <div className="opt-list" role="group" aria-label="Serviços">
                  {services.map((s) => (
                    <button key={s.id} className="opt" aria-pressed={selected.includes(s.id)} onClick={() => toggle(s.id)}>
                      <span className="opt-check"><Icon name="check" size={14} /></span>
                      <span><span className="opt-title">{s.name}</span><br /><span className="opt-sub">{duration(s.duration_minutes)}{s.description ? ` · ${s.description}` : ''}</span></span>
                      <span className="opt-right">{money(s.price)}</span>
                    </button>
                  ))}
                </div>
              )
            )}

            {step === 1 && (
              <div className="opt-list" role="radiogroup" aria-label="Profissional">
                <button className="opt" role="radio" aria-checked={!barber} onClick={() => { setBarber(''); setSlot(null); }}>
                  <span className="avatar"><Icon name="users" /></span>
                  <span><span className="opt-title">Qualquer profissional disponível</span><br /><span className="opt-sub">Mostra mais horários</span></span><span />
                </button>
                {eligibleBarbers.map((b) => (
                  <button key={b.id} className="opt" role="radio" aria-checked={barber === b.id} onClick={() => { setBarber(b.id); setSlot(null); }}>
                    <span className="avatar">{b.photo_url ? <img src={b.photo_url} alt="" /> : b.name[0]}</span>
                    <span><span className="opt-title">{b.name}</span><br /><span className="opt-sub">{b.specialties.join(', ') || 'Barbeiro'}</span></span><span />
                  </button>
                ))}
                {eligibleBarbers.length === 0 && <Empty title="Nenhum profissional realiza essa combinação" text="Volte e ajuste os serviços selecionados." />}
              </div>
            )}

            {step === 2 && (
              <div className="panel">
                <h2>Escolha o dia</h2>
                <div className="days" role="group" aria-label="Dias">
                  {days.map(({ d, wd, open }) => (
                    <button key={d} className="day" disabled={!open} aria-pressed={day === d} onClick={() => { setDay(d); setSlot(null); }}>
                      {WEEKDAYS[wd].slice(0, 3)}<strong>{d.slice(8)}</strong>{new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}
                    </button>
                  ))}
                </div>
                {!days.some((x) => x.open) && <p className="muted">A barbearia ainda não publicou os dias de funcionamento.</p>}
                <h2 style={{ marginTop: 22 }}>Horários livres{day && ` em ${fmtLongDate(day + 'T12:00:00-03:00')}`}</h2>
                {slotsErr ? <ErrorBox error={slotsErr} /> : !uniqueSlots ? <Loading label="Buscando horários" /> : uniqueSlots.length === 0 ? (
                  <Empty title="Sem horários livres neste dia" text="Tente outro dia ou outro profissional." />
                ) : (
                  <div className="slots" role="group" aria-label="Horários">
                    {uniqueSlots.map((s) => <button key={s.starts_at} className="slot" aria-pressed={slot?.starts_at === s.starts_at} onClick={() => setSlot(s)}>{fmtTime(s.starts_at)}</button>)}
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="panel" style={{ display: 'grid', gap: 16 }}>
                <h2>Confira e confirme</h2>
                <Field label="Observações para o barbeiro" hint="Opcional. Ex.: referência de corte, alergias a produtos.">
                  <Textarea maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                {planCovers && (
                  <label className="check"><input type="checkbox" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} />
                    <span>Usar meu plano neste atendimento <span className="field-hint">(serviços incluídos saem sem custo e contam como utilização)</span></span></label>
                )}
                {!session && <div className="notice"><Icon name="user" /><span>Para confirmar, entre ou crie sua conta. Seus dados de seleção ficam guardados.</span></div>}
                <p className="muted" style={{ fontSize: 13.5 }}>
                  Política: cancelamento e reagendamento online até {site.settings.cancel_min_hours}h antes. Tolerância de atraso: {site.settings.late_tolerance_minutes} min.
                </p>
              </div>
            )}
          </div>

          <aside className="summary" aria-label="Resumo do agendamento">
            <h2>Seu agendamento</h2>
            <dl>
              <div><dt>Serviços</dt><dd>{chosen.length ? chosen.map((c) => c.name).join(' + ') : 'Nenhum selecionado'}</dd></div>
              {chosen.length > 0 && <div><dt>Tempo estimado</dt><dd>{duration(minutes)}</dd></div>}
              {step >= 1 && <div><dt>Profissional</dt><dd>{slot?.barber_name || eligibleBarbers.find((b) => b.id === barber)?.name || 'Qualquer disponível'}</dd></div>}
              {slot && <div><dt>Data e horário</dt><dd>{fmtLongDate(slot.starts_at)}, {fmtTime(slot.starts_at)}</dd></div>}
            </dl>
            <div className="summary-total"><span>Total</span><strong>{usePlan && planCovers ? 'Plano' : money(total)}</strong></div>
            {step < 3 ? (
              <Button variant="light" size="lg" disabled={(step === 0 && !chosen.length) || (step === 2 && !slot) || (step === 1 && eligibleBarbers.length === 0)} onClick={() => setStep(step + 1)}>Continuar</Button>
            ) : (
              <Button variant="light" size="lg" loading={busy} onClick={confirm}>{session ? 'Confirmar reserva' : 'Entrar para confirmar'}</Button>
            )}
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Voltar</Button>}
            <span className="muted">Pagamento na barbearia, em dinheiro, Pix ou cartão.</span>
          </aside>
        </div>
      </div>
    </SiteLayout>
  );
}
