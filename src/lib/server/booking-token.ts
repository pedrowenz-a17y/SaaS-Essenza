import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { id } from "@/lib/validation";

const claims = z.tuple([id, z.number().int().positive(), z.number().int().positive()]);

export function signBookingToken(appointmentId: string, scheduleVersion: number, expiresAt: number, secret: string) {
  const data = Buffer.from(JSON.stringify([appointmentId, scheduleVersion, expiresAt])).toString("base64url");
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return data + "." + signature;
}

export function verifyBookingToken(token: string, secret: string, now = Date.now()) {
  if (token.length > 240 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [body, signature] = token.split(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const input = claims.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!input.success || input.data[2] * 1000 < now) return null;
    const [id, version] = input.data;
    return { id, version };
  } catch {
    return null;
  }
}
