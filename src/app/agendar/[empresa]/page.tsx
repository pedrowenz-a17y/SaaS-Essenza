import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { PublicBooking } from "@/components/public-booking";
import { ThemeButton } from "@/components/theme";
import { Brand, Empty } from "@/components/ui/primitives";
import { bookingSecret, publicCatalog } from "@/lib/server/booking";
import { publicLogo } from "@/lib/supabase/server";
import { slug } from "@/lib/validation";

export const metadata = { title: "Agendamento online" };
export const dynamic = "force-dynamic";

export default async function Book({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  if (!slug.safeParse(empresa).success) notFound();
  if (!bookingSecret() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <main className="center-page page-stack"><Brand /><section className="panel">
      <Empty icon={CalendarDays} title="Agendamento temporariamente indisponível" description="Entre em contato com a empresa para agendar." />
    </section></main>;
  }
  const catalog = await publicCatalog(empresa);
  if (!catalog) notFound();
  return <main className="public-width public-stack">
    <header className="public-top"><Brand name={catalog.name} logo={publicLogo(catalog.logo_path)} subtitle="Agendamento online" /><ThemeButton /></header>
    <section className="hero public-hero"><h1>Agende seu atendimento</h1>{catalog.description && <p>{catalog.description}</p>}</section>
    <PublicBooking slug={empresa} catalog={catalog} />
  </main>;
}
