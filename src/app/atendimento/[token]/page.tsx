import Link from "next/link";
import { CalendarDays, Clock3 } from "lucide-react";
import { ActionForm } from "@/components/ui/form";
import { Badge, Brand, Button, Empty, PageTitle, SectionTitle } from "@/components/ui/primitives";
import { ThemeButton } from "@/components/theme";
import { getBookingDetails } from "@/lib/server/booking";
import { bookingOperation } from "@/lib/server/booking-actions";
import { dateAndTime, statuses } from "@/lib/format";

export const metadata = { title: "Seu atendimento", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ManageBooking({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const appointment = await getBookingDetails(token);
  if (!appointment) return <main className="center-page page-stack">
    <Brand /><section className="panel"><Empty icon={CalendarDays} title="Link indisponível" description="O link pode ter expirado. Entre em contato com a empresa para consultar o atendimento." /></section>
  </main>;
  const canCancel = appointment.can_request_change && appointment.can_cancel;
  return <main className="center-page page-stack">
    <header className="public-top"><Brand name={appointment.name} subtitle="Agendamento online" /><ThemeButton /></header>
    <PageTitle title="Seu atendimento" description={appointment.status === "pending" ? "A empresa ainda precisa aprovar este horário." : undefined} />
    <section className="panel panel-pad settings-section">
      <SectionTitle icon={CalendarDays} title={appointment.title}><Badge tone={appointment.status}>{statuses[appointment.status]}</Badge></SectionTitle>
      <dl className="summary-lines">
        <div><dt>Data e horário</dt><dd><Clock3 size={16} className="inline mr-1" />{dateAndTime(appointment.starts_at)}</dd></div>
        <div><dt>Profissional</dt><dd>{appointment.professional}</dd></div>
        {appointment.attendance_confirmed && appointment.status === "confirmed" && <div><dt>Presença</dt><dd>Confirmada</dd></div>}
        {appointment.needs_reschedule && <div><dt>Reagendamento</dt><dd>Aguardando retorno da empresa</dd></div>}
      </dl>
      <div className="title-actions">
        {appointment.can_manage && <ActionForm action={bookingOperation.bind(null, token, "confirm", appointment.slug)} compact label="Confirmar presença" />}
        {appointment.can_request_change && !appointment.needs_reschedule && <ActionForm action={bookingOperation.bind(null, token, "reschedule", appointment.slug)}
          compact label="Pedir reagendamento" variant="secondary" />}
        {canCancel && <ActionForm action={bookingOperation.bind(null, token, "cancel", appointment.slug)} compact label="Cancelar horário"
          variant="danger" confirm="Deseja cancelar o seu horário?" />}
      </div>
      {appointment.can_request_change && !canCancel && <p className="subtle">Para cancelar agora, entre em contato com a empresa.</p>}
    </section>
    <Button asChild variant="secondary" className="justify-self-start"><Link href={"/agendar/" + appointment.slug}>Voltar para a página da empresa</Link></Button>
  </main>;
}
