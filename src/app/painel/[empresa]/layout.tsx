import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { workspace } from "@/lib/server/data";
import { publicLogo } from "@/lib/supabase/server";
import { local } from "@/lib/format";

export default async function Layout({ params, children }: { params: Promise<{ empresa: string }>; children: ReactNode }) {
  const { empresa } = await params;
  const ctx = await workspace(empresa);
  const { count } = await ctx.client.from("notification_list").select("id", { count: "exact", head: true })
    .eq("company_id", ctx.company.id).eq("is_read", false);
  const date = local().toFormat("cccc, dd 'de' LLLL");
  const formattedDate = date.charAt(0).toUpperCase() + date.slice(1);
  return <AppShell base={"/painel/" + empresa} company={ctx.company.name} logo={publicLogo(ctx.company.logo_path)}
    role={ctx.member.role} user={ctx.member.name} count={count ?? 0} date={formattedDate}>
    {children}
  </AppShell>;
}
