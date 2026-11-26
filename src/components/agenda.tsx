"use client";

import FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventDropArg, EventInput, EventSourceFuncArg, DateSelectArg } from "@fullcalendar/core";
import ptBr from "@fullcalendar/core/locales/pt-br";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import interaction from "@fullcalendar/interaction";
import luxon from "@fullcalendar/luxon3";
import Link from "next/link";
import { Ban, CalendarDays, Check, Clock3, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Appointment, AppointmentStatus, Client, CompletionMaterial, Member, Service, WorkingHours } from "@/lib/models";
import { dateAndTime, duration, hour, local, money, moneyInput, paymentMethods, phoneDisplay, quantity, statuses } from "@/lib/format";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { ActionForm, Sheet } from "./ui/form";
import { Badge, Button, Empty, Field, Input, PageTitle, Select, Textarea } from "./ui/primitives";

const plugins = [dayGrid, timeGrid, interaction, luxon];
const inactive: AppointmentStatus[] = ["completed", "cancelled", "no_show"];
const timeFormat = { hour: "2-digit", minute: "2-digit", hour12: false } as const;

type AgendaProps = {
  slug: string; timezone: string; workHours: WorkingHours; allowEdit: boolean;
  professionals: Member[]; clients: Pick<Client, "id" | "name" | "phone">[]; services: Service[];
  initialEvent: Appointment | null; openCreate: boolean;
};

