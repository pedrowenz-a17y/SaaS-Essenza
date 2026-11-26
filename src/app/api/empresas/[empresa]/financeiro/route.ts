import { allRows, workspace } from "@/lib/server/data";
import { isoDate } from "@/lib/validation";
import type { FinanceEntry } from "@/lib/models";
import { csv } from "@/lib/csv";
import { paymentMethods } from "@/lib/format";

export async function GET(request: Request, context: { params: Promise<{ empresa: string }> }) {
  const ctx = await workspace((await context.params).empresa);
  if (!ctx.manager) return new Response("Acesso restrito.", { status: 403 });
  const query = new URL(request.url).searchParams;
  const from = isoDate.safeParse(query.get("inicio"));
  const to = isoDate.safeParse(query.get("fim"));
  if (!from.success || !to.success || from.data > to.data) return new Response("Período inválido.", { status: 400 });

  const entries = await allRows<FinanceEntry>((start, end) => ctx.client.from("finance_entries").select("*")
    .eq("company_id", ctx.company.id).or([
      "and(occurred_on.gte." + from.data + ",occurred_on.lte." + to.data + ")",
      "and(settled_on.gte." + from.data + ",settled_on.lte." + to.data + ")",
    ].join(",")).order("occurred_on").order("id").range(start, end));
  return new Response(csv([
    ["Data", "Tipo", "Descrição", "Categoria", "Valor (BRL)", "Pagamento", "Forma"],
    ...entries.map(entry => [entry.occurred_on, entry.kind === "income" ? "Receita" : "Despesa", entry.description, entry.category,
      (entry.amount_cents / 100).toFixed(2).replace(".", ","), entry.settled_on ?? "Pendente", entry.method ? paymentMethods[entry.method] : ""]),
  ]), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="essenza-financeiro-' + from.data + '.csv"',
    "Cache-Control": "private, no-store",
  } });
}
