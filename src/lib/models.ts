export type Role = "owner" | "admin" | "professional" | "receptionist";
export type AppointmentStatus = "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
export type PaymentMethod = "pix" | "cash" | "credit" | "debit" | "other";
export type MovementKind = "in" | "out" | "consumption" | "loss" | "adjustment";
export type WorkingHours = Partial<Record<string, { open: string; close: string }>>;

export interface Company {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  description: string;
  address: string;
  logo_path: string | null;
  working_hours: WorkingHours;
  booking_enabled: boolean;
  auto_confirm: boolean;
  allow_customer_cancel: boolean;
  cancel_hours: number;
  allow_negative_stock: boolean;
  reminder_minutes: number[];
  reminder_internal: boolean;
  reminder_email: boolean;
  reminder_whatsapp: boolean;
  reminder_template: string;
}

export interface Member {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  bookable: boolean;
  joined: boolean;
  email: string | null;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  birthday: string | null;
  notes: string;
  preferences: string;
  email_consented_at: string | null;
  whatsapp_consented_at: string | null;
  created_at: string;
  last_visit: string | null;
  next_visit: string | null;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  brand: string;
  supplier: string;
  unit: string;
  quantity: number;
  minimum: number;
  cost_cents: number;
  expires_on: string | null;
  photo_path: string | null;
  photo_url?: string;
  location: string;
  notes: string;
  active: boolean;
}

export interface Material {
  product_id: string;
  quantity: number;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string;
  price_cents: number;
  duration_minutes: number;
  color: string;
  active: boolean;
  service_materials: Material[];
  service_professionals: { member_id: string }[];
}

export interface Appointment {
  id: string;
  professional_id: string;
  client_id: string | null;
  service_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  updated_at: string;
  color: string;
  kind: "appointment" | "block";
  status: AppointmentStatus;
  price_cents: number;
  notes: string;
  source: "office" | "online";
  needs_reschedule: boolean;
  attendance_confirmed_at: string | null;
  clients: { name: string } | null;
}

export interface CompletionMaterial extends Material {
  name: string;
  unit: string;
  available: number;
}

export interface StockMovement {
  id: string;
  product_id: string;
  kind: MovementKind;
  quantity_delta: number;
  quantity_after: number;
  cost_cents: number;
  notes: string;
  created_at: string;
  products: { name: string; unit: string } | null;
}

export interface FinanceEntry {
  id: string;
  appointment_id: string | null;
  movement_id: string | null;
  kind: "income" | "expense";
  description: string;
  category: string;
  amount_cents: number;
  occurred_on: string;
  settled_on: string | null;
  method: PaymentMethod | null;
}

export interface Notification {
  id: string;
  kind: string;
  message: string;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface DashboardSummary {
  today: number;
  confirmed: number;
  pending: number;
  clients: number;
  low: number;
  out: number;
  revenue_today: number;
  revenue_month: number;
  series: { day: string; completed: number; scheduled: number }[];
}

export interface FinanceSummary {
  daily: number;
  weekly: number;
  monthly: number;
  income: number;
  expenses: number;
  pending: number;
  products: number;
  profit: number;
  series: { day: string; income: number; expense: number }[];
  ranking: { title: string; paid: number; cost: number; margin: number }[];
}

export interface PublicCatalog {
  name: string;
  logo_path: string | null;
  description: string;
  address: string;
  auto_confirm: boolean;
  timezone: string;
  allow_customer_cancel: boolean;
  cancel_hours: number;
  services: (Pick<Service, "id" | "name" | "category" | "description" | "price_cents" | "duration_minutes" | "color"> &
    { professionals: { id: string; name: string }[] })[];
}

export interface BookingRecord {
  id: string;
  status: AppointmentStatus;
  schedule_version: number;
  starts_at: string;
  ends_at: string;
}

export interface BookingDetails {
  title: string;
  starts_at: string;
  name: string;
  slug: string;
  professional: string;
  status: AppointmentStatus;
  needs_reschedule: boolean;
  attendance_confirmed: boolean;
  can_cancel: boolean;
  can_manage: boolean;
  can_request_change: boolean;
  cancel_hours: number;
}
