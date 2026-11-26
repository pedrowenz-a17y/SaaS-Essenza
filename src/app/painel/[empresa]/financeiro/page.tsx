import { notFound } from "next/navigation";
import { Banknote, ChartNoAxesCombined, CircleDollarSign, Download, Package, Receipt, Scissors, Wallet } from "lucide-react";
import { FinanceChart } from "@/components/charts";
import { FinanceEditor, SettlementEditor } from "@/components/finance-editor";
import { Pagination, pageNumber } from "@/components/pagination";
import { ActionForm } from "@/components/ui/form";
import { Badge, Button, Empty, Input, PageTitle, SectionTitle, Select, Table } from "@/components/ui/primitives";
import { dayLabel, local, money, paymentMethods } from "@/lib/format";
import type { FinanceEntry, FinanceSummary } from "@/lib/models";
import { result, workspace } from "@/lib/server/data";
import { workspaceAction } from "@/lib/server/workspace-actions";

export const metadata = { title: "Financeiro" };

export default async function Finance({ params, searchParams }: {
  params: Promise<{ empresa: string }>; searchParams: Promise<{ mes?: string; tipo?: string; pagina?: string }>;
}) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  if (!ctx.manager) notFound();
  const query = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(query.mes ?? "") ? local(query.mes + "-01") : local();
  const date = month.isValid ? month : local();
  const start = date.startOf("month").toISODate()!;
  const end = date.endOf("month").toISODate()!;
  const kind = ["income","expense","pending"].find(item => item === query.tipo) ?? "";
  const page = pageNumber(query.pagina);
  const size = 20;
  const base = "/painel/" + empresa + "/financeiro";
  let list = ctx.client.from("finance_entries").select("*", { count: "exact" }).eq("company_id", ctx.company.id)
    .or("and(occurred_on.gte." + start + ",occurred_on.lte." + end + "),and(settled_on.gte." + start + ",settled_on.lte." + end + ")");
  if (kind === "pending") list = list.is("settled_on", null);
  else if (kind) list = list.eq("kind", kind);
  const [summaryResponse, listResponse] = await Promise.all([
    ctx.client.rpc("finance_summary", { p_company: ctx.company.id, p_first: start, p_last: end }),
    list.order("occurred_on", { ascending: false }).order("id").range((page - 1) * size, page * size - 1),
  ]);
  const summary = result<FinanceSummary>(summaryResponse);
  const entries = result<FinanceEntry[]>(listResponse);
  const csvUrl = "/api/empresas/" + empresa + "/financeiro?" + new URLSearchParams({ inicio: start, fim: end }).toString();
  const cards = [
    { title: "Recebido", amount: summary.income, icon: Banknote, tone: "green" },
    { title: "Receitas pendentes", amount: summary.pending, icon: Receipt, tone: "amber" },
    { title: "Despesas pagas", amount: summary.expenses, icon: Wallet, tone: "lilac" },
    { title: "Lucro estimado", amount: summary.profit, icon: CircleDollarSign, tone: "" },
  ];

  return <div className="page-stack">
    <PageTitle title="Financeiro" description="Acompanhe recebimentos, pagamentos pendentes e despesas.">
      <Button asChild variant="secondary"><a href={csvUrl} download><Download size={17} />Exportar CSV</a></Button><FinanceEditor slug={empresa} />
    </PageTitle>
    <form className="filters">
      <Input name="mes" type="month" aria-label="Mês de referência" defaultValue={start.slice(0, 7)} />
      <Select name="tipo" aria-label="Tipo de lançamento" defaultValue={kind}><option value="">Todos os lançamentos</option>
        <option value="income">Receitas</option><option value="expense">Despesas</option><option value="pending">Pendentes</option>
      </Select>
      <Button type="submit" variant="secondary">Filtrar</Button>
    </form>
    <section className="kpi-grid" aria-label="Resumo do mês">{cards.map(card => <div className="kpi panel" key={card.title}>
      <div className="kpi-top"><span className={"kpi-icon " + card.tone}><card.icon size={18} /></span><span className="kpi-name">{card.title}</span></div>
      <strong className="kpi-value">{money(card.amount)}</strong>
    </div>)}</section>
    <div className="split-main">
      <section className="panel panel-pad">
        <SectionTitle icon={ChartNoAxesCombined} title="Fluxo de caixa" description="O lucro estimado considera os recebimentos e as despesas pagas registradas." />
        <FinanceChart data={summary.series} />
        <div className="chart-legend"><span><i className="legend-dot" />Recebido</span><span><i className="legend-dot expense" />Despesas pagas</span></div>
      </section>
      <section className="panel panel-pad"><SectionTitle icon={CircleDollarSign} title="Faturamento atual" />
        <dl className="summary-lines">
          <div><dt>Recebido hoje</dt><dd>{money(summary.daily)}</dd></div>
          <div><dt>Recebido nesta semana</dt><dd>{money(summary.weekly)}</dd></div>
          <div><dt>Recebido neste mês</dt><dd>{money(summary.monthly)}</dd></div>
          <div><dt><Package size={15} className="inline mr-1" />Compras no mês selecionado</dt><dd>{money(summary.products)}</dd></div>
        </dl>
      </section>
    </div>
    <section className="panel panel-pad">
      <SectionTitle icon={Scissors} title="Serviços mais rentáveis" description="Receita recebida menos o custo registrado dos materiais utilizados." />
      {summary.ranking.length ? <div className="data-list">{summary.ranking.map(row => <div key={row.title} className="data-row">
        <div className="row-detail"><strong>{row.title}</strong><small>{money(row.paid)} recebidos · {money(row.cost)} em materiais</small></div>
        <Badge tone={row.margin >= 0 ? "green" : "red"}>{money(row.margin)}</Badge>
      </div>)}</div> : <Empty icon={Scissors} title="Ainda não há serviços pagos no período" />}
    </section>
    <section className="panel">
      <div className="list-header"><SectionTitle icon={Receipt} title="Lançamentos" /></div>
      {entries.length ? <Table label="Lançamentos financeiros">
        <thead><tr><th>Lançamento</th><th>Descrição</th><th>Valor</th><th>Pagamento</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{entries.map(entry => <tr key={entry.id}>
          <td>{dayLabel(entry.occurred_on)}</td><td><strong>{entry.description}</strong><small>{entry.category || (entry.kind === "income" ? "Receita" : "Despesa")}</small></td>
          <td><Badge tone={entry.kind === "income" ? "green" : "rose"}>{entry.kind === "expense" ? "− " : "+ "}{money(entry.amount_cents)}</Badge></td>
          <td>{entry.settled_on ? <><strong>{entry.method ? paymentMethods[entry.method] : "Pago"}</strong><small>{dayLabel(entry.settled_on)}</small></> : <Badge tone="amber">Pendente</Badge>}</td>
          <td><div className="cell-actions">
            <SettlementEditor slug={empresa} entry={entry} />
            {!entry.appointment_id && !entry.movement_id && <>
              <FinanceEditor slug={empresa} entry={entry} />
              <ActionForm action={workspaceAction.bind(null, empresa, "finance.delete")} compact label="Excluir" variant="danger" confirm="Excluir este lançamento financeiro?">
                <input type="hidden" name="id" value={entry.id} />
              </ActionForm>
            </>}
          </div></td>
        </tr>)}</tbody>
      </Table> : <Empty icon={Receipt} title="Nenhum lançamento no período" description="Crie uma receita ou despesa, ou selecione outro mês." />}
    </section>
    <Pagination page={page} size={size} total={listResponse.count ?? 0} path={base} filters={{ mes: start.slice(0, 7), tipo: kind }} />
  </div>;
}
