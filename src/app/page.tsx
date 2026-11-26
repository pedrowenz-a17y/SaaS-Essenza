import { redirect } from "next/navigation";
import { session } from "@/lib/server/data";

export default async function Home() {
  redirect(await session() ? "/inicio" : "/login");
}
