"use client";

import Image from "next/image";
import Link from "next/link";
import { Check as CheckIcon, Copy, Globe, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { roles } from "@/lib/format";
import type { Company, Member, Role } from "@/lib/models";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { ActionForm, Sheet } from "./ui/form";
import { Badge, Button, Check, Field, Input, SectionTitle, Select, Textarea } from "./ui/primitives";

const week = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
type Integration = { email: boolean; whatsapp: boolean; confirmationWhatsApp: boolean; cron: boolean };

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState("Link copiado."); }
    catch { setState("Selecione e copie o link acima."); }
  }
  return <div className="copy-feedback"><Button variant="secondary" size="small" onClick={copy}>
    {state === "Link copiado." ? <CheckIcon size={16} /> : <Copy size={16} />}{label}
  </Button>{state && <span className="subtle" role="status">{state}</span>}</div>;
}

export function CompanySettings({ company, logo, integrations }: { company: Company; logo: string | null; integrations: Integration }) {
  const [working, setWorking] = useState(company.working_hours);
  return <ActionForm action={workspaceAction.bind(null, company.slug, "company.save")} label="Salvar configurações">
    <section className="panel panel-pad settings-section">
      <SectionTitle title="Perfil da empresa" description="Aparece para sua equipe e na página de agendamento." />
      <div className="form-grid">
        <Field label="Nome da empresa"><Input name="name" defaultValue={company.name} required minLength={2} maxLength={100} /></Field>
        <Field label="Endereço"><Input name="address" defaultValue={company.address} maxLength={250} /></Field>
      </div>
      <Field label="Apresentação"><Textarea name="description" maxLength={700} defaultValue={company.description} /></Field>
      {logo && <Image src={logo} alt="Logotipo atual" width={58} height={58} className="image-thumb" unoptimized />}
      <Field label="Logotipo" help="PNG, JPEG ou WebP de até 2 MB."><Input name="image" type="file" accept="image/png,image/jpeg,image/webp" /></Field>
      {logo && <Check name="remove_image">Remover logotipo atual</Check>}
    </section>
    <section className="panel panel-pad settings-section">
      <SectionTitle title="Horários de funcionamento" description="Horário de Brasília · America/Sao_Paulo" />
      <div className="days-grid">
        {week.map((name, index) => {
          const day = String(index + 1);
          const period = working[day];
          return <div key={day} className="hours-row">
            <Check name={"open_" + day} checked={!!period} onChange={event => {
              setWorking(current => ({ ...current, [day]: event.target.checked ? company.working_hours[day] ?? { open: "09:00", close: "18:00" } : undefined }));
            }}>{name}</Check>
            <Input aria-label={"Abertura de " + name} name={"start_" + day} type="time" disabled={!period} required={!!period} value={period?.open ?? ""} onChange={event => {
              if (period) setWorking(current => ({ ...current, [day]: { ...period, open: event.target.value } }));
            }} />
            <Input aria-label={"Fechamento de " + name} name={"end_" + day} type="time" disabled={!period} required={!!period} value={period?.close ?? ""} onChange={event => {
              if (period) setWorking(current => ({ ...current, [day]: { ...period, close: event.target.value } }));
            }} />
          </div>;
        })}
      </div>
    </section>
    <section className="panel panel-pad settings-section">
      <SectionTitle title="Agendamento online" />
      <Check name="booking_enabled" defaultChecked={company.booking_enabled}>Disponibilizar página pública de agendamento</Check>
      <Check name="auto_confirm" defaultChecked={company.auto_confirm}>Confirmar automaticamente os novos pedidos online</Check>
      <Check name="allow_customer_cancel" defaultChecked={company.allow_customer_cancel}>Permitir cancelamento pelo link da cliente</Check>
      <Field label="Antecedência mínima para cancelamento (horas)"><Input name="cancel_hours" type="number" min={0} max={168} defaultValue={company.cancel_hours} required /></Field>
    </section>
    <section className="panel panel-pad settings-section">
      <SectionTitle title="Lembretes e confirmação" />
      <div className="title-actions">
        <Badge tone={integrations.cron ? "green" : "amber"}>{integrations.cron ? "Endpoint agendável" : "Cron desativado"}</Badge>
        <Badge tone={integrations.email ? "green" : "amber"}>{integrations.email ? "E-mail configurado" : "E-mail sem credenciais"}</Badge>
        <Badge tone={integrations.whatsapp ? "green" : "amber"}>{integrations.whatsapp ? "WhatsApp configurado" : "WhatsApp sem credenciais"}</Badge>
      </div>
      <Check name="reminder_internal" defaultChecked={company.reminder_internal}>Notificar a equipe no painel</Check>
      <Check name="reminder_email" defaultChecked={company.reminder_email}>Enviar e-mails às clientes que autorizaram</Check>
      <Check name="reminder_whatsapp" defaultChecked={company.reminder_whatsapp}>Enviar WhatsApp às clientes que autorizaram</Check>
      {integrations.whatsapp && !integrations.confirmationWhatsApp && <p className="subtle">Configure também o modelo de confirmação para enviar a primeira mensagem pelo WhatsApp.</p>}
      <Field label="Antecedência dos lembretes (horas)" help="Separe até cinco horários com ponto e vírgula. Exemplo 24; 2; 0,5. Em branco, desativa lembretes.">
        <Input name="reminder_hours" maxLength={80} defaultValue={company.reminder_minutes.map(minutes => String(Number((minutes / 60).toFixed(2))).replace(".", ",")).join("; ")} />
      </Field>
      <Field label="Mensagem de lembrete por e-mail" help="Campos disponíveis {cliente}, {servico}, {data}, {hora}, {empresa}, {link}. O WhatsApp usa o modelo aprovado pela Meta.">
        <Textarea name="reminder_template" maxLength={1200} rows={4} defaultValue={company.reminder_template} />
      </Field>
    </section>
    <section className="panel panel-pad settings-section">
      <SectionTitle title="Estoque" /><Check name="allow_negative_stock" defaultChecked={company.allow_negative_stock}>Autorizar movimentações com saldo negativo</Check>
    </section>
  </ActionForm>;
}

