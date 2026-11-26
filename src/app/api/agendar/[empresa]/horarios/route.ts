import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/supabase/server";
import { id, isoDate, slug } from "@/lib/validation";
import { result, UserError } from "@/lib/server/data";
import { allowPublicAction } from "@/lib/server/booking";

export async function GET(request: Request, context: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await context.params;
  const query = new URL(request.url).searchParams;
  const parsed = z.object({ empresa: slug, service: id, professional: id, day: isoDate }).safeParse({
    empresa, service: query.get("servico"), professional: query.get("profissional"), day: query.get("dia"),
  });
  if (!parsed.success) return NextResponse.json({ erro: "Escolha um serviço, uma profissional e uma data." }, { status: 400 });
  try {
    await allowPublicAction("booking-slots", 240);
    const input = parsed.data;
    const slots = result<{ starts_at: string }[]>(await adminDb().rpc("booking_slots", {
      p_slug: input.empresa, p_service: input.service, p_professional: input.professional, p_day: input.day,
    }));
    return NextResponse.json(slots.map(slot => slot.starts_at), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ erro: error instanceof UserError ? error.message : "Horários temporariamente indisponíveis." }, { status: 503 });
  }
}