export function Agenda({ slug, timezone, workHours, allowEdit, professionals, clients, services, initialEvent, openCreate }: AgendaProps) {
  const calendar = useRef<FullCalendar>(null);
  const [mode, setMode] = useState<"details"|"edit"|"new"|"block"|"finish"|null>(initialEvent ? "details" : openCreate ? "new" : null);
  const [entry, setEntry] = useState(initialEvent);
  const [startsAt, setStartsAt] = useState("");
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [moving, move] = useTransition();
  const agendaApi = "/api/empresas/" + slug + "/agenda";
  const base = "/painel/" + slug;

  const available = useMemo(() => professionals.filter(member => member.active && member.bookable), [professionals]);
  const names = useMemo(() => new Map(professionals.map(member => [member.id, member.name])), [professionals]);
  const hours = useMemo(() => Object.entries(workHours).flatMap(([day, period]) => period ?
    [{ daysOfWeek: [Number(day) % 7], startTime: period.open, endTime: period.close }] : []), [workHours]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) calendar.current?.getApi().changeView("timeGridDay");
  }, []);

  const loadEvents = useCallback(async (info: EventSourceFuncArg): Promise<EventInput[]> => {
    try {
      const params = new URLSearchParams({ inicio: info.startStr, fim: info.endStr });
      const response = await fetch(agendaApi + "?" + params.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error();
      const rows: Appointment[] = await response.json();
      const query = search.trim().toLocaleLowerCase("pt-BR");
      setError("");
      return rows.filter(appointment => {
        if (appointment.kind === "block" && appointment.status === "cancelled") return false;
        if (person && appointment.professional_id !== person) return false;
        if (status && appointment.status !== status) return false;
        return !query || [appointment.title, appointment.clients?.name, names.get(appointment.professional_id)]
          .some(value => value?.toLocaleLowerCase("pt-BR").includes(query));
      }).map(appointment => ({
        id: appointment.id, title: appointment.title, start: appointment.starts_at, end: appointment.ends_at,
        borderColor: appointment.color, backgroundColor: appointment.color + "28", textColor: "var(--ink)",
        editable: allowEdit && !inactive.includes(appointment.status) && appointment.status !== "in_progress",
        interactive: true, extendedProps: { appointment },
      }));
    } catch {
      setError("Não foi possível carregar a agenda.");
      return [];
    }
  }, [agendaApi, allowEdit, names, person, search, status]);

  function create(kind: "new" | "block", date?: string) {
    const selected = date ? local(date) : local().plus({ minutes: 30 }).startOf("hour").plus({ hours: 1 });
    const opening = workHours[String(selected.weekday)]?.open ?? "09:00";
    setStartsAt(date && !date.includes("T") ? selected.toISODate() + "T" + opening : selected.toFormat("yyyy-MM-dd'T'HH:mm"));
    setEntry(null);
    setMode(kind);
  }

  function selectedRange(info: DateSelectArg) {
    create("new", info.startStr);
    calendar.current?.getApi().unselect();
  }
  function selectEvent(info: EventClickArg) {
    setEntry(info.event.extendedProps.appointment as Appointment);
    setMode("details");
  }
  function drag(info: EventDropArg) {
    if (!allowEdit) { info.revert(); return; }
    const appointment = info.event.extendedProps.appointment as Appointment;
    const data = new FormData();
    data.set("id", appointment.id);
    data.set("updated_at", appointment.updated_at);
    data.set("starts_at", info.event.startStr);
    data.set("duration_minutes", String(Math.round(local(appointment.ends_at).diff(local(appointment.starts_at), "minutes").minutes)));
    data.set("professional_id", appointment.professional_id);
    data.set("notes", appointment.notes);
    if (appointment.kind === "block") {
      data.set("block", "on");
      data.set("title", appointment.title);
    } else {
      data.set("client_id", appointment.client_id ?? "");
      data.set("service_id", appointment.service_id ?? "");
      data.set("price_cents", moneyInput(appointment.price_cents));
    }
    move(async () => {
      const state = await workspaceAction(slug, "appointment.save", {}, data);
      if (!state.ok) {
        info.revert();
        setError(state.error ?? "Não foi possível mover este horário.");
        return;
      }
      calendar.current?.getApi().refetchEvents();
    });
  }

  function saved(close: () => void) {
    close();
    calendar.current?.getApi().refetchEvents();
  }

  const isBlock = mode === "block" || (mode === "edit" && entry?.kind === "block");
  const sheetTitle = mode === "details" ? (entry?.kind === "block" ? "Horário bloqueado" : "Atendimento") :
    mode === "finish" ? "Concluir atendimento" : mode === "edit" ? "Editar horário" : isBlock ? "Bloquear horário" : "Novo agendamento";

  return <div className="page-stack">
    <PageTitle title="Agenda" description="Gerencie seus horários, bloqueios e atendimentos.">
      {allowEdit && <>
        <Button variant="secondary" onClick={() => create("block")}><Ban size={16} />Bloquear horário</Button>
        <Button onClick={() => create("new")}><Plus size={18} />Novo agendamento</Button>
      </>}
    </PageTitle>
    <section className="panel panel-pad calendar" aria-label="Calendário de atendimentos">
      <div className="filters">
        <label className="search-box"><Search size={16} /><Input aria-label="Pesquisar agendamentos" placeholder="Pesquisar na agenda" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <Select value={person} onChange={event => setPerson(event.target.value)} aria-label="Filtrar por profissional">
          <option value="">Todas as profissionais</option>{professionals.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}
        </Select>
        <Select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filtrar por status">
          <option value="">Todos os status</option>{Object.entries(statuses).map(([key, value]) => <option value={key} key={key}>{value}</option>)}
        </Select>
      </div>
      <div className="calendar-status" aria-label="Status de atendimento">
        {Object.entries(statuses).map(([key, value]) => <Badge key={key} tone={key}>{value}</Badge>)}
      </div>
      {(error || moving) && <p className={error ? "form-error" : "form-note"} role={error ? "alert" : "status"}>{error || "Movendo horário…"}</p>}
      {loading && <p className="subtle" role="status">Carregando horários…</p>}
      <FullCalendar
        ref={calendar} plugins={plugins} locale={ptBr} timeZone={timezone} initialView="timeGridWeek"
        initialDate={initialEvent?.starts_at}
        headerToolbar={{ start: "prev,next today", center: "title", end: "timeGridDay,timeGridWeek,dayGridMonth" }}
        buttonText={{ today: "Hoje", day: "Dia", week: "Semana", month: "Mês" }}
        eventTimeFormat={timeFormat} slotLabelFormat={timeFormat} slotDuration="00:30:00"
        slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime="08:00:00" scrollTimeReset={false}
        height={650} allDaySlot={false} nowIndicator dayMaxEvents={4} eventMinHeight={32} firstDay={1}
        selectable={allowEdit} editable={allowEdit} eventDurationEditable={false}
        businessHours={hours} events={loadEvents} loading={setLoading} select={selectedRange} eventClick={selectEvent} eventDrop={drag}
        eventContent={event => {
          const appointment = event.event.extendedProps.appointment as Appointment;
          const name = appointment.clients?.name ?? appointment.title;
          const month = event.view.type === "dayGridMonth";
          return <span className={month ? "calendar-event calendar-event-month" : "calendar-event"}
            title={[event.timeText, name, appointment.clients && appointment.title, statuses[appointment.status]].filter(Boolean).join(" · ")}>
            {event.timeText && <small className="calendar-event-time">{event.timeText}</small>}
            <span>{name}</span>
            {!month && appointment.clients && <small>{appointment.title}</small>}
          </span>;
        }}
      />
    </section>
    <Sheet title={sheetTitle} description={mode === "finish" ? "Confira as quantidades usadas antes de baixar o estoque." : undefined}
      open={mode !== null} onOpenChange={value => { if (!value) setMode(null); }}>
      {close => mode === "details" && entry ? <AppointmentDetails appointment={entry} slug={slug}
        memberName={names.get(entry.professional_id)} allowEdit={allowEdit} edit={() => setMode("edit")}
        finish={() => setMode("finish")} onSaved={() => saved(close)} /> :
        mode === "finish" && entry ? <FinishAppointment api={agendaApi} slug={slug} appointment={entry} canCollect={allowEdit} onSaved={() => saved(close)} /> :
        <AppointmentEditor slug={slug} base={base} entry={mode === "edit" ? entry : null} block={isBlock}
          start={startsAt || local().toFormat("yyyy-MM-dd'T'HH:mm")} professionals={available} allProfessionals={professionals}
          clients={clients} services={services} preselected={person} onSaved={() => saved(close)} />}
    </Sheet>
  </div>;
}

