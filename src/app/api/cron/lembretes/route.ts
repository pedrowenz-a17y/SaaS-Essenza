import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase/server";
import { bookingSecret, managementPath } from "@/lib/server/booking";
import { sendExternal, type DeliveryResult, type Reminder } from "@/lib/server/reminder-delivery";
import { result } from "@/lib/server/data";

export const maxDuration = 60;

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const comparison = Buffer.from("Bearer " + expected);
  const received = Buffer.from(supplied);
  if (!expected || expected.length < 32 || received.length !== comparison.length || !timingSafeEqual(received, comparison)) {
    return NextResponse.json({ erro: "Acesso não autorizado." }, { status: 401 });
  }
  try {
    const client = adminDb();
    const alertRun = await client.rpc("scan_alerts");
    if (alertRun.error) console.error("Falha ao processar alertas automáticos", alertRun.error.code);
    const jobs = result<{ id: string; claimed_at: string }[]>(await client.rpc("claim_reminders", { p_limit: 24 }));
    let failures = 0;
    for (let i = 0; i < jobs.length; i += 6) {
      const batch = await Promise.allSettled(jobs.slice(i, i + 6).map(async job => {
        const input = { p_id: job.id, p_claim: job.claimed_at };
        const reminder = result<Reminder | null>(await client.rpc("reminder_payload", input));
        if (reminder?.channel === "internal") {
          result(await client.rpc("deliver_internal_reminder", input));
          return;
        }
        const secret = bookingSecret();
        const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
        let output: DeliveryResult;
        if (!reminder) output = { status: "skipped", reason: "ineligible" };
        else if (!secret || !appUrl) output = { status: "skipped", reason: "provider_disabled" };
        else {
          const link = appUrl + managementPath({ ...reminder, id: reminder.appointment_id }, secret);
          output = await sendExternal(job.id, reminder, link);
        }
        result(await client.rpc("finish_reminder", {
          ...input, p_result: output.status, p_reason: output.reason ?? null, p_provider: output.provider ?? null,
        }));
      }));
      failures += batch.filter(item => item.status === "rejected").length;
    }
    if (failures) console.error("Falha ao processar trabalhos de lembrete", { failures });
    return NextResponse.json(
      { processados: jobs.length - failures, falhas: failures, alertas: !alertRun.error },
      { status: failures || alertRun.error ? 503 : 200 },
    );
  } catch {
    return NextResponse.json({ erro: "A fila está temporariamente indisponível." }, { status: 500 });
  }
}
