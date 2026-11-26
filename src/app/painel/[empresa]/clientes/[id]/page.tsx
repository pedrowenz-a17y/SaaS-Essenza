import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ClipboardList, Download, UserRound } from "lucide-react";
import { ClientEditor, EraseClient } from "@/components/client-editor";
import { Pagination, pageNumber } from "@/components/pagination";
import { Badge, Button, Empty, PageTitle, SectionTitle, Table } from "@/components/ui/primitives";
import { dateAndTime, dayLabel, money, phoneDisplay, statuses } from "@/lib/format";
import type { Appointment, Client } from "@/lib/models";
import { result, workspace } from "@/lib/server/data";
import { id } from "@/lib/validation";

export const metadata = { title: "Ficha da cliente" };

export default async function ClientPage({ params, searchParams }: {
  params: Promise<{ empresa: string; id: string }>; searchParams: Promise<{ pagina?: string }>;
}) {
  const url = await params;
  const ctx = await workspace(url.empresa);
  if (!id.safeParse(url.id).success) notFound();
  const base = "/painel/" + url.empresa;
  const page = pageNumber((await searchParams).pagina);
  const size = 20;
  const [client, appointments, paid] = await Promise.all([
    ctx.client.from("client_directory").select("*").eq("company_id", ctx.company.id).eq("id", url.id).maybeSingle(),
    ctx.client.from("appointments").select("id,title,starts_at,status,price_cents,finance_entries(amount_cents,settled_on)", { count: "exact" })
      .eq("company_id", ctx.company.id).eq("client_id", url.id).order("starts_at", { ascending: false }).order("id").range((page - 1) * size, page * size - 1),
    ctx.manager ? ctx.client.rpc("client_total_paid", { p_company: ctx.company.id, p_client: url.id }) : null,
  ]);
  const customer = result<Client | null>(client);
  if (!customer) notFound();
  const visits = result<(Pick<Appointment, "id"|"title"|"starts_at"|"status"|"price_cents"> & { finance_entries: { amount_cents: number; settled_on: string | null } | null })[]>(appointments);

  return <div className="page-stack">
    <Link className="text-link subtle justify-self-start" href={base + "/clientes"}>Todas as clientes</Link>
    <PageTitle title={customer.name} description="Ficha da cliente">
      {ctx.scheduler && <ClientEditor slug={url.empresa} client={customer} />}
    </PageTitle>
    <div className="split-even">
      <section className="panel panel-pad"><SectionTitle icon={UserRound} title="Dados de contato" />
        <dl className="summary-lines">
          <div><dt>Telefone</dt><dd>{phoneDisplay(customer.phone)}</dd></div>
          <div><dt>WhatsApp</dt><dd>{customer.whatsapp ? phoneDisplay(customer.whatsapp) : "—"}</dd></div>
          <div><dt>E-mail</dt><dd>{customer.email ?? "—"}</dd></div>
          <div><dt>Nascimento</dt><dd>{customer.birthday ? dayLabel(customer.birthday) : "—"}</dd></div>
          <div><dt>Mensagens autorizadas</dt><dd>
            {[customer.email_consented_at && "E-mail", customer.whatsapp_consented_at && "WhatsApp"].filter(Boolean).join(" e ") || "Nenhuma"}
          </dd></div>
        </dl>
      </section>
      <section className="panel panel-pad"><SectionTitle icon={ClipboardList} title="Preferências e observações" />
        <dl className="summary-lines">
          <div><dt>Preferências</dt><dd className="whitespace-pre-wrap">{customer.preferences || "—"}</dd></div>
          <div><dt>Observações</dt><dd className="whitespace-pre-wrap">{customer.notes || "—"}</dd></div>
          <div><dt>Próximo atendimento</dt><dd>{customer.next_visit ? dateAndTime(customer.next_visit) : "Sem agendamento"}</dd></div>
          {paid && <div><dt>Total pago</dt><dd>{money(result<number>(paid))}</dd></div>}
        </dl>
      </section>
    </div>
    <section className="panel">
      <div className="list-header"><SectionTitle icon={CalendarDays} title="Histórico de atendimentos" /></div>
      {visits.length ? <Table label="Histórico de atendimentos">
        <thead><tr><th>Procedimento</th><th>Horário</th><th>Status</th><th>Valor</th>{ctx.manager && <th>Recebido</th>}</tr></thead>
        <tbody>{visits.map(visit => <tr key={visit.id}>
          <td><Link className="text-link" href={base + "/agenda?atendimento=" + visit.id}>{visit.title}</Link></td>
          <td>{dateAndTime(visit.starts_at)}</td><td><Badge tone={visit.status}>{statuses[visit.status]}</Badge></td><td>{money(visit.price_cents)}</td>
          {ctx.manager && <td>{visit.finance_entries?.settled_on ? money(visit.finance_entries.amount_cents) : visit.finance_entries ? "Pendente" : "—"}</td>}
        </tr>)}</tbody>
      </Table> : <Empty icon={CalendarDays} title="Sem atendimentos registrados" description="Os agendamentos vinculados à cliente aparecem aqui." />}
    </section>
    <Pagination page={page} size={size} total={appointments.count ?? 0} path={base + "/clientes/" + url.id} />
    {ctx.manager && <section className="panel panel-pad settings-section">
      <SectionTitle title="Dados pessoais" description="Exporte a ficha ou atenda uma solicitação de exclusão." />
      <div className="title-actions"><Button asChild size="small" variant="secondary"><a href={"/api/empresas/" + url.empresa + "/clientes/" + url.id} download><Download size={16} />Exportar dados</a></Button>
        <EraseClient slug={url.empresa} client={customer} />
      </div>
    </section>}
  </div>;
}
