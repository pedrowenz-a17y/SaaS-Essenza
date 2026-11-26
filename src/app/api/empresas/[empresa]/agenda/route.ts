import { NextResponse } from "next/server";
import { agendaRange, result, workspace } from "@/lib/server/data";
import { id, isoInstant } from "@/lib/validation";
import type { CompletionMaterial } from "@/lib/models";

export async function GET(request: Request, context: { params: Promise<{ empresa: string }> }) {
  const ctx = await workspace((await context.params).empresa);
  const query = new URL(request.url).searchParams;
  const appointment = id.safeParse(query.get("materiais"));
  const headers = { "Cache-Control": "private, no-store" };
  if (appointment.success) {
    const materials = result<CompletionMaterial[]>(await ctx.client.rpc("appointment_materials", { p_company: ctx.company.id, p_id: appointment.data }));
    return NextResponse.json(materials, { headers });
  }
  const from = isoInstant.safeParse(query.get("inicio"));
  const to = isoInstant.safeParse(query.get("fim"));
  if (!from.success || !to.success) return NextResponse.json({ erro: "Intervalo inválido." }, { status: 400 });
  const days = (Date.parse(to.data) - Date.parse(from.data)) / 86400000;
  if (days <= 0 || days > 62) return NextResponse.json({ erro: "Intervalo inválido." }, { status: 400 });
  const appointments = await agendaRange(ctx, from.data, to.data);
  return NextResponse.json(appointments, { headers });
}
