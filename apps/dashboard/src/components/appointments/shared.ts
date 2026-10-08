/* Shared types, constants, and utilities for appointment components */

export interface Appointment {
  id: string;
  contactId?: string;
  contactName?: string;
  assignedTo?: string;
  assignedName?: string;
  serviceName: string;
  startAt: string;
  endAt: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  location?: string;
  notes?: string;
  createdAt: string;
  recurringGroupId?: string | null;
  recurrenceRule?: Record<string, any> | null;
  /** Conversation the appointment was created from, when there is one. */
  conversationId?: string | null;
  /** Who created it: "ai" (the assistant), "manual", "public_booking"... */
  source?: string | null;
}

export type DurationType = "fixed" | "flexible" | "open";

/**
 * De dónde salió el número del precio (decisión D10).
 * - `example`: lo sembró la receta del rubro y el dueño nunca lo confirmó. El
 *   agente no lo dice.
 * - `confirmed`: el dueño lo escribió o lo confirmó (0 confirmado = gratis).
 * - `quote`: se cotiza según el caso; nunca se dice un número.
 */
export type PriceStatus = "example" | "confirmed" | "quote";

export interface Service {
  id: string;
  name: string;
  duration: number;
  durationMax?: number | null;
  durationType?: DurationType;
  buffer: number;
  /**
   * `null` = the row has no amount (D17 seeds it that way outside the six
   * countries with an example). Read as 0 it looked like a price to confirm,
   * and confirming it told customers the service was free (FX1).
   */
  price: number | null;
  priceStatus?: PriceStatus;
  color: string;
  active: boolean;
  category?: string | null;
  maxConcurrent?: number;
  rebookAfterDays?: number | null;
  requiredFields?: string[];
  locationType?: string;
  locationAddress?: string | null;
  meetingLink?: string | null;
  paymentPolicy?: "none" | "full" | "deposit" | "any";
  depositPercent?: number | null;
  depositAmount?: number | null;
}

export interface ExternalEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  provider: string;
}

export const STATUS_CONFIG: Record<
  string,
  { i18nKey: string; color: string; bg: string; twText: string; twBg: string }
> = {
  pending: {
    i18nKey: "status.pending",
    color: "#f59e0b",
    bg: "#f59e0b15",
    twText: "text-amber-500 dark:text-amber-400",
    twBg: "bg-amber-50 dark:bg-amber-500/10",
  },
  confirmed: {
    i18nKey: "status.confirmed",
    color: "#22c55e",
    bg: "#22c55e15",
    twText: "text-emerald-600 dark:text-emerald-400",
    twBg: "bg-emerald-50 dark:bg-emerald-500/10",
  },
  cancelled: {
    i18nKey: "status.cancelled",
    color: "#ef4444",
    bg: "#ef444415",
    twText: "text-red-500 dark:text-red-400",
    twBg: "bg-red-50 dark:bg-red-500/10",
  },
  completed: {
    i18nKey: "status.completed",
    color: "#3b82f6",
    bg: "#3b82f615",
    twText: "text-blue-600 dark:text-blue-400",
    twBg: "bg-blue-50 dark:bg-blue-500/10",
  },
  no_show: {
    i18nKey: "status.noShow",
    color: "#6b7280",
    bg: "#6b728015",
    twText: "text-neutral-500 dark:text-neutral-400",
    twBg: "bg-neutral-50 dark:bg-neutral-500/10",
  },
};

export const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7-20

export const DURATION_PRESETS = [15, 30, 45, 60, 90];

export const SERVICE_COLORS = [
  "#6c5ce7", "#00d68f", "#f59e0b", "#ef4444", "#3b82f6",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316",
];

export function fmt2(n: number) {
  return n.toString().padStart(2, "0");
}

export function toLocalDate(d: Date) {
  return `${d.getFullYear()}-${fmt2(d.getMonth() + 1)}-${fmt2(d.getDate())}`;
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
}

export function formatDate(iso: string, loc: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(loc, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string, loc: string) {
  return `${formatDate(iso, loc)} ${formatTime(iso)}`;
}

export function formatWeekRange(start: Date, end: Date, loc: string) {
  const s = start.toLocaleDateString(loc, { day: "numeric", month: "long" });
  const e = end.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
  return `${s} - ${e}`;
}

/* ------------------------------------------------------------------ */
/*  Appointment state rules                                            */
/* ------------------------------------------------------------------ */

/** A cancelled appointment is history: it is shown, but it is not a live booking. */
export function isCancelledAppointment(appt: Pick<Appointment, "status">): boolean {
  return appt.status === "cancelled";
}

/**
 * Only a booking that is still going to happen can be moved. A cancelled,
 * completed or no-show appointment dragged to another slot would resurrect or
 * rewrite history, and the calendar used to let it happen by accident.
 */
export function canRescheduleAppointment(appt: Pick<Appointment, "status">): boolean {
  return appt.status === "pending" || appt.status === "confirmed";
}

/** The appointment was booked by the AI assistant (and not typed in by a person). */
export function isAiCreatedAppointment(appt: Pick<Appointment, "source">): boolean {
  return appt.source === "ai";
}

/** Inbox deep link for the conversation an appointment came from, or null. */
export function appointmentConversationHref(appt: Pick<Appointment, "conversationId">): string | null {
  return appt.conversationId ? `/admin/inbox?conversation=${encodeURIComponent(appt.conversationId)}` : null;
}

/** The seven calendar days (YYYY-MM-DD) starting at `weekStart`. */
export function weekDateStrings(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => toLocalDate(addDays(weekStart, i)));
}

/** Appointments whose start falls inside the week that starts at `weekStart`. */
export function appointmentsInWeek<T extends Pick<Appointment, "startAt">>(appts: T[], weekStart: Date): T[] {
  const days = new Set(weekDateStrings(weekStart));
  return appts.filter((a) => days.has(a.startAt.slice(0, 10)));
}

export function isCurrentWeek(weekStart: Date, today: Date = new Date()): boolean {
  return toLocalDate(weekStart) === toLocalDate(getMondayOfWeek(today));
}

/**
 * The window the appointments endpoint is asked for.
 *
 * The end is the last second of the last day: the endpoint compares against a
 * timestamp, and a bare date means midnight at the START of that day, which
 * silently dropped everything booked on the Sunday of the week.
 *
 * The calendar loads the visible week. The agenda is a list, not a week, so it
 * loads from a month back to half a year ahead; it used to show the calendar's
 * week and read "0 appointments" until somebody advanced the calendar.
 */
export function appointmentQueryWindow(
  tab: "calendar" | "agenda",
  weekStart: Date,
  today: Date = new Date(),
): { startDate: string; endDate: string } {
  if (tab === "agenda") {
    return {
      startDate: toLocalDate(addDays(today, -30)),
      endDate: `${toLocalDate(addDays(today, 180))}T23:59:59`,
    };
  }
  return {
    startDate: toLocalDate(weekStart),
    endDate: `${toLocalDate(addDays(weekStart, 6))}T23:59:59`,
  };
}

/** Counters for the strip above the tabs, for the appointments of ONE week. */
export function weekKpis(appts: Pick<Appointment, "status">[]) {
  const count = (status: Appointment["status"]) => appts.filter((a) => a.status === status).length;
  return {
    total: appts.length,
    pending: count("pending"),
    confirmed: count("confirmed"),
    completed: count("completed"),
    cancelled: count("cancelled"),
  };
}
