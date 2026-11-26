import { z } from "zod";
import { local } from "./format";

z.config(z.locales.pt());

export const id = z.uuid("Identificador inválido.");
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/, "Use de 3 a 48 letras minúsculas, números ou hífens.");
export function label(max: number, min = 0) { return z.string().trim().min(min).max(max); }
export const email = z.email("Informe um e-mail válido.").max(254).transform(value => value.toLowerCase());
export const optionalEmail = z.union([z.literal(""), email]);
export const isoDate = z.iso.date("Informe uma data válida.");
export const optionalDate = z.union([z.literal(""), isoDate]);
export const isoInstant = z.iso.datetime({ offset: true, message: "Informe um horário válido." });
export const bool = z.boolean();
export const statusSchema = z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"]);
export const paymentSchema = z.enum(["pix", "cash", "credit", "debit", "other"]);
export const movementSchema = z.enum(["in", "out", "consumption", "loss", "adjustment"]);
export const staffSchema = z.enum(["owner", "admin", "professional", "receptionist"]);

export function integer(min: number, max: number) {
  return z.string().regex(/^\d+$/, "Informe um número inteiro.").transform(Number).pipe(z.number().int().min(min).max(max));
}

export function localizedNumber(places: number, allowNegative = false) {
  const sign = allowNegative ? "-?" : "";
  const fraction = "(?:[.,]\\d{1," + places + "})?";
  return z.string().trim().regex(new RegExp("^" + sign + "\\d+" + fraction + "$"), "Informe um número válido, sem separar os milhares.")
    .transform(value => Number(value.replace(",", ".")))
    .pipe(z.number().min(allowNegative ? -99999999 : 0).max(99999999));
}

export const cents = localizedNumber(2).transform(value => Math.round(value * 100));
export const phone = z.string().trim().transform((value) => {
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) return "+" + digits;
  if (digits.length === 10 || digits.length === 11) return "+55" + digits;
  return digits.length >= 12 ? "+" + digits : "";
}).pipe(z.string().regex(/^\+[1-9]\d{8,14}$/, "Informe um telefone com DDD."));
export const optionalPhone = z.union([z.literal(""), phone]);

export const businessHours = z.object({
  open: z.iso.time({ precision: -1 }),
  close: z.iso.time({ precision: -1 }),
}).refine(value => value.open < value.close, "O fechamento deve ser posterior à abertura.");

export const clientSchema = z.object({
  name: label(150, 2), phone, email: optionalEmail, whatsapp: optionalPhone,
  birthday: optionalDate.refine(value => !value || (value >= "1900-01-01" && value <= local().toISODate()!), "Confira a data de nascimento."),
  notes: label(2000), preferences: label(2000), email_opt_in: bool, whatsapp_opt_in: bool,
}).refine(data => !data.email_opt_in || !!data.email, "Informe o e-mail autorizado.")
  .refine(data => !data.whatsapp_opt_in || !!data.whatsapp, "Informe o WhatsApp autorizado.");

export const publicBookingSchema = z.object({
  service_id: id, professional_id: id, starts_at: isoInstant,
  name: label(150, 2), phone, email: optionalEmail, email_opt_in: bool, whatsapp_opt_in: bool,
}).refine(data => !data.email_opt_in || !!data.email, "Informe o e-mail autorizado.");

export const materialSchema = z.array(z.object({ product_id: id, quantity: localizedNumber(3) })).max(50)
  .refine(rows => new Set(rows.map(row => row.product_id)).size === rows.length, "Selecione cada produto apenas uma vez.");

export function validReturnTo(value: string | null) {
  return value && /^\/(inicio|redefinir)(\?|$)/.test(value) && !value.includes("\\") ? value : "/inicio";
}