function AppointmentEditor({ slug, base, entry, block, start, professionals, allProfessionals, clients, services, preselected, onSaved }: {
  slug: string; base: string; entry: Appointment | null; block: boolean; start: string; professionals: Member[]; allProfessionals: Member[];
  clients: AgendaProps["clients"]; services: Service[]; preselected: string; onSaved: () => void;
}) {
  const [serviceId, setServiceId] = useState(entry?.service_id ?? "");
  const [professional, setProfessional] = useState(entry?.professional_id ?? preselected);
  const [minutes, setMinutes] = useState(entry ? String(Math.round(local(entry.ends_at).diff(local(entry.starts_at), "minutes").minutes)) : block ? "60" : "");
  const [price, setPrice] = useState(entry ? moneyInput(entry.price_cents) : "");
  const service = services.find(item => item.id === serviceId);
  const assigned = service?.service_professionals.map(item => item.member_id) ?? [];
  const allowed = professionals.filter(member => block || !serviceId || assigned.includes(member.id));
  const inactiveMember = entry && allProfessionals.find(member => member.id === entry.professional_id && !allowed.some(item => item.id === member.id));

  function choose(value: string) {
    const item = services.find(candidate => candidate.id === value);
    setServiceId(value);
    setMinutes(item ? String(item.duration_minutes) : "");
    setPrice(item ? moneyInput(item.price_cents) : "");
    if (item && !item.service_professionals.some(member => member.member_id === professional)) setProfessional("");
  }

  return <ActionForm action={workspaceAction.bind(null, slug, "appointment.save")} label={block ? "Salvar bloqueio" : "Salvar agendamento"}
    onSaved={onSaved} disabled={!professionals.length && !entry || !block && (!clients.length || !services.length)}>
    {entry && <><input type="hidden" name="id" value={entry.id} /><input type="hidden" name="updated_at" value={entry.updated_at} /></>}
    {block ? <>
      <input type="hidden" name="block" value="on" />
      <Field label="Motivo do bloqueio"><Input name="title" placeholder="Ex.: pausa para almoço" defaultValue={entry?.title} maxLength={120} /></Field>
    </> : <>
      {!clients.length && <p className="form-note">Antes, <Link className="text-link" href={base + "/clientes?novo=1"}>cadastre uma cliente</Link>.</p>}
      {!services.some(item => item.active) && <p className="form-note">Antes, <Link className="text-link" href={base + "/servicos?novo=1"}>cadastre um serviço e vincule uma profissional</Link>.</p>}
      <Field label="Cliente"><Select name="client_id" required defaultValue={entry?.client_id ?? ""}>
        <option value="">Selecione uma cliente</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name} · {phoneDisplay(client.phone)}</option>)}
      </Select></Field>
      <Field label="Serviço"><Select name="service_id" required value={serviceId} onChange={event => choose(event.target.value)}>
        <option value="">Selecione um serviço</option>{services.filter(item => item.active || item.id === entry?.service_id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select></Field>
    </>}
    <Field label="Profissional"><Select name="professional_id" required value={professional} onChange={event => setProfessional(event.target.value)}>
      <option value="">Selecione uma profissional</option>{allowed.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
      {inactiveMember && <option value={inactiveMember.id}>{inactiveMember.name} · indisponível</option>}
    </Select></Field>
    {!allowed.length && <p className="form-note">Vincule uma profissional disponível a este serviço para agendar.</p>}
    <div className="form-grid">
      <Field label="Data e horário (Brasília)"><Input name="starts_at" type="datetime-local" defaultValue={entry ? local(entry.starts_at).toFormat("yyyy-MM-dd'T'HH:mm") : start} required /></Field>
      <Field label="Duração em minutos"><Input name="duration_minutes" type="number" min={5} max={block ? 1440 : 720} value={minutes} onChange={event => setMinutes(event.target.value)} required /></Field>
    </div>
    {!block && <div className="form-grid">
      <Field label="Valor (R$)"><Input name="price_cents" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} pattern="[0-9]+([,.][0-9]{1,2})?" /></Field>
      {(!entry || inactive.includes(entry.status)) && <Field label="Status inicial"><Select name="initial_status"><option value="pending">Pendente</option><option value="confirmed">Confirmado</option></Select></Field>}
    </div>}
    <Field label="Observações"><Textarea name="notes" defaultValue={entry?.notes} maxLength={2000} /></Field>
  </ActionForm>;
}

