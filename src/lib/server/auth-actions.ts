"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, supabaseConfig } from "@/lib/supabase/server";
import { email, id, label, slug } from "@/lib/validation";
import type { ActionState } from "./action-state";
import { databaseError, session } from "./data";

export async function authAction(mode: "login" | "signup" | "recover" | "reset", _previous: ActionState, form: FormData): Promise<ActionState> {
  if (!supabaseConfig()) return { error: "O banco de dados ainda precisa ser configurado." };
  const client = await db();
  const address = email.safeParse(String(form.get("email") ?? "").trim());
  const password = String(form.get("password") ?? "");
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") || "http://localhost:3000";

  if (mode !== "reset" && !address.success) return { error: "Informe um e-mail válido." };
  if (mode !== "recover" && (password.length < 8 || password.length > 72)) return { error: "Use uma senha com 8 a 72 caracteres." };
  if (mode === "reset") {
    if (!await session()) return { error: "Abra seu link de recuperação novamente." };
    if (password !== form.get("confirmation")) return { error: "As senhas não coincidem." };
    const { error } = await client.auth.updateUser({ password });
    if (error) return { error: "Não foi possível alterar a senha. Solicite um novo link." };
    redirect("/inicio");
  }
  if (!address.success) return { error: "Informe um e-mail válido." };
  if (mode === "recover") {
    await client.auth.resetPasswordForEmail(address.data, { redirectTo: appUrl + "/auth/callback?next=/redefinir" });
    return { ok: true, message: "Se houver uma conta com esse e-mail, você receberá o link de recuperação." };
  }
  if (mode === "signup") {
    const name = label(100, 2).safeParse(form.get("name"));
    if (!name.success) return { error: "Informe seu nome." };
    const { data, error } = await client.auth.signUp({
      email: address.data, password,
      options: { data: { name: name.data }, emailRedirectTo: appUrl + "/auth/callback?next=/inicio" },
    });
    if (error) return { error: "Não foi possível criar a conta. Confira os dados ou tente entrar." };
    if (data.session) redirect("/inicio");
    return { ok: true, message: "Confira seu e-mail para confirmar a conta e continuar." };
  }
  const { error } = await client.auth.signInWithPassword({ email: address.data, password });
  if (error) return { error: error.code === "email_not_confirmed" ? "Confirme seu e-mail antes de entrar." : "E-mail ou senha inválidos." };
  redirect("/inicio");
}

export async function signOut() {
  if (supabaseConfig()) await (await db()).auth.signOut({ scope: "local" });
  redirect("/login");
}

export async function createCompany(_previous: ActionState, form: FormData): Promise<ActionState> {
  if (!await session()) redirect("/login");
  const input = z.object({ name: label(100, 2), slug, member: label(100, 2) }).safeParse({
    name: form.get("name"), slug: form.get("slug"), member: form.get("member"),
  });
  if (!input.success) return { error: input.error.issues[0].message };
  const client = await db();
  const { error } = await client.rpc("create_company", { p_name: input.data.name, p_slug: input.data.slug, p_member: input.data.member });
  if (error) return { error: error.code === "23505" ? "Este endereço de agendamento já está em uso." : databaseError(error).message };
  redirect("/painel/" + input.data.slug);
}

export async function acceptInvite(companyId: string): Promise<ActionState> {
  if (!await session()) redirect("/login");
  if (!id.safeParse(companyId).success) return { error: "Convite inválido." };
  const { error, data } = await (await db()).rpc("accept_company_invite", { p_company: companyId });
  if (error) return { error: databaseError(error).message };
  redirect("/painel/" + String(data));
}
