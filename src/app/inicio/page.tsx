import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Mail, Plus } from "lucide-react";
import { acceptInvite, signOut } from "@/lib/server/auth-actions";
import { result, session } from "@/lib/server/data";
import { db, publicLogo } from "@/lib/supabase/server";
import type { Company, Role } from "@/lib/models";
import { roles } from "@/lib/format";
import { CompanyCreate } from "@/components/company-create";
import { ThemeButton } from "@/components/theme";
import { ActionForm } from "@/components/ui/form";
import { Brand, Button, PageTitle, SectionTitle } from "@/components/ui/primitives";

export const metadata = { title: "Minhas empresas" };

export default async function Inicio() {
  const user = await session();
  if (!user) redirect("/login");
  const client = await db();
  const [companies, invites] = await Promise.all([
    client.from("companies").select("id,name,slug,logo_path").order("name"),
    client.rpc("my_invitations"),
  ]);
  const rows = result<Pick<Company, "id" | "name" | "slug" | "logo_path">[]>(companies);
  const invitations = result<{ company_id: string; company_name: string; role: Role }[]>(invites);
  const name = typeof user.user_metadata.name === "string" ? user.user_metadata.name : "";

  return <main className="center-page page-stack">
    <header className="public-top"><Brand subtitle="Gestão de beleza" /><div className="title-actions"><ThemeButton /><form action={signOut}><Button variant="secondary" type="submit">Sair</Button></form></div></header>
    <PageTitle title={rows.length ? "Minhas empresas" : "Configure sua empresa"} description={rows.length ? "Escolha a empresa que deseja acessar." : "Crie seu espaço de trabalho ou aceite um convite da sua equipe."} />
    {rows.length > 0 && <div className="panel panel-pad">
      <SectionTitle icon={Building2} title="Espaços de trabalho" />
      <div className="data-list">{rows.map(company => <div className="data-row" key={company.id}>
        <div className="row-detail"><Brand name={company.name} logo={publicLogo(company.logo_path)} /></div>
        <Button asChild variant="secondary" size="small"><Link href={"/painel/" + company.slug}>Acessar</Link></Button>
      </div>)}</div>
    </div>}
    {invitations.length > 0 && <section className="panel panel-pad">
      <SectionTitle icon={Mail} title="Convites da equipe" />
      <div className="data-list">{invitations.map(invitation => <div key={invitation.company_id} className="data-row">
        <div className="row-detail"><strong>{invitation.company_name}</strong><small>{roles[invitation.role]}</small></div>
        <ActionForm action={acceptInvite.bind(null, invitation.company_id)} label="Aceitar convite" compact />
      </div>)}</div>
    </section>}
    <section className="panel panel-pad settings-section"><SectionTitle icon={Plus} title="Nova empresa" /><CompanyCreate userName={name} /></section>
  </main>;
}