function AppointmentDetails({ appointment, slug, memberName, allowEdit, edit, finish, onSaved }: {
  appointment: Appointment; slug: string; memberName?: string; allowEdit: boolean; edit: () => void; finish: () => void; onSaved: () => void;
}) {
  const active = !inactive.includes(appointment.status);
  const block = appointment.kind === "block";
  const buttons: { status: AppointmentStatus; title: string; confirm?: string }[] = block
    ? [{ status: "cancelled", title: "Remover bloqueio", confirm: "Liberar este horário bloqueado?" }]
    : [
      ...(appointment.status === "pending" ? [{ status: "confirmed" as const, title: "Confirmar" }] : []),
      ...(appointment.status !== "in_progress" ? [{ status: "in_progress" as const, title: "Iniciar atendimento" }] : []),
      { status: "no_show", title: "Marcar ausência", confirm: "Marcar que a cliente não compareceu?" },
      { status: "cancelled", title: "Cancelar horário", confirm: "Cancelar este atendimento?" },
    ];
  return <div className="page-stack">
    <div><h3 className="font-extrabold text-xl">{appointment.title}</h3><p className="muted">{appointment.clients?.name ?? (block ? "Horário indisponível" : "Cliente removida")}</p></div>
    <div className="title-actions"><Badge tone={appointment.status}>{block && active ? "Bloqueado" : statuses[appointment.status]}</Badge>
      {appointment.source === "online" && <Badge tone="lilac">Agendamento online</Badge>}
      {appointment.needs_reschedule && <Badge tone="amber">Solicitou reagendamento</Badge>}
      {appointment.attendance_confirmed_at && !appointment.needs_reschedule && active && <Badge tone="green">Presença confirmada pela cliente</Badge>}
    </div>
    <dl className="summary-lines">
      <div><dt>Início</dt><dd>{dateAndTime(appointment.starts_at)}</dd></div>
      <div><dt>Fim</dt><dd>{hour(appointment.ends_at)} · {duration(Math.round(local(appointment.ends_at).diff(local(appointment.starts_at), "minutes").minutes))}</dd></div>
      {memberName && <div><dt>Profissional</dt><dd>{memberName}</dd></div>}
      {!block && <div><dt>Valor</dt><dd>{money(appointment.price_cents)}</dd></div>}
    </dl>
    {appointment.notes && <p className="form-note whitespace-pre-wrap">{appointment.notes}</p>}
    <div className="title-actions">
      {allowEdit && !["completed","in_progress"].includes(appointment.status) && <Button variant="secondary" onClick={edit}>{active ? "Editar horário" : "Reagendar"}</Button>}
      {active && !block && <Button onClick={finish}><Check size={17} />Concluir atendimento</Button>}
    </div>
    {active && <div className="title-actions">{buttons.map(button => <ActionForm key={button.status}
      action={workspaceAction.bind(null, slug, "appointment.status")} compact label={button.title}
      variant={button.status === "cancelled" ? "danger" : "secondary"} onSaved={onSaved} confirm={button.confirm}>
      <input type="hidden" name="id" value={appointment.id} /><input type="hidden" name="status" value={button.status} />
    </ActionForm>)}</div>}
  </div>;
}

