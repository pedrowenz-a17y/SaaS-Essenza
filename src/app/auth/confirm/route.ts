import { NextResponse } from "next/server";
import { db, supabaseConfig } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const origin = process.env.APP_URL || url.origin;
  if (token_hash && (type === "email" || type === "recovery") && supabaseConfig()) {
    const { error } = await (await db()).auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(new URL(type === "recovery" ? "/redefinir" : "/inicio", origin));
  }
  return NextResponse.redirect(new URL("/login?aviso=link", origin));
}
