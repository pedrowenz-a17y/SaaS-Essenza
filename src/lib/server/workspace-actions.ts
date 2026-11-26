"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { local } from "@/lib/format";
import {
  id, label, cents, clientSchema, localizedNumber, optionalDate, paymentSchema, statusSchema, materialSchema,
  isoDate, isoInstant, integer, movementSchema, businessHours, email, staffSchema,
} from "@/lib/validation";
import type { ActionState } from "./action-state";
import { result, UserError, workspace, type Workspace } from "./data";

type Operation =
  | "client.save" | "client.erase" | "service.save" | "service.active"
  | "product.save" | "product.active" | "stock.move" | "stock.buy"
  | "appointment.save" | "appointment.status" | "appointment.finish"
  | "finance.save" | "finance.settle" | "finance.delete"
  | "company.save" | "member.save" | "notifications.read";

const schedulers: Operation[] = ["client.save", "appointment.save"];

function booleanField(form: FormData, name: string) { return form.get(name) === "on" || form.get(name) === "true"; }
function text(form: FormData, name: string) { return String(form.get(name) ?? ""); }
function objects(form: FormData, names: string[]) {
  return Object.fromEntries(names.map(name => [name, text(form, name)]));
}
function parseMaterials(form: FormData) {
  return materialSchema.parse(form.getAll("product_id").map((value, i) => ({
    product_id: value, quantity: form.getAll("material_quantity")[i],
  })));
}
function optionalId(form: FormData, key: string) {
  const value = text(form, key);
  return value ? id.parse(value) : null;
}
function payment(form: FormData) {
  const value = text(form, "method");
  return value ? paymentSchema.parse(value) : null;
}
function verifyPayment(day: string, method: string | null) {
  if (!!day !== !!method) throw new UserError("Informe a data e a forma de pagamento, ou deixe os dois campos vazios.");
}

type Bucket = "company-logos" | "product-photos";
async function saveImage(ctx: Workspace, bucket: Bucket, form: FormData, before: string | null,
  save: (path: string | null) => Promise<unknown>) {
  const file = form.get("image");
  let path = booleanField(form, "remove_image") ? null : before;
  let uploaded = false;
  const storage = ctx.client.storage.from(bucket);
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) throw new UserError("Escolha uma imagem de até 2 MB.");
    const data = Buffer.from(await file.arrayBuffer());
    const png = data.length > 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = data.length > 4 && data.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    const webp = data.length > 16 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
    const extension = png ? "png" : jpeg ? "jpeg" : webp ? "webp" : null;
    if (!extension) throw new UserError("Selecione uma imagem PNG, JPEG ou WebP.");
    path = ctx.company.id + "/" + randomUUID() + "." + extension;
    const { error } = await storage.upload(path, data, { contentType: "image/" + extension, upsert: false });
    if (error) throw new UserError("Não foi possível salvar a imagem.");
    uploaded = true;
  }
  try {
    await save(path);
  } catch (error) {
    if (uploaded && path) await storage.remove([path]);
    throw error;
  }
  if (before && before !== path) await storage.remove([before]);
}

