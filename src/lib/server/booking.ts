import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { adminDb } from "@/lib/supabase/server";
import type { BookingDetails, BookingRecord, PublicCatalog } from "@/lib/models";
import { result, UserError } from "./data";
import { signBookingToken, verifyBookingToken } from "./booking-token";

export function bookingSecret() {
  const secret = process.env.BOOKING_SIGNING_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export async function allowPublicAction(scope: string, maximum: number) {
  const secret = bookingSecret();
  if (!secret) throw new UserError("O agendamento online está temporariamente indisponível.");
  const head = await headers();
  const ip = (head.get("x-vercel-forwarded-for") ?? head.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const hash = createHmac("sha256", secret).update("rate:" + ip).digest("hex");
  const allowed = result<boolean>(await adminDb().rpc("consume_rate_limit", { p_scope: scope, p_hash: hash, p_limit: maximum }));
  if (!allowed) throw new UserError("Muitas tentativas. Aguarde um pouco e tente novamente.");
}

export async function publicCatalog(slug: string) {
  return result<PublicCatalog | null>(await adminDb().rpc("booking_catalog", { p_slug: slug }));
}

export async function getBookingDetails(token: string) {
  const secret = bookingSecret();
  const claims = secret ? verifyBookingToken(token, secret) : null;
  if (!claims) return null;
  return result<BookingDetails | null>(await adminDb().rpc("booking_details", { p_id: claims.id, p_version: claims.version }));
}

export function managementPath(appointment: Pick<BookingRecord, "id" | "schedule_version" | "ends_at">, secret: string) {
  const expiry = Math.floor(Date.parse(appointment.ends_at) / 1000) + 3600;
  return "/atendimento/" + signBookingToken(appointment.id, appointment.schedule_version, expiry, secret);
}
