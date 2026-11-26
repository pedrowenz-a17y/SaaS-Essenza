"use client";

import Link from "next/link";
import { CalendarDays, CheckCircle2, Clock3, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicCatalog } from "@/lib/models";
import { dayLabel, duration, hour, local, money } from "@/lib/format";
import { requestBooking } from "@/lib/server/booking-actions";
import type { ActionState } from "@/lib/server/action-state";
import { ActionForm } from "./ui/form";
import { Badge, Button, Check, Empty, Field, Input, SectionTitle, Select } from "./ui/primitives";

type Slots = { key: string; times: string[]; error?: string };

export function PublicBooking({ catalog, slug }: { catalog: PublicCatalog; slug: string }) {
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<Slots | null>(null);
  const [confirmed, setConfirmed] = useState<ActionState | null>(null);
  const service = catalog.services.find(item => item.id === serviceId);
  const professional = service?.professionals.find(item => item.id === professionalId);
  const key = service && professional && day ? [serviceId, professionalId, day].join("/") : "";
  const current = slots?.key === key ? slots : null;
  const today = local().toISODate()!;
  const tomorrow = local().plus({ days: 1 }).toISODate()!;
  const last = local().plus({ days: 90 }).toISODate()!;

  function selectDay(value: string) {
    if (value === day) return;
    setDay(value);
    setSlots(null);
    setTime("");
  }

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ servico: serviceId, profissional: professionalId, dia: day });
    const refresh = () => fetch("/api/agendar/" + slug + "/horarios?" + query.toString(), { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.erro ?? "Não foi possível consultar os horários.");
        const times: string[] = data;
        setSlots({ key, times });
        setTime(selected => times.includes(selected) ? selected : "");
      })
      .catch(error => {
        if (!controller.signal.aborted) setSlots({ key, times: [], error: error instanceof Error ? error.message : "Horários indisponíveis." });
      });
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [day, key, professionalId, serviceId, slug]);

  if (confirmed) return <section className="panel panel-pad">
    <Empty icon={CheckCircle2} title={confirmed.message ?? "Agendamento registrado"} description="Guarde o link para consultar o status e gerenciar seu atendimento.">
      {confirmed.path && <Button asChild><Link href={confirmed.path}>Acompanhar atendimento</Link></Button>}
    </Empty>
  </section>;
  if (!catalog.services.length) return <section className="panel"><Empty icon={CalendarDays} title="Nenhum serviço disponível"
    description="Consulte a empresa sobre a abertura de novos horários." /></section>;

  return <div className="booking-layout">
    <section className="panel panel-pad">
      <ActionForm className="booking-form" action={requestBooking.bind(null, slug)} label={catalog.auto_confirm ? "Confirmar agendamento" : "Solicitar agendamento"}
        onSaved={setConfirmed} disabled={!service || !professional || !time}>
        <fieldset className="booking-step">
          <legend className="group-label">Escolha um serviço</legend>
          {catalog.services.map(item => <label className="choice" key={item.id}>
            <input type="radio" name="service_id" value={item.id} checked={serviceId === item.id} onChange={() => {
              setServiceId(item.id);
              setProfessionalId(item.professionals.length === 1 ? item.professionals[0].id : "");
              if (!day) setDay(today);
              setSlots(null);
              setTime("");
            }} required />
            <span><strong>{item.name}</strong><small>{item.description || item.category || duration(item.duration_minutes)}</small></span>
            <span className="badge">{money(item.price_cents)}</span>
          </label>)}
        </fieldset>
        {service && <Field label="Profissional">
          <Select name="professional_id" value={professionalId} required onChange={event => {
            setProfessionalId(event.target.value); setSlots(null); setTime("");
          }}><option value="">Selecione uma profissional</option>
            {service.professionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>}
        {professional && <div className="booking-step">
          <Field label="Dia do atendimento"><Input type="date" value={day} min={today} max={last}
            onChange={event => selectDay(event.currentTarget.value)} onInput={event => selectDay(event.currentTarget.value)} required /></Field>
          <div className="title-actions">
            <Button size="small" variant={day === today ? "primary" : "secondary"} aria-pressed={day === today} onClick={() => selectDay(today)}>Hoje</Button>
            <Button size="small" variant={day === tomorrow ? "primary" : "secondary"} aria-pressed={day === tomorrow} onClick={() => selectDay(tomorrow)}>Amanhã</Button>
          </div>
        </div>}
        {key && <fieldset className="booking-step"><legend className="group-label">Horários disponíveis</legend>
          {!current ? <p className="subtle" role="status">Consultando horários…</p> :
            current.error ? <p className="form-error" role="alert">{current.error}</p> :
            !current.times.length ? <p className="form-note">Nenhuma vaga nesta data. Escolha outro dia.</p> :
            <div className="slots">{current.times.map(instant => <label className="slot" key={instant}>
              <input type="radio" name="starts_at" required value={instant} checked={time === instant} onChange={() => setTime(instant)} />{hour(instant)}
            </label>)}</div>}
        </fieldset>}
        {time && <fieldset className="booking-step"><legend className="group-label">Seus dados</legend>
          <Field label="Nome completo"><Input name="name" minLength={2} maxLength={150} autoComplete="name" required /></Field>
          <div className="form-grid">
            <Field label="Telefone com DDD"><Input name="phone" type="tel" autoComplete="tel" placeholder="(11) 99999-0000" maxLength={24} required /></Field>
            <Field label="E-mail"><Input name="email" type="email" autoComplete="email" maxLength={254} /></Field>
          </div>
          <p className="subtle">A empresa usa seus dados para organizar este atendimento. Você pode escolher como receber confirmações e lembretes.</p>
          <Check name="whatsapp_opt_in">Autorizo mensagens deste atendimento pelo WhatsApp informado.</Check>
          <Check name="email_opt_in">Autorizo mensagens deste atendimento pelo e-mail informado.</Check>
        </fieldset>}
      </ActionForm>
    </section>
    <aside className="panel panel-pad settings-section">
      <SectionTitle icon={CalendarDays} title="Seu agendamento" />
      {service ? <dl className="summary-lines">
        <div><dt>Serviço</dt><dd>{service.name}</dd></div>
        <div><dt>Profissional</dt><dd>{professional?.name ?? "A escolher"}</dd></div>
        <div><dt>Duração</dt><dd><Clock3 size={15} className="inline mr-1" />{duration(service.duration_minutes)}</dd></div>
        {day && <div><dt>Quando</dt><dd>{dayLabel(day)}{time && " às " + hour(time)}</dd></div>}
        <div><dt>Valor</dt><dd>{money(service.price_cents)}</dd></div>
      </dl> : <p className="subtle">Selecione um serviço para ver os detalhes.</p>}
      <Badge tone={catalog.auto_confirm ? "green" : "rose"}>{catalog.auto_confirm ? "Confirmação imediata" : "Sujeito à aprovação da empresa"}</Badge>
      {catalog.address && <p className="subtle"><MapPin size={16} className="inline mr-1" />{catalog.address}</p>}
      {catalog.allow_customer_cancel && <p className="subtle">{catalog.cancel_hours ? "Cancele pelo link até " + catalog.cancel_hours + " h antes." : "Cancele pelo link até o início do atendimento."}</p>}
    </aside>
  </div>;
}
