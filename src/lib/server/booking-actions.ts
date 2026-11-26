"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminDb } from "@/lib/supabase/server";
import type { BookingRecord } from "@/lib/models";
import { publicBookingSchema, slug } from "@/lib/validation";
import { allowPublicAction, bookingSecret, managementPath } from "./booking";
import { verifyBookingToken } from "./booking-token";
import { result, UserError } from "./data";
import type { ActionState } from "./action-state";

export async function requestBooking(company: string, _previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const secret = bookingSecret();
    if (!secret) throw new UserError("O agendamento online está temporariamente indisponível.");
    const selected = slug.parse(company);
    const data = publicBookingSchema.parse({
      service_id: form.get("service_id"), professional_id: form.get("professional_id"), starts_at: form.get("starts_at"),
      name: form.get("name"), phone: form.get("phone"), email: String(form.get("email") ?? "").trim(),
      email_opt_in: form.get("email_opt_in") === "on", whatsapp_opt_in: form.get("whatsapp_opt_in") === "on",
    });
    await allowPublicAction("book", 12);
    const booking = result<BookingRecord>(await adminDb().rpc("book_online", { p_slug: selected, p_data: data }));
    revalidatePath("/painel/" + selected, "layout");
    return { ok: true, path: managementPath(booking, secret), message: booking.status === "confirmed" ? "Seu horário foi confirmado." : "Sua solicitação foi enviada." };
  } catch (error) {
    return { error: error instanceof UserError ? error.message : error instanceof z.ZodError ? error.issues[0].message : "Não foi possível agendar. Tente novamente." };
  }
}

export async function bookingOperation(token: string, operation: "confirm" | "cancel" | "reschedule", companySlug: string): Promise<ActionState> {
  try {
    const secret = bookingSecret();
    const claims = secret ? verifyBookingToken(token, secret) : null;
    if (!claims) throw new UserError("Este link perdeu a validade.");
    await allowPublicAction("manage-booking", 40);
    const state = result<string>(await adminDb().rpc("apply_booking_action", {
      p_id: claims.id, p_version: claims.version, p_action: z.enum(["confirm","cancel","reschedule"]).parse(operation),
    }));
    revalidatePath("/painel/" + slug.parse(companySlug), "layout");
    revalidatePath("/atendimento/" + token);
    return { ok: true, message: state === "requested" ? "Seu pedido de reagendamento foi registrado." : state === "cancelled" ? "Atendimento cancelado." : "Presença confirmada." };
  } catch (error) {
    return { error: error instanceof UserError ? error.message : "Não foi possível atualizar o atendimento." };
  }
}
