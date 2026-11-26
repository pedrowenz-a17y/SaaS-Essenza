import Link from "next/link";
import { APP_NAME } from "@/lib/branding";
import { notFound } from "next/navigation";
import { ClipboardList, Mail, MonitorDown, UsersRound } from "lucide-react";
import { BookingUrl, CompanySettings, CopyButton, TeamEditor } from "@/components/settings-editor";
import { Pagination, pageNumber } from "@/components/pagination";
import { Badge, Empty, PageTitle, SectionTitle, Table } from "@/components/ui/primitives";
import { dateAndTime, roles } from "@/lib/format";
import type { Member } from "@/lib/models";
import { integrationStatus } from "@/lib/server/reminder-delivery";
import { result, roster, workspace } from "@/lib/server/data";
import { publicLogo } from "@/lib/supabase/server";

export const metadata = { title: "Configurações" };
const sections = [
  { value: "empresa", name: "Empresa" }, { value: "equipe", name: "Equipe" },
  { value: "envios", name: "Histórico de envios" }, { value: "auditoria", name: "Auditoria" },
];
const deliveryStatus: Record<string, string> = {
  sent: "Enviado", pending: "Na fila", sending: "Processando", failed: "Falhou", skipped: "Ignorado", unknown: "Entrega incerta",
};
const deliveryReasons: Record<string, string> = {
  no_consent: "Sem consentimento para o canal", provider_disabled: "Integração desativada", rescheduled: "Atendimento reagendado",
  inactive: "Atendimento inativo", settings: "Configuração alterada", ineligible: "Fora das regras de envio",
  claim_expired: "Processamento interrompido", network_ambiguous: "Conexão interrompida", rate_limit: "Limite do provedor",
  provider_unavailable: "Provedor indisponível",
};
const channels: Record<string, string> = { email: "E-mail", whatsapp: "WhatsApp", internal: "Interno" };
const entities: Record<string, string> = {
  clients: "Cliente", appointments: "Agenda", products: "Produto", services: "Serviço", stock_movements: "Movimentação",
  finance_entries: "Financeiro", companies: "Empresa", members: "Equipe",
};
const auditLabels: Record<string, string> = { insert: "Criação", update: "Alteração", delete: "Exclusão" };

