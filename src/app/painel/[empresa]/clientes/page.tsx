import Link from "next/link";
import { Search, UsersRound } from "lucide-react";
import { ClientEditor } from "@/components/client-editor";
import { Pagination, pageNumber } from "@/components/pagination";
import { Badge, Button, Empty, Input, PageTitle, Select, Table } from "@/components/ui/primitives";
import type { Client } from "@/lib/models";
import { dayLabel, initial, local, phoneDisplay } from "@/lib/format";
import { result, workspace } from "@/lib/server/data";

export const metadata = { title: "Clientes" };

export default async function Clients({ params, searchParams }: {
  params: Promise<{ empresa: string }>; searchParams: Promise<{ q?: string; retorno?: string; pagina?: string; novo?: string }>;
}) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const stale = query.retorno === "sem-retorno";
  const page = pageNumber(query.pagina);
  const size = 20;
  const threshold = local().minus({ days: 60 }).toUTC().toISO()!;
  let request = ctx.client.from("client_directory").select("*", { count: "exact" }).eq("company_id", ctx.company.id);
  if (search) {
    const digits = search.replace(/\D/g, "");
    request = /^[\d+().\s-]+$/.test(search) && digits ? request.ilike("phone", "%" + digits + "%") :
      request.ilike("name", "%" + search.replace(/[%_\\]/g, "\\$&") + "%");
  }
  if (stale) request = request.or("last_visit.lt." + threshold + ",and(last_visit.is.null,created_at.lt." + threshold + ")");
  const response = await request.order("name").order("id").range((page - 1) * size, page * size - 1);
  const rows = result<Client[]>(response);
  const base = "/painel/" + empresa + "/clientes";

  return <div className="page-stack">
    <PageTitle title="Clientes" description="Cadastros, preferências e histórico de atendimentos.">
      {ctx.scheduler && <ClientEditor slug={empresa} initiallyOpen={query.novo === "1"} />}
    </PageTitle>
    <section className="panel">
      <form className="list-header filters">
        <label className="search-box"><Search size={16} /><Input aria-label="Nome ou telefone" name="q" placeholder="Buscar por nome ou telefone" defaultValue={search} /></label>
        <Select aria-label="Filtrar por retorno" name="retorno" defaultValue={stale ? "sem-retorno" : ""}><option value="">Todos os retornos</option><option value="sem-retorno">Sem retorno há 60 dias</option></Select>
        <Button variant="secondary" type="submit">Filtrar</Button>
      </form>
      {rows.length ? <Table label="Clientes cadastradas">
        <thead><tr><th>Cliente</th><th>Contato</th><th>Último atendimento</th><th>Próximo atendimento</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{rows.map(client => {
          const inactive = (client.last_visit ?? client.created_at) < threshold;
          return <tr key={client.id}>
            <td><Link href={base + "/" + client.id} className="cell-person text-link"><span className="avatar">{initial(client.name)}</span><strong>{client.name}</strong></Link></td>
            <td>{phoneDisplay(client.phone)}{client.email && <small>{client.email}</small>}</td>
            <td>{client.last_visit ? dayLabel(client.last_visit) : "—"}{inactive && <small><Badge tone="amber">Sem retorno</Badge></small>}</td>
            <td>{client.next_visit ? dayLabel(client.next_visit) : "—"}</td>
            <td><div className="cell-actions"><Button asChild size="small" variant="ghost"><Link href={base + "/" + client.id}>Abrir ficha</Link></Button></div></td>
          </tr>;
        })}</tbody>
      </Table> : <Empty icon={UsersRound} title={search || stale ? "Nenhuma cliente encontrada" : "Cadastre sua primeira cliente"}
        description={search || stale ? "Experimente alterar os filtros." : "As fichas reúnem contatos, preferências e todos os atendimentos."} />}
    </section>
    <Pagination page={page} size={size} total={response.count ?? 0} path={base} filters={{ q: search, retorno: stale ? "sem-retorno" : "" }} />
  </div>;
}
