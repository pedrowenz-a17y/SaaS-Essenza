import { DateTime } from "luxon";
import type { AppointmentStatus, MovementKind, PaymentMethod, Role } from "./models";

export const TIMEZONE = "America/Sao_Paulo";
const LOCAL = { zone: TIMEZONE, locale: "pt-BR" } as const;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export function local(value?: string) {
  return value ? DateTime.fromISO(value, LOCAL) : DateTime.now().setZone(TIMEZONE).setLocale("pt-BR");
}
export function money(cents: number) { return currency.format(cents / 100); }
export function quantity(value: number) { return decimal.format(value); }
export function moneyInput(cents: number) { return (cents / 100).toFixed(2).replace(".", ","); }
export function shortDate(value: string) { return local(value).toFormat("dd/MM"); }
export function dayLabel(value: string) { return local(value).toFormat("dd/MM/yyyy"); }
export function hour(value: string) { return local(value).toFormat("HH:mm"); }
export function dateAndTime(value: string) { return local(value).toFormat("dd/MM/yyyy 'às' HH:mm"); }
export function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? hours + " h" : "", rest ? rest + " min" : ""].filter(Boolean).join(" ");
}
export function initial(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase()).join("");
}
export function phoneDisplay(phone: string) {
  return phone.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
}
export function slugify(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
}

export const statuses: Record<AppointmentStatus, string> = {
  pending: "Pendente", confirmed: "Confirmado", in_progress: "Em atendimento",
  completed: "Concluído", cancelled: "Cancelado", no_show: "Não compareceu",
};
export const roles: Record<Role, string> = {
  owner: "Proprietária", admin: "Administradora", professional: "Profissional", receptionist: "Recepcionista",
};
export const paymentMethods: Record<PaymentMethod, string> = {
  pix: "PIX", cash: "Dinheiro", credit: "Cartão de crédito", debit: "Cartão de débito", other: "Outros",
};
export const movements: Record<MovementKind, string> = {
  in: "Entrada", out: "Saída", consumption: "Consumo", loss: "Perda ou descarte", adjustment: "Ajuste de inventário",
};
export const notificationLabels: Record<string, string> = {
  new_booking: "Novo agendamento", cancelled: "Cancelamento", rescheduled: "Reagendamento",
  confirmed: "Confirmação", upcoming: "Próximo atendimento", low_stock: "Estoque baixo",
  out_of_stock: "Produto esgotado", expiring: "Próximo do vencimento", expired: "Produto vencido",
  high_usage: "Consumo elevado", pending_payment: "Pagamento pendente", birthday: "Aniversário",
};