export default async function Settings({ params, searchParams }: {
  params: Promise<{ empresa: string }>; searchParams: Promise<{ aba?: string; pagina?: string }>;
}) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  if (!ctx.manager) notFound();
  const query = await searchParams;
  const selected = sections.find(item => item.value === query.aba)?.value ?? "empresa";
  const base = "/painel/" + empresa + "/configuracoes";
  const origin = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  const page = pageNumber(query.pagina);
  const size = 30;

  let content;
  if (selected === "equipe") {
    const members = await roster(ctx);
    content = <section className="panel">
      <div className="list-header">
        <SectionTitle icon={UsersRound} title="Integrantes da empresa" description="Convites aparecem em Minhas empresas depois que a integrante confirma o e-mail.">
          <TeamEditor slug={empresa} role={ctx.member.role} />
        </SectionTitle>
      </div>
      <Table label="Equipe da empresa">
        <thead><tr><th>Integrante</th><th>Função</th><th>Acesso</th><th>Agenda</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{members.map((member: Member) => <tr key={member.id}>
          <td><strong>{member.name}</strong><small>{member.email}</small></td><td>{roles[member.role]}</td>
          <td><Badge tone={!member.active ? "neutral" : member.joined ? "green" : "amber"}>{!member.active ? "Desativado" : member.joined ? "Ativo" : "Convite pendente"}</Badge></td>
          <td>{member.bookable ? "Disponível" : "Desativada"}</td>
          <td>{(ctx.member.role === "owner" || !["owner","admin"].includes(member.role)) && <div className="cell-actions"><TeamEditor slug={empresa} member={member} role={ctx.member.role} /></div>}</td>
        </tr>)}</tbody>
      </Table>
      {origin && <div className="panel-pad"><CopyButton text={origin + "/inicio"} label="Copiar link de acesso" /></div>}
    </section>;
  } else if (selected === "envios") {
    const response = await ctx.client.from("reminder_jobs").select("id,channel,purpose,status,run_at,finished_at,reason,attempts", { count: "exact" })
      .eq("company_id", ctx.company.id).order("run_at", { ascending: false }).order("id").range((page - 1) * size, page * size - 1);
    const rows = result<{ id: string; channel: string; purpose: string; status: string; run_at: string; finished_at: string | null; reason: string | null; attempts: number }[]>(response);
    content = <><section className="panel">
      <div className="list-header"><SectionTitle icon={Mail} title="Histórico de envios" description="Lembretes e confirmações de agendamento por canal." /></div>
      {rows.length ? <Table label="Resultado dos envios">
        <thead><tr><th>Previsto para</th><th>Canal</th><th>Tipo</th><th>Situação</th><th>Tentativas</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td>{dateAndTime(row.run_at)}{row.finished_at && <small>Processado {dateAndTime(row.finished_at)}</small>}</td>
          <td>{channels[row.channel]}</td><td>{row.purpose === "confirmation" ? "Confirmação" : "Lembrete"}</td>
          <td><Badge tone={row.status === "sent" ? "green" : row.status === "failed" ? "red" : "amber"}>{deliveryStatus[row.status]}</Badge>
            {row.reason && <small>{deliveryReasons[row.reason] ?? "Resposta do provedor"}</small>}</td><td>{row.attempts}</td>
        </tr>)}</tbody>
      </Table> : <Empty icon={Mail} title="Nenhum envio registrado" description="Os envios entram na fila conforme os canais configurados e a agenda da empresa." />}
    </section><Pagination page={page} size={size} total={response.count ?? 0} path={base} filters={{ aba: selected }} /></>;
  } else if (selected === "auditoria") {
    const response = await ctx.client.from("audit_events").select("id,entity,action,created_at,actor_id", { count: "exact" })
      .eq("company_id", ctx.company.id).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * size, page * size - 1);
    const rows = result<{ id: number; entity: string; action: string; created_at: string; actor_id: string | null }[]>(response);
    content = <><section className="panel">
      <div className="list-header"><SectionTitle icon={ClipboardList} title="Registro de operações" description="Alterações importantes na empresa e nos seus registros." /></div>
      {rows.length ? <Table label="Operações auditadas">
        <thead><tr><th>Horário</th><th>Área</th><th>Operação</th><th>Origem</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td>{dateAndTime(row.created_at)}</td><td>{entities[row.entity] ?? "Sistema"}</td>
          <td>{auditLabels[row.action]}</td><td>{row.actor_id === ctx.user.id ? "Sua conta" : row.actor_id ? "Equipe" : "Sistema ou agendamento online"}</td></tr>)}</tbody>
      </Table> : <Empty icon={ClipboardList} title="Nenhuma operação registrada" />}
    </section><Pagination page={page} size={size} total={response.count ?? 0} path={base} filters={{ aba: selected }} /></>;
  } else {
    content = <>
      <BookingUrl slug={empresa} url={origin + "/agendar/" + empresa} active={ctx.company.booking_enabled} />
      <CompanySettings company={ctx.company} logo={publicLogo(ctx.company.logo_path)} integrations={integrationStatus()} />
      <section className="panel panel-pad install-hint">
        <SectionTitle icon={MonitorDown} title={"Instalar " + APP_NAME} />
        <p className="subtle">No menu do navegador, escolha instalar o aplicativo ou adicionar à tela de início.</p>
      </section>
    </>;
  }

  return <div className="page-stack">
    <PageTitle title="Configurações" description="Gerencie a empresa, a equipe e as automações." />
    <nav className="tabs" aria-label="Seções de configurações">{sections.map(section => <Link key={section.value} href={base + "?aba=" + section.value}
      className={selected === section.value ? "active" : ""} aria-current={selected === section.value ? "page" : undefined}>{section.name}</Link>)}</nav>
    {content}
  </div>;
}