export async function workspaceAction(companySlug: string, operation: Operation, _previous: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await workspace(companySlug);
  const company = ctx.company.id;
  const assignedOperation = ["appointment.status", "appointment.finish", "notifications.read"].includes(operation);
  if (!assignedOperation && (schedulers.includes(operation) ? !ctx.scheduler : !ctx.manager)) {
    return { error: "Sua função não tem acesso a esta operação." };
  }
  const rpc = async (name: string, args: Record<string, unknown> = {}) =>
    result(await ctx.client.rpc(name, { p_company: company, ...args }));

  try {
    const key = optionalId(form, "id");
    switch (operation) {
      case "client.save": {
        const data = clientSchema.parse({
          ...objects(form, ["name", "phone", "whatsapp", "email", "birthday", "notes", "preferences"]),
          email_opt_in: booleanField(form, "email_opt_in"), whatsapp_opt_in: booleanField(form, "whatsapp_opt_in"),
        });
        await rpc("save_client", { p_id: key, p_data: data });
        break;
      }
      case "client.erase":
        await rpc("erase_client", { p_id: id.parse(key) });
        break;
      case "service.save": {
        const data = z.object({
          name: label(120, 2), category: label(80), description: label(1200), price_cents: cents,
          duration_minutes: integer(5, 720), color: z.string().regex(/^#[\da-f]{6}$/i, "Informe uma cor válida."),
        }).parse(objects(form, ["name", "category", "description", "price_cents", "duration_minutes", "color"]));
        await rpc("save_service", {
          p_id: key, p_data: data, p_materials: parseMaterials(form), p_professionals: z.array(id).max(100).parse(form.getAll("professionals")),
        });
        break;
      }
      case "service.active":
        await rpc("set_service_active", { p_id: id.parse(key), p_active: booleanField(form, "active") });
        break;
      case "product.save": {
        const data = z.object({
          name: label(120, 2), category: label(80), brand: label(100), supplier: label(120), unit: label(24, 1),
          minimum: localizedNumber(3), initial_stock: localizedNumber(3), cost_cents: cents,
          expires_on: optionalDate, location: label(150), notes: label(2000),
        }).parse({ ...objects(form, ["name", "category", "brand", "supplier", "unit", "minimum", "cost_cents", "expires_on", "location", "notes"]),
          initial_stock: text(form, "initial_stock") || "0" });
        const before = key ? result<{ photo_path: string | null }>(await ctx.client.from("products").select("photo_path").eq("company_id", company).eq("id", key).single()).photo_path : null;
        await saveImage(ctx, "product-photos", form, before, path => rpc("save_product", { p_id: key, p_data: { ...data, photo_path: path } }));
        break;
      }
      case "product.active":
        await rpc("set_product_active", { p_id: id.parse(key), p_active: booleanField(form, "active") });
        break;
      case "stock.move": {
        const kind = movementSchema.parse(form.get("kind"));
        const amount = localizedNumber(3, kind === "adjustment").parse(text(form, "quantity"));
        const cost = text(form, "cost_cents");
        await rpc("move_stock", {
          p_id: id.parse(key), p_kind: kind, p_quantity: amount, p_notes: label(2000).parse(text(form, "notes")),
          p_cost: kind === "in" && cost ? cents.parse(cost) : null, p_method: kind === "in" ? payment(form) : null,
        });
        break;
      }
      case "stock.buy":
        await rpc("mark_shopping", { p_product: id.parse(key), p_bought: booleanField(form, "bought") });
        break;
      case "appointment.save": {
        const block = booleanField(form, "block");
        const localStart = local(text(form, "starts_at"));
        if (!localStart.isValid) throw new UserError("Informe a data e o horário do atendimento.");
        const startsAt = localStart.toUTC().toISO()!;
        const price = text(form, "price_cents");
        const details = {
          starts_at: startsAt, professional_id: id.parse(form.get("professional_id")), block,
          duration_minutes: integer(5, block ? 1440 : 720).parse(text(form, "duration_minutes")),
          notes: label(2000).parse(text(form, "notes")),
          updated_at: key ? isoInstant.parse(text(form, "updated_at")) : null,
        };
        await rpc("save_appointment", {
          p_id: key,
          p_data: block ? { ...details, title: label(120).parse(text(form, "title")) } : {
            ...details, client_id: id.parse(form.get("client_id")), service_id: id.parse(form.get("service_id")),
            price_cents: price ? cents.parse(price) : null, initial_status: z.enum(["pending", "confirmed"]).parse(text(form, "initial_status") || "pending"),
          },
        });
        break;
      }
      case "appointment.status":
        await rpc("change_appointment_status", { p_id: id.parse(key), p_status: statusSchema.parse(form.get("status")) });
        break;
      case "appointment.finish":
        await rpc("finish_appointment", { p_id: id.parse(key), p_usage: parseMaterials(form), p_method: ctx.scheduler ? payment(form) : null });
        break;
      case "finance.save": {
        const data = z.object({
          kind: z.enum(["income", "expense"]), description: label(180, 2), category: label(100),
          amount_cents: cents, occurred_on: isoDate, settled_on: optionalDate,
        }).parse(objects(form, ["kind", "description", "category", "amount_cents", "occurred_on", "settled_on"]));
        const method = payment(form);
        verifyPayment(data.settled_on, method);
        await rpc("save_finance", { p_id: key, p_data: { ...data, method } });
        break;
      }
      case "finance.settle": {
        const day = optionalDate.parse(text(form, "settled_on"));
        const method = payment(form);
        verifyPayment(day, method);
        await rpc("settle_finance", { p_id: id.parse(key), p_day: day || null, p_method: method });
        break;
      }
      case "finance.delete":
        await rpc("delete_finance", { p_id: id.parse(key) });
        break;
      case "company.save": {
        const workingHours = Object.fromEntries(Array.from({ length: 7 }, (_, offset) => offset + 1)
          .filter(day => booleanField(form, "open_" + day))
          .map(day => [day, businessHours.parse({ open: text(form, "start_" + day), close: text(form, "end_" + day) })]));
        const offsets = text(form, "reminder_hours").trim();
        const reminderMinutes = offsets ? offsets.split(";").map(value => {
          const hours = localizedNumber(2).parse(value);
          return Math.round(hours * 60);
        }) : [];
        if (reminderMinutes.length > 5 || reminderMinutes.some(minutes => minutes < 15 || minutes > 10080)) {
          throw new UserError("Configure até cinco prazos, entre 15 minutos e 7 dias.");
        }
        const data = {
          name: label(100, 2).parse(text(form, "name")), description: label(700).parse(text(form, "description")),
          address: label(250).parse(text(form, "address")), working_hours: workingHours,
          ...Object.fromEntries(["booking_enabled", "auto_confirm", "allow_customer_cancel", "allow_negative_stock",
            "reminder_internal", "reminder_email", "reminder_whatsapp"].map(name => [name, booleanField(form, name)])),
          cancel_hours: integer(0, 168).parse(text(form, "cancel_hours")), reminder_minutes: reminderMinutes,
          reminder_template: label(1200).parse(text(form, "reminder_template")),
        };
        await saveImage(ctx, "company-logos", form, ctx.company.logo_path,
          path => rpc("save_company_settings", { p_data: { ...data, logo_path: path } }));
        break;
      }
      case "member.save":
        await rpc("save_member", {
          p_id: key, p_name: label(100, 2).parse(text(form, "name")), p_email: key ? null : email.parse(text(form, "email").trim()),
          p_role: staffSchema.parse(form.get("role")), p_active: booleanField(form, "active"), p_bookable: booleanField(form, "bookable"),
        });
        break;
      case "notifications.read":
        await rpc("read_notifications", { p_notification: key });
        break;
    }
    revalidatePath("/painel/" + companySlug, "layout");
    return { ok: true, message: "Alteração salva." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return { error: issue.path.length && issue.code === "invalid_type" ? "Confira os campos obrigatórios." : issue.message };
    }
    return { error: error instanceof UserError ? error.message : "Não foi possível salvar. Confira a conexão e tente novamente." };
  }
}
