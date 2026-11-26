import Link from "next/link";
import { Scissors } from "lucide-react";
import { ServiceEditor } from "@/components/service-editor";
import { ActionForm } from "@/components/ui/form";
import { Badge, Empty, PageTitle, Table } from "@/components/ui/primitives";
import { allRows, roster, workspace } from "@/lib/server/data";
import { workspaceAction } from "@/lib/server/workspace-actions";
import { duration, money } from "@/lib/format";
import type { Product, Service } from "@/lib/models";

export const metadata = { title: "Serviços" };

export default async function Services({ params, searchParams }: { params: Promise<{ empresa: string }>; searchParams: Promise<{ novo?: string; aba?: string }> }) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  const query = await searchParams;
  const archived = ctx.manager && query.aba === "arquivados";
  const base = "/painel/" + empresa + "/servicos";
  const [services, products, members] = await Promise.all([
    allRows<Service>((from, to) => ctx.client.from("services").select("*,service_materials(product_id,quantity),service_professionals(member_id)")
      .eq("company_id", ctx.company.id).eq("active", !archived).order("name").order("id").range(from, to)),
    ctx.manager ? allRows<Product>((from, to) => ctx.client.from("products").select("id,name,unit,cost_cents,active")
      .eq("company_id", ctx.company.id).order("name").order("id").range(from, to)) : [],
    roster(ctx),
  ]);
  const costs = new Map(products.map(product => [product.id, product.cost_cents]));

  return <div className="page-stack">
    <PageTitle title="Serviços" description="Procedimentos, preços, profissionais e materiais.">
      {ctx.manager && <ServiceEditor slug={empresa} products={products} members={members} initiallyOpen={query.novo === "1"} />}
    </PageTitle>
    {ctx.manager && <nav className="tabs" aria-label="Status dos serviços">
      <Link href={base} className={!archived ? "active" : ""} aria-current={!archived ? "page" : undefined}>Ativos</Link>
      <Link href={base + "?aba=arquivados"} className={archived ? "active" : ""} aria-current={archived ? "page" : undefined}>Arquivados</Link>
    </nav>}
    <section className="panel">
      {services.length ? <Table label="Catálogo de serviços">
        <thead><tr><th>Serviço</th><th>Duração</th><th>Preço</th>{ctx.manager && <><th>Custo de materiais</th><th>Margem estimada</th><th><span className="sr-only">Ações</span></th></>}</tr></thead>
        <tbody>{services.map(service => {
          const cost = Math.round(service.service_materials.reduce((total, material) => total + (costs.get(material.product_id) ?? 0) * material.quantity, 0));
          const assigned = members.filter(member => member.active && member.bookable && service.service_professionals.some(row => row.member_id === member.id));
          return <tr key={service.id}>
            <td><div className="cell-person"><span className="row-icon" style={{ background: service.color + "29", color: service.color }}><Scissors size={16} /></span><div>
              <strong>{service.name}</strong><small>{service.category || "Sem categoria"}</small>
            </div></div>{service.description && <small className="mt-1 max-w-xs">{service.description}</small>}
              <small className="mt-1">{assigned.length ? assigned.map(member => member.name).join(", ") : "Sem profissionais vinculadas"}</small>
            </td>
            <td>{duration(service.duration_minutes)}</td><td><strong>{money(service.price_cents)}</strong></td>
            {ctx.manager && <><td>{money(cost)}</td><td><Badge tone={service.price_cents >= cost ? "green" : "red"}>{money(service.price_cents - cost)}</Badge></td>
              <td><div className="cell-actions"><ServiceEditor slug={empresa} service={service} products={products} members={members} />
                <ActionForm action={workspaceAction.bind(null, empresa, "service.active")} label={service.active ? "Arquivar" : "Reativar"} compact variant="ghost"
                  confirm={service.active ? "Arquivar este serviço e tirar novas vagas do agendamento online?" : undefined}>
                  <input type="hidden" name="id" value={service.id} /><input type="hidden" name="active" value={String(!service.active)} />
                </ActionForm>
              </div></td></>}
          </tr>;
        })}</tbody>
      </Table> : <Empty icon={Scissors} title={archived ? "Nenhum serviço arquivado" : "Nenhum serviço cadastrado"}
        description={archived ? undefined : "Os serviços ativos ficam disponíveis na agenda e na página de agendamento online."} />}
    </section>
  </div>;
}
