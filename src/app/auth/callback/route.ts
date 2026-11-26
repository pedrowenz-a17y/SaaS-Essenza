import { NextResponse } from "next/server";
import { db, supabaseConfig } from "@/lib/supabase/server";
import { validReturnTo } from "@/lib/validation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = process.env.APP_URL || url.origin;
  if (code && supabaseConfig()) {
    const { error } = await (await db()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(validReturnTo(url.searchParams.get("next")), origin));
  }
  return NextResponse.redirect(new URL("/login?aviso=link", origin));
}
