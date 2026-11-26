import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Archive, ClipboardList, Package, Search, ShoppingBasket } from "lucide-react";
import { ProductEditor, MovementEditor } from "@/components/stock-editor";
import { Pagination, pageNumber } from "@/components/pagination";
import { ActionForm } from "@/components/ui/form";
import { Badge, Button, Empty, Input, PageTitle, Select, Table } from "@/components/ui/primitives";
import type { Product, StockMovement } from "@/lib/models";
import { dateAndTime, dayLabel, local, money, movements, quantity } from "@/lib/format";
import { result, workspace } from "@/lib/server/data";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { id } from "@/lib/validation";

export const metadata = { title: "Estoque" };

const tabs = [
  { value: "produtos", title: "Produtos" }, { value: "compras", title: "Lista de compras" },
  { value: "movimentacoes", title: "Movimentações" }, { value: "arquivados", title: "Arquivados" },
];

function StockBadge({ item }: { item: Product }) {
  return <Badge tone={item.quantity <= 0 ? "red" : item.quantity <= item.minimum ? "amber" : "green"}>
    {item.quantity <= 0 ? "Esgotado" : item.quantity <= item.minimum ? "Estoque baixo" : "Suficiente"}
  </Badge>;
}

export default async function Stock({ params, searchParams }: {
  params: Promise<{ empresa: string }>; searchParams: Promise<{ aba?: string; q?: string; status?: string; produto?: string; pagina?: string; novo?: string }>;
}) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  if (!ctx.manager) notFound();
  const query = await searchParams;
  const tab = tabs.find(item => item.value === query.aba)?.value ?? "produtos";
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const health = ["ok","low","out"].includes(query.status ?? "") ? query.status : undefined;
  const product = id.safeParse(query.produto);
  const page = pageNumber(query.pagina);
  const size = 20;
  const from = (page - 1) * size;
  const to = page * size - 1;
  const base = "/painel/" + empresa + "/estoque";
  let content;
  let count = 0;

  if (tab === "compras") {
    const response = await ctx.client.from("shopping_items").select("bought_at,products(*)", { count: "exact" })
      .eq("company_id", ctx.company.id).order("bought_at", { nullsFirst: true }).order("product_id").range(from, to);
    count = response.count ?? 0;
    const rows = result<{ bought_at: string | null; products: Product | null }[]>(response).filter(row => row.products);
    content = rows.length ? <Table label="Lista de compras">
      <thead><tr><th>Produto</th><th>Saldo / mínimo</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
      <tbody>{rows.map(row => {
        const item = row.products!;
        return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.supplier || item.category || item.unit}</small></td>
          <td>{quantity(item.quantity)} / {quantity(item.minimum)} {item.unit}</td>
          <td>{row.bought_at ? <Badge tone="green">Comprado</Badge> : <StockBadge item={item} />}</td>
          <td><div className="cell-actions">
            <ActionForm action={workspaceAction.bind(null, empresa, "stock.buy")} compact variant="secondary" label={row.bought_at ? "Desmarcar" : "Marcar comprado"}>
              <input type="hidden" name="id" value={item.id} /><input type="hidden" name="bought" value={String(!row.bought_at)} />
            </ActionForm>
            <MovementEditor slug={empresa} product={item} replenish />
          </div></td></tr>;
      })}</tbody>
    </Table> : <Empty icon={ShoppingBasket} title="Nada para repor" description="Os produtos abaixo do mínimo ou esgotados aparecem aqui automaticamente." />;
  } else if (tab === "movimentacoes") {
    let request = ctx.client.from("stock_movements").select("*,products(name,unit)", { count: "exact" }).eq("company_id", ctx.company.id);
    if (product.success) request = request.eq("product_id", product.data);
    const response = await request.order("created_at", { ascending: false }).order("id").range(from, to);
    count = response.count ?? 0;
    const rows = result<StockMovement[]>(response);
    content = rows.length ? <Table label="Movimentações de estoque">
      <thead><tr><th>Data</th><th>Produto</th><th>Movimentação</th><th>Variação</th><th>Saldo após</th><th>Observações</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{dateAndTime(row.created_at)}</td><td><strong>{row.products?.name}</strong></td><td>{movements[row.kind]}</td>
        <td><Badge tone={row.quantity_delta > 0 ? "green" : "amber"}>{row.quantity_delta > 0 && "+"}{quantity(row.quantity_delta)} {row.products?.unit}</Badge></td>
        <td>{quantity(row.quantity_after)} {row.products?.unit}</td><td>{row.notes || "—"}</td>
      </tr>)}</tbody>
    </Table> : <Empty icon={ClipboardList} title="Sem movimentações" description="Entradas, saídas, ajustes e consumos aparecem neste histórico." />;
  } else {
    let request = ctx.client.from("inventory_list").select("*", { count: "exact" }).eq("company_id", ctx.company.id).eq("active", tab !== "arquivados");
    if (search) request = request.ilike("name", "%" + search.replace(/[%_\\]/g, "\\$&") + "%");
    if (health) request = request.eq("health", health);
    if (product.success) request = request.eq("id", product.data);
    const response = await request.order("name").order("id").range(from, to);
    count = response.count ?? 0;
    const rows = result<Product[]>(response);
    const photos = rows.flatMap(item => item.photo_path ? [item.photo_path] : []);
    const [forecast, signed] = await Promise.all([
      rows.length ? ctx.client.rpc("inventory_forecast", { p_company: ctx.company.id, p_products: rows.map(item => item.id) }) : null,
      photos.length ? ctx.client.storage.from("product-photos").createSignedUrls(photos, 900) : null,
    ]);
    const estimates = new Map(forecast ? result<{ product_id: string; days_remaining: number | null }[]>(forecast).map(item => [item.product_id, item.days_remaining]) : []);
    const urls = new Map(signed?.data?.map(item => [item.path, item.error ? undefined : item.signedUrl]));
    const today = local().toISODate()!;
    const expiryLimit = local().plus({ days: 30 }).toISODate()!;
    content = <>
      <form className="list-header filters">
        <input type="hidden" name="aba" value={tab} />
        <label className="search-box"><Search size={16} /><Input name="q" aria-label="Nome do produto" placeholder="Buscar produto" defaultValue={search} /></label>
        <Select name="status" aria-label="Status do estoque" defaultValue={health ?? ""}><option value="">Todos os níveis de estoque</option>
          <option value="ok">Suficiente</option><option value="low">Estoque baixo</option><option value="out">Esgotado</option>
        </Select>
        <Button type="submit" variant="secondary">Filtrar</Button>
        {product.success && <Button asChild variant="ghost"><Link href={base}>Limpar produto</Link></Button>}
      </form>
      {rows.length ? <Table label="Produtos no estoque">
        <thead><tr><th>Produto</th><th>Saldo</th><th>Validade</th><th>Previsão</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{rows.map(item => {
          const estimate = estimates.get(item.id);
          const photo = item.photo_path ? urls.get(item.photo_path) : undefined;
          return <tr key={item.id}>
            <td><div className="cell-person">
              {photo ? <Image src={photo} alt="" width={36} height={36} className="image-thumb" unoptimized /> : <span className="row-icon"><Package size={16} /></span>}
              <div><strong>{item.name}</strong><small>{[item.category, item.brand].filter(Boolean).join(" · ") || money(item.cost_cents) + " por " + item.unit}</small>
              {item.location && <small>{item.location}</small>}</div>
            </div></td>
            <td><strong>{quantity(item.quantity)} {item.unit}</strong><small>Mínimo {quantity(item.minimum)}</small><StockBadge item={item} /></td>
            <td>{item.expires_on ? <><span>{dayLabel(item.expires_on)}</span>{item.expires_on <= expiryLimit && <small><Badge tone={item.expires_on < today ? "red" : "amber"}>{item.expires_on < today ? "Vencido" : "Vence em breve"}</Badge></small>}</> : "—"}</td>
            <td>{estimate === null || estimate === undefined ? <small>Histórico insuficiente</small> :
              <Badge tone={estimate < 7 ? "amber" : "green"}>{estimate < 1 ? "Menos de um dia" : "≈ " + quantity(estimate) + " dias"}</Badge>}</td>
            <td><div className="cell-actions">
              {item.active && <MovementEditor slug={empresa} product={item} />}
              <ProductEditor slug={empresa} product={{ ...item, photo_url: photo ?? undefined }} />
              <ActionForm action={workspaceAction.bind(null, empresa, "product.active")} compact variant="ghost" label={item.active ? "Arquivar" : "Reativar"}
                confirm={item.active ? "Arquivar este produto?" : undefined}>
                <input type="hidden" name="id" value={item.id} /><input type="hidden" name="active" value={String(!item.active)} />
              </ActionForm>
            </div><div className="cell-actions mt-1"><Link className="text-link subtle" href={base + "?aba=movimentacoes&produto=" + item.id}>Histórico</Link></div></td>
          </tr>;
        })}</tbody>
      </Table> : <Empty icon={tab === "arquivados" ? Archive : Package} title={search || health ? "Nenhum produto encontrado" : tab === "arquivados" ? "Nenhum produto arquivado" : "Cadastre seu primeiro produto"} />}
    </>;
  }

  return <div className="page-stack">
    <PageTitle title="Estoque" description="Produtos, consumo e reposição em um só lugar."><ProductEditor slug={empresa} initiallyOpen={query.novo === "1"} /></PageTitle>
    <nav className="tabs" aria-label="Áreas do estoque">{tabs.map(item => <Link key={item.value} href={base + "?aba=" + item.value}
      className={tab === item.value ? "active" : ""} aria-current={tab === item.value ? "page" : undefined}>{item.title}</Link>)}</nav>
    <section className="panel">{content}</section>
    <Pagination page={page} size={size} total={count} path={base} filters={{
      aba: tab, ...(search ? { q: search } : {}), ...(health ? { status: health } : {}), ...(product.success ? { produto: product.data } : {}),
    }} />
  </div>;
}
