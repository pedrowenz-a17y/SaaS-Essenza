import { allRows, result, workspace } from "@/lib/server/data";
import { id } from "@/lib/validation";
import type { Appointment, Client, FinanceEntry } from "@/lib/models";

export async function GET(_request: Request, context: { params: Promise<{ empresa: string; id: string }> }) {
  const params = await context.params;
  const ctx = await workspace(params.empresa);
  if (!ctx.manager) return new Response("Acesso restrito.", { status: 403 });
  if (!id.safeParse(params.id).success) return new Response("Cliente não encontrada.", { status: 404 });
  const [clientResult, appointments] = await Promise.all([
    ctx.client.from("clients").select("*").eq("company_id", ctx.company.id).eq("id", params.id).maybeSingle(),
    allRows<Pick<Appointment,"id"|"title"|"status"|"notes"|"starts_at"|"ends_at"|"price_cents">>((from, to) =>
      ctx.client.from("appointments").select("id,title,status,notes,starts_at,ends_at,price_cents")
        .eq("company_id", ctx.company.id).eq("client_id", params.id).order("starts_at").order("id").range(from, to)),
  ]);
  const customer = result<Client | null>(clientResult);
  if (!customer) return new Response("Cliente não encontrada.", { status: 404 });
  const files = await Promise.all(appointments.map(async item => {
    const [payment, reminders] = await Promise.all([
      ctx.client.from("finance_entries").select("amount_cents,occurred_on,settled_on,method").eq("company_id", ctx.company.id).eq("appointment_id", item.id).maybeSingle(),
      ctx.client.from("reminder_jobs").select("channel,purpose,run_at,status,finished_at").eq("appointment_id", item.id).eq("company_id", ctx.company.id).order("run_at"),
    ]);
    return { ...item, pagamento: result<FinanceEntry | null>(payment), lembretes: result(reminders) };
  }));
  return new Response(JSON.stringify({ cliente: customer, atendimentos: files }, null, 2), { headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="essenza-dados-cliente.json"',
    "Cache-Control": "private, no-store",
  } });
}
