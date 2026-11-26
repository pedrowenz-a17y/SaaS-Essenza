import { Agenda } from "@/components/agenda";
import { agendaColumns, allRows, result, roster, workspace } from "@/lib/server/data";
import type { Appointment, Client, Service } from "@/lib/models";
import { id } from "@/lib/validation";

export const metadata = { title: "Agenda" };

export default async function AgendaPage({ params, searchParams }: {
  params: Promise<{ empresa: string }>; searchParams: Promise<{ novo?: string; atendimento?: string }>;
}) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  const query = await searchParams;
  const selected = id.safeParse(query.atendimento);
  const [members, clients, services, event] = await Promise.all([
    roster(ctx),
    ctx.scheduler ? allRows<Pick<Client, "id" | "name" | "phone">>((from, to) => ctx.client.from("clients").select("id,name,phone")
      .eq("company_id", ctx.company.id).order("name").order("id").range(from, to)) : [],
    ctx.scheduler ? allRows<Service>((from, to) => ctx.client.from("services")
      .select("id,name,price_cents,color,duration_minutes,active,service_professionals(member_id)")
      .eq("company_id", ctx.company.id).order("name").order("id").range(from, to)) : [],
    selected.success ? ctx.client.from("appointments").select(agendaColumns).eq("company_id", ctx.company.id).eq("id", selected.data).maybeSingle() : null,
  ]);
  return <Agenda slug={empresa} timezone={ctx.company.timezone} workHours={ctx.company.working_hours} allowEdit={ctx.scheduler}
    professionals={members} clients={clients} services={services} initialEvent={event ? result<Appointment | null>(event) : null}
    openCreate={ctx.scheduler && query.novo === "1"} />;
}
