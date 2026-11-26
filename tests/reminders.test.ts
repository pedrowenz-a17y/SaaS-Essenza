import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyProviderResponse, formatMessage, messageValues, sendExternal, type Reminder } from "@/lib/server/reminder-delivery";

const reminder: Reminder = {
  appointment_id: "43bac385-7e48-4f36-80c8-a6b7446578e0", schedule_version: 1,
  starts_at: "2028-08-10T17:00:00Z", ends_at: "2028-08-10T18:00:00Z",
  channel: "email", purpose: "reminder", service: "Extensão de cílios", company: "Essenza",
  client: "Ana", destination: "ana@example.test", template: "Olá, {cliente}! {data} às {hora}. {link}", eligible: true,
};

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("entrega de lembretes", () => {
  it("personaliza a mensagem no fuso da empresa", () => {
    const text = formatMessage(reminder.template, messageValues(reminder, "https://essenza.example.test/r"));
    expect(text).toBe("Olá, Ana! 10/08/2028 às 14:00. https://essenza.example.test/r");
  });
  it("registra falta de consentimento sem realizar requisição", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await sendExternal("job", { ...reminder, destination: null }, "link")).toEqual({ status: "skipped", reason: "no_consent" });
    expect(request).not.toHaveBeenCalled();
  });
  it("marca uma entrega incerta no WhatsApp e usa a retentativa idempotente por e-mail", () => {
    expect(classifyProviderResponse("whatsapp", 502).status).toBe("unknown");
    expect(classifyProviderResponse("whatsapp", 429).status).toBe("retry");
    expect(classifyProviderResponse("email", 503).status).toBe("retry");
    expect(classifyProviderResponse("email", 401).status).toBe("failed");
  });
  it("reutiliza a chave de idempotência do Resend", async () => {
    vi.stubEnv("APP_URL", "https://essenza.example.test");
    vi.stubEnv("BOOKING_SIGNING_SECRET", "uma-chave-de-teste-com-32-caracteres");
    vi.stubEnv("RESEND_FROM", "Essenza <no-reply@example.test>");
    vi.stubEnv("RESEND_API_KEY", "qa");
    const request = vi.fn().mockImplementation(async (_url, request) => {
      expect(request.headers["Idempotency-Key"]).toBe("essenza/job");
      return new Response('{"id":"qa-email-id"}', { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    const url = "https://essenza.example.test/atendimento/link";
    expect(await sendExternal("job", reminder, url)).toEqual({ status: "sent", provider: "qa-email-id" });
    expect(await sendExternal("job", reminder, url)).toEqual({ status: "sent", provider: "qa-email-id" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
