import Link from "next/link";
import {
  Bell, CalendarDays, CalendarPlus, ChartNoAxesColumn, CircleDollarSign, ClipboardList, Clock3, Globe,
  Package, Plus, Scissors, UserPlus, UsersRound, type LucideIcon,
} from "lucide-react";
import { AttendanceChart } from "@/components/charts";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Button, Empty, SectionTitle } from "@/components/ui/primitives";
import { hour, initial, local, money, quantity, shortDate, statuses } from "@/lib/format";
import type { Appointment, DashboardSummary, Notification, Product } from "@/lib/models";
import { agendaColumns, result, workspace } from "@/lib/server/data";

export const metadata = { title: "Visão geral" };

function Metric({ name, value, caption, icon: Icon, color, href }: {
  name: string; value: string | number; caption: string; icon: LucideIcon; color?: string; href: string;
}) {
  return <Link href={href} className="kpi panel"><span className="kpi-top"><span className={"kpi-icon " + (color ?? "")}><Icon size={18} /></span><span className="kpi-name">{name}</span></span>
    <strong className="kpi-value">{value}</strong><small className="kpi-caption">{caption}</small>
  </Link>;
}

export default async function Dashboard({ params, searchParams }: { params: Promise<{ empresa: string }>; searchParams: Promise<{ periodo?: string }> }) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  const base = "/painel/" + empresa;
  const days = (await searchParams).periodo === "30" ? 30 : 7;
  const now = local();
  const [summaryResponse, appointmentsResponse, notificationResponse, stockResponse] = await Promise.all([
    ctx.client.rpc("dashboard_summary", { p_company: ctx.company.id, p_days: days }),
    ctx.client.from("appointments").select(agendaColumns).eq("company_id", ctx.company.id).eq("kind", "appointment")
      .in("status", ["pending", "confirmed", "in_progress"]).gte("ends_at", now.toUTC().toISO()!).order("starts_at").limit(5),
    ctx.client.from("notification_list").select("*").eq("company_id", ctx.company.id).eq("is_read", false).order("created_at", { ascending: false }).limit(3),
    ctx.manager ? ctx.client.from("shopping_items").select("products(id,name,quantity,unit)").eq("company_id", ctx.company.id).order("created_at", { ascending: false }).limit(3) : null,
  ]);
  const summary = result<DashboardSummary>(summaryResponse);
  const upcoming = result<Appointment[]>(appointmentsResponse);
  const notifications = result<Notification[]>(notificationResponse);
  const stock = stockResponse ? result<{ products: Pick<Product, "id" | "name" | "quantity" | "unit"> | null }[]>(stockResponse) : [];
  const greeting = now.hour < 12 ? "Bom dia" : now.hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = ctx.member.name.split(/\s+/)[0];
  const todayText = summary.today ? "Você tem " + summary.today + (summary.today === 1 ? " atendimento hoje." : " atendimentos hoje.") : "Nenhum atendimento marcado para hoje.";
  const shortcuts = [
    { name: "Agenda", icon: CalendarPlus, url: base + "/agenda" + (ctx.scheduler ? "?novo=1" : "") },
    { name: ctx.scheduler ? "Cadastrar cliente" : "Clientes", icon: UserPlus, url: base + "/clientes" + (ctx.scheduler ? "?novo=1" : "") },
    { name: "Serviços", icon: Scissors, url: base + "/servicos" },
    ...(ctx.company.booking_enabled ? [{ name: "Agendamento online", icon: Globe, url: "/agendar/" + empresa }] : []),
  ];

  return <div className="dashboard"><AutoRefresh />
    <section className="hero">
      <h1>{greeting}, {firstName}!</h1><p>{todayText}</p>
      <Button asChild><Link href={base + "/agenda" + (ctx.scheduler ? "?novo=1" : "")}>{ctx.scheduler ? <Plus size={17} /> : <CalendarDays size={17} />}{ctx.scheduler ? "Novo agendamento" : "Abrir agenda"}</Link></Button>
    </section>
    <section className="kpi-grid" aria-label="Indicadores da empresa">
      <Metric name="Agendamentos de hoje" value={summary.today} caption={summary.confirmed + (summary.confirmed === 1 ? " confirmado" : " confirmados") + " · " + summary.pending + (summary.pending === 1 ? " pendente" : " pendentes")} icon={CalendarDays} href={base + "/agenda"} />
      <Metric name="Clientes cadastradas" value={summary.clients} caption="Ver cadastro de clientes" icon={UsersRound} color="lilac" href={base + "/clientes"} />
      {ctx.manager ? <>
        <Metric name="Faturamento do mês" value={money(summary.revenue_month)} caption={money(summary.revenue_today) + " recebido hoje"} icon={CircleDollarSign} color="green" href={base + "/financeiro"} />
        <Metric name="Estoque baixo" value={summary.low} caption={summary.out + (summary.out === 1 ? " produto esgotado" : " produtos esgotados")} icon={Package} color="amber" href={base + "/estoque?aba=compras"} />
      </> : <Metric name="Próximos atendimentos" value={upcoming[0] ? hour(upcoming[0].starts_at) : "—"} caption={upcoming[0]?.title ?? "Agenda sem atendimentos"} icon={Clock3} color="green" href={base + "/agenda"} />}
    </section>
    <div className="split-main">
      <section className="panel panel-pad chart-panel">
        <SectionTitle title="Atendimentos" icon={ChartNoAxesColumn}>
          <div className="segmented" aria-label="Período do gráfico">
            {[7,30].map(period => <Link key={period} href={base + "?periodo=" + period} scroll={false} className={period === days ? "active" : ""} aria-current={period === days ? "true" : undefined}>{period} dias</Link>)}
          </div>
        </SectionTitle>
        <AttendanceChart data={summary.series} />
      </section>
      <section className="panel panel-pad">
        <SectionTitle title="Próximos atendimentos" icon={Clock3} />
        {upcoming.length ? <div className="data-list">{upcoming.map((appointment, index) => {
          const name = appointment.clients?.name ?? "Cliente removida";
          return <Link href={base + "/agenda?atendimento=" + appointment.id} key={appointment.id} className="data-row">
            <span className={"avatar " + ["", "avatar-lilac", "avatar-green", "avatar-amber"][index % 4]}>{initial(name)}</span>
            <span className="row-detail"><strong>{name}</strong><small>{appointment.title}</small></span>
            <span className="row-detail" style={{ flex: "none", textAlign: "right" }}><strong>{hour(appointment.starts_at)}</strong><small>{local(appointment.starts_at).hasSame(now, "day") ? "Hoje" : shortDate(appointment.starts_at)}</small></span>
          </Link>;
        })}</div> : <Empty icon={CalendarDays} title="Nenhum horário próximo" description="Os próximos agendamentos aparecem aqui." />}
        {upcoming.length > 0 && <Link className="text-link subtle" href={base + "/agenda"}>Ver agenda</Link>}
      </section>
    </div>
    <div className="split-main">
      <div className="split-even">
        <section className="panel panel-pad">
          <SectionTitle title="Estoque e reposição" icon={Package} />
          {ctx.manager ? (stock.some(row => row.products) ? <div className="data-list">{stock.map(({ products: item }) => item && <div className="data-row" key={item.id}>
            <span className={"row-icon " + (item.quantity <= 0 ? "red" : "amber")}><Package size={16} /></span>
            <span className="row-detail"><strong>{item.name}</strong><small>{quantity(item.quantity)} {item.unit}</small></span>
            <Badge tone={item.quantity <= 0 ? "red" : "amber"}>{item.quantity <= 0 ? "Esgotado" : "Baixo"}</Badge>
          </div>)}</div> : <Empty icon={Package} title="Sem reposições pendentes" />) : <Empty icon={ClipboardList} title="Controle de materiais" description="Ajuste o consumo dos materiais ao concluir um atendimento." />}
          {ctx.manager && <Link href={base + "/estoque?aba=compras"} className="text-link subtle">Lista de compras</Link>}
        </section>
        <section className="panel panel-pad">
          <SectionTitle title="Notificações" icon={Bell} />
          {notifications.length ? <div className="data-list">{notifications.map(notification => <div key={notification.id} className="data-row">
            <div className="row-detail"><strong>{notification.message}</strong><small>{shortDate(notification.created_at)} · {hour(notification.created_at)}</small></div>
          </div>)}</div> : <Empty icon={Bell} title="Tudo em dia" />}
          <Link href={base + "/notificacoes"} className="text-link subtle">Ver todas</Link>
        </section>
      </div>
      <section className="panel panel-pad">
        <SectionTitle title="Acesso rápido" icon={ClipboardList} />
        <div className="shortcut-grid">{shortcuts.map(shortcut => <Link href={shortcut.url} className="shortcut" key={shortcut.name}><shortcut.icon size={16} />{shortcut.name}</Link>)}</div>
        {upcoming[0] && <div className="data-row"><span className="row-detail"><strong>Próximo horário</strong><small>{upcoming[0].title} · {hour(upcoming[0].starts_at)}</small></span><Badge tone={upcoming[0].status}>{statuses[upcoming[0].status]}</Badge></div>}
      </section>
    </div>
  </div>;
}
