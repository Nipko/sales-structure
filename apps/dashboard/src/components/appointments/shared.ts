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
}

export interface Service {
  id: string;
  name: string;
  duration: number;
  buffer: number;
  price: number;
  color: string;
  active: boolean;
  category?: string | null;
  maxConcurrent?: number;
  requiredFields?: string[];
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
    twText: "text-gray-500 dark:text-gray-400",
    twBg: "bg-gray-50 dark:bg-gray-500/10",
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
