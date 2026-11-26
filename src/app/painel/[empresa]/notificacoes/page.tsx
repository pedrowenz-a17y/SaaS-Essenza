import Link from "next/link";
import { Bell, CalendarDays, Cake, CircleDollarSign, Package, type LucideIcon } from "lucide-react";
import { Pagination, pageNumber } from "@/components/pagination";
import { ActionForm } from "@/components/ui/form";
import { Badge, Empty, PageTitle } from "@/components/ui/primitives";
import { dateAndTime, notificationLabels } from "@/lib/format";
import type { Notification } from "@/lib/models";
import { result, workspace } from "@/lib/server/data";
import { workspaceAction } from "@/lib/server/workspace-actions";

export const metadata = { title: "Notificações" };

const inventory = ["low_stock","out_of_stock","expiring","expired","high_usage"];
const schedule = ["new_booking","cancelled","rescheduled","confirmed","upcoming"];

function source(item: Notification, base: string): { href?: string; icon: LucideIcon; color: string } {
  const key = item.entity_id;
  if (inventory.includes(item.kind)) return { href: base + "/estoque?produto=" + key, icon: Package, color: item.kind === "out_of_stock" ? "red" : "amber" };
  if (schedule.includes(item.kind)) return { href: base + "/agenda?atendimento=" + key, icon: CalendarDays, color: "" };
  if (item.kind === "birthday") return { href: base + "/clientes/" + key, icon: Cake, color: "" };
  if (item.kind === "pending_payment") return { href: base + "/financeiro?tipo=pending", icon: CircleDollarSign, color: "green" };
  return { icon: Bell, color: "" };
}

export default async function Notifications({ params, searchParams }: {
  params: Promise<{ empresa: string }>; searchParams: Promise<{ filtro?: string; pagina?: string }>;
}) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  const query = await searchParams;
  const onlyUnread = query.filtro === "nao-lidas";
  const page = pageNumber(query.pagina);
  const size = 20;
  const base = "/painel/" + empresa;
  const path = base + "/notificacoes";
  let list = ctx.client.from("notification_list").select("*", { count: "exact" }).eq("company_id", ctx.company.id);
  if (onlyUnread) list = list.eq("is_read", false);
  const response = await list.order("created_at", { ascending: false }).order("id").range((page - 1) * size, page * size - 1);
  const rows = result<Notification[]>(response);

  return <div className="page-stack">
    <PageTitle title="Notificações" description="Acompanhe os avisos da sua operação.">
      <ActionForm action={workspaceAction.bind(null, empresa, "notifications.read")} compact label="Marcar todas como lidas" variant="secondary" />
    </PageTitle>
    <nav className="tabs" aria-label="Filtro de notificações">
      <Link href={path} className={!onlyUnread ? "active" : ""} aria-current={!onlyUnread ? "page" : undefined}>Todas</Link>
      <Link href={path + "?filtro=nao-lidas"} className={onlyUnread ? "active" : ""} aria-current={onlyUnread ? "page" : undefined}>Não lidas</Link>
    </nav>
    <section className="panel panel-pad">
      {rows.length ? <div className="data-list">{rows.map(item => {
        const { href, icon: Icon, color } = source(item, base);
        return <div className="data-row" key={item.id}>
          <span className={"row-icon " + color}><Icon size={17} /></span>
          <div className="row-detail">
            <strong>{href && item.entity_id ? <Link href={href} className="text-link">{item.message}</Link> : item.message}</strong>
            <small>{notificationLabels[item.kind] ?? "Notificação"} · {dateAndTime(item.created_at)}</small>
          </div>
          {item.is_read ? <Badge>Lida</Badge> : <ActionForm action={workspaceAction.bind(null, empresa, "notifications.read")} compact label="Marcar como lida" variant="ghost">
            <input type="hidden" name="id" value={item.id} />
          </ActionForm>}
        </div>;
      })}</div> : <Empty icon={Bell} title={onlyUnread ? "Tudo em dia" : "Nenhuma notificação"} description={onlyUnread ? "Você já leu todos os avisos." : "Novos avisos aparecem aqui quando houver atividade na empresa."} />}
    </section>
    <Pagination page={page} size={size} total={response.count ?? 0} path={path} filters={{ filtro: onlyUnread ? "nao-lidas" : "" }} />
  </div>;
}