function FinishAppointment({ api, slug, appointment, canCollect, onSaved }: {
  api: string; slug: string; appointment: Appointment; canCollect: boolean; onSaved: () => void;
}) {
  const [materials, setMaterials] = useState<CompletionMaterial[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(api + "?materiais=" + appointment.id, { signal: controller.signal, cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(setMaterials).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [api, appointment.id]);
  if (error) return <Empty icon={CalendarDays} title="Não foi possível consultar os materiais" description="Feche esta tela e tente novamente." />;
  if (materials === null) return <p className="subtle" role="status">Consultando materiais…</p>;
  return <ActionForm action={workspaceAction.bind(null, slug, "appointment.finish")} onSaved={onSaved} label="Concluir e registrar consumo">
    <input type="hidden" name="id" value={appointment.id} />
    {materials.length ? materials.map(item => <Field key={item.product_id} label={item.name + " (" + item.unit + ")"}
      help={quantity(item.available) + " em estoque"}>
      <input type="hidden" name="product_id" value={item.product_id} />
      <Input name="material_quantity" inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,3})?" defaultValue={String(item.quantity).replace(".", ",")} required />
    </Field>) : <p className="form-note">Este serviço não tem materiais cadastrados.</p>}
    {canCollect && appointment.price_cents > 0 && <Field label="Pagamento" help={"Valor do atendimento " + money(appointment.price_cents)}>
      <Select name="method"><option value="">Manter pagamento pendente</option>{Object.entries(paymentMethods).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</Select>
    </Field>}
    {!canCollect && appointment.price_cents > 0 && <p className="form-note"><Clock3 size={15} className="inline mr-1" />Pagamento ficará pendente para a administração.</p>}
  </ActionForm>;
}
