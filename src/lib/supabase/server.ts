import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export async function db() {
  const config = supabaseConfig();
  if (!config) throw new Error("Conexão com o banco ainda não configurada.");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) store.set(name, value, options);
        } catch {
          // The proxy refreshes session cookies for Server Components.
        }
      },
    },
  });
}

export function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("O serviço de agendamento e automações ainda não foi configurado.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function publicLogo(path: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return path && url ? url + "/storage/v1/object/public/company-logos/" + path.split("/").map(encodeURIComponent).join("/") : null;
}
