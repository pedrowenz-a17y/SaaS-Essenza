import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { db, supabaseConfig } from "@/lib/supabase/server";
import type { Appointment, Company, Member, Role } from "@/lib/models";

export function canManage(role: Role) { return role === "owner" || role === "admin"; }
export function canSchedule(role: Role) { return canManage(role) || role === "receptionist"; }

export class UserError extends Error {}

export function databaseError(error: { code?: string; message: string }) {
  if (["42501", "22023", "23P01", "40001"].includes(error.code ?? "") && /[À-ÿ]|^(Sem |Este |Esta |Selecione |Confira |O prazo|Saldo |Informe |Os materiais|Há |A empresa)/.test(error.message)) {
    return new UserError(error.message);
  }
  if (error.code === "23505") return new UserError("Já existe um registro com esses dados.");
  if (error.code === "23503") return new UserError("Um vínculo foi alterado. Atualize a página e tente novamente.");
  if (error.code === "23514" || error.code === "22003") return new UserError("Revise os valores informados.");
  return new UserError("Não foi possível concluir a operação. Tente novamente.");
}

export function result<T>(response: { data: unknown; error: { code?: string; message: string } | null }): T {
  if (response.error) throw databaseError(response.error);
  return response.data as T;
}

export const session = cache(async () => {
  if (!supabaseConfig()) return null;
  const client = await db();
  const { data: { user } } = await client.auth.getUser();
  return user;
});

export const workspace = cache(async (slug: string) => {
  const user = await session();
  if (!user) redirect("/login");
  const client = await db();
  const company = result<Company | null>(await client.from("companies").select("*").eq("slug", slug).maybeSingle());
  if (!company) notFound();
  const member = result<Pick<Member, "id" | "name" | "role"> | null>(
    await client.from("members").select("id,name,role").eq("company_id", company.id).eq("user_id", user.id).eq("active", true).maybeSingle(),
  );
  if (!member) notFound();
  return { client, company, member, user, manager: canManage(member.role), scheduler: canSchedule(member.role) };
});

export type Workspace = Awaited<ReturnType<typeof workspace>>;
export const agendaColumns = "id,professional_id,client_id,service_id,title,starts_at,ends_at,updated_at,color,kind,status,price_cents,notes,source,needs_reschedule,attendance_confirmed_at,clients(name)";
export async function roster(ctx: Workspace) {
  return result<Member[]>(await ctx.client.rpc("staff_roster", { p_company: ctx.company.id }));
}

export async function allRows<T>(getPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const page = result<T[]>(await getPage(start, start + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function agendaRange(ctx: Workspace, from: string, to: string) {
  return allRows<Appointment>((start, end) => ctx.client.from("appointments").select(agendaColumns)
    .eq("company_id", ctx.company.id).lt("starts_at", to).gt("ends_at", from)
    .order("starts_at").order("id").range(start, end));
}
