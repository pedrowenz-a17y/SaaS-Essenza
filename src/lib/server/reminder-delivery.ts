import type { BookingRecord } from "@/lib/models";
import { hour, local } from "@/lib/format";

export type Channel = "internal" | "email" | "whatsapp";
export type DeliveryResult = { status: "sent" | "retry" | "skipped" | "failed" | "unknown"; reason?: string; provider?: string };
export type Reminder = Pick<BookingRecord, "schedule_version" | "starts_at" | "ends_at"> & {
  appointment_id: string;
  channel: Channel;
  purpose: "reminder" | "confirmation";
  service: string;
  company: string;
  client: string;
  destination: string | null;
  template: string;
  eligible: boolean;
};

export const confirmationText = "Olá, {cliente}! Seu horário de {servico} foi confirmado para {data}, às {hora}, na {empresa}. Gerencie seu atendimento em {link}.";

export function messageValues(reminder: Reminder, link: string) {
  return {
    cliente: reminder.client, servico: reminder.service, data: local(reminder.starts_at).toFormat("dd/MM/yyyy"),
    hora: hour(reminder.starts_at), empresa: reminder.company, link,
  };
}

export function formatMessage(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-z]+)\}/g, (match, key: string) => values[key] ?? match);
}

export function integrationStatus() {
  const env = process.env;
  const global = Boolean(env.APP_URL && env.BOOKING_SIGNING_SECRET && env.BOOKING_SIGNING_SECRET.length >= 32);
  const whatsapp = Boolean(global && env.WHATSAPP_ACCESS_TOKEN && /^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID ?? "") &&
    /^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION ?? "") && env.WHATSAPP_REMINDER_TEMPLATE);
  return {
    cron: Boolean(env.CRON_SECRET && env.SUPABASE_SERVICE_ROLE_KEY),
    email: Boolean(global && env.RESEND_API_KEY && env.RESEND_FROM),
    whatsapp,
    confirmationWhatsApp: Boolean(whatsapp && env.WHATSAPP_CONFIRMATION_TEMPLATE),
  };
}

export function classifyProviderResponse(channel: "email" | "whatsapp", httpStatus: number): DeliveryResult {
  if (httpStatus === 429) return { status: "retry", reason: "rate_limit" };
  if (httpStatus >= 500) return { status: channel === "email" ? "retry" : "unknown", reason: "provider_unavailable" };
  return { status: "failed", reason: "provider_http_" + httpStatus };
}

export async function sendExternal(jobId: string, reminder: Reminder, link: string): Promise<DeliveryResult> {
  if (!reminder.eligible) return { status: "skipped", reason: "ineligible" };
  if (!reminder.destination) return { status: "skipped", reason: "no_consent" };
  const enabled = integrationStatus();
  const env = process.env;
  const values = messageValues(reminder, link);
  const channel = reminder.channel;
  if (channel === "internal") return { status: "failed", reason: "invalid_channel" };
  const confirmation = reminder.purpose === "confirmation";
  if (channel === "email" && !enabled.email || channel === "whatsapp" && !(confirmation ? enabled.confirmationWhatsApp : enabled.whatsapp)) {
    return { status: "skipped", reason: "provider_disabled" };
  }

  try {
    const response = channel === "email" ? await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": "essenza/" + jobId },
      body: JSON.stringify({
        from: env.RESEND_FROM, to: [reminder.destination],
        subject: (confirmation ? "Agendamento confirmado em " : "Lembrete de atendimento em ") + reminder.company,
        text: formatMessage(confirmation ? confirmationText : reminder.template, values),
      }),
      signal: AbortSignal.timeout(7000),
    }) : await fetch("https://graph.facebook.com/" + env.WHATSAPP_GRAPH_VERSION + "/" + env.WHATSAPP_PHONE_NUMBER_ID + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: reminder.destination.replace(/^\+/, ""),
        type: "template",
        template: {
          name: confirmation ? env.WHATSAPP_CONFIRMATION_TEMPLATE : env.WHATSAPP_REMINDER_TEMPLATE,
          language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR" },
          components: [{ type: "body", parameters: Object.values(values).map(value => ({
            type: "text", text: value.replace(/\s+/g, " ").trim() || "Cliente",
          })) }],
        },
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return classifyProviderResponse(channel, response.status);
    const data = await response.json() as { id?: string; messages?: { id: string }[] };
    return { status: "sent", provider: data.id ?? data.messages?.[0]?.id };
  } catch {
    return { status: channel === "email" ? "retry" : "unknown", reason: "network_ambiguous" };
  }
}

