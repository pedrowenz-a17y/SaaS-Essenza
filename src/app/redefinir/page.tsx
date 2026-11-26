import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth-screen";
import { session } from "@/lib/server/data";
export const metadata = { title: "Redefinir senha" };
export default async function Redefinir() {
  if (!await session()) redirect("/recuperar");
  return <AuthScreen mode="reset" />;
}