export function TeamEditor({ slug, member, role }: { slug: string; member?: Member; role: Role }) {
  const owner = member?.role === "owner";
  const options = role === "owner" ? ["admin", "professional", "receptionist"] as const : ["professional", "receptionist"] as const;
  return <Sheet title={member ? "Editar integrante" : "Convidar integrante"} description={member ? undefined : "A integrante precisa entrar com este e-mail confirmado e aceitar o convite em Minhas empresas."}
    trigger={<Button variant={member ? "secondary" : "primary"} size={member ? "small" : "normal"}>{member ? <Pencil size={15} /> : <Plus size={18} />}{member ? "Editar" : "Convidar integrante"}</Button>}>
    {close => <ActionForm action={workspaceAction.bind(null, slug, "member.save")} onSaved={close} label={member ? "Salvar" : "Criar convite"}>
      {member && <input type="hidden" name="id" value={member.id} />}
      <Field label="Nome na equipe"><Input name="name" defaultValue={member?.name} required minLength={2} maxLength={100} /></Field>
      {member ? <p className="subtle">{member.email}</p> : <Field label="E-mail do convite"><Input name="email" type="email" required maxLength={254} /></Field>}
      {owner ? <><input type="hidden" name="role" value="owner" /><input type="hidden" name="active" value="on" /><Badge tone="rose">{roles.owner}</Badge></> : <>
        <Field label="Nível de acesso"><Select name="role" defaultValue={member?.role ?? "professional"}>{options.map(value => <option value={value} key={value}>{roles[value]}</option>)}</Select></Field>
        <Check name="active" defaultChecked={member?.active ?? true}>Acesso ativo</Check>
      </>}
      <Check name="bookable" defaultChecked={member?.bookable ?? true}>Pode receber agendamentos</Check>
    </ActionForm>}
  </Sheet>;
}

export function BookingUrl({ slug, url, active }: { slug: string; url: string; active: boolean }) {
  return <section className="panel panel-pad settings-section">
    <SectionTitle icon={Globe} title="Link para compartilhar"><Badge tone={active ? "green" : "neutral"}>{active ? "Página ativa" : "Página desativada"}</Badge></SectionTitle>
    <Input value={url} readOnly aria-label="Link do agendamento online" onFocus={event => event.currentTarget.select()} />
    <div className="title-actions"><CopyButton text={url} label="Copiar link" />
      {active && <Button asChild variant="ghost" size="small"><Link href={"/agendar/" + slug} target="_blank" rel="noreferrer">Abrir página</Link></Button>}
    </div>
  </section>;
}
