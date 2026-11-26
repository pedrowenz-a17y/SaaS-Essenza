import { AuthScreen } from "@/components/auth-screen";
export const metadata = { title: "Entrar" };

export default async function Login({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  return <AuthScreen mode="login" invalidLink={(await searchParams).aviso === "link"} />;
}
