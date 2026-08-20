"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { TabNav } from "@/components/ui/tab-nav";
import ConfigTab from "@/components/appointments/ConfigTab";
import ServicesTab from "@/components/appointments/ServicesTab";
import CalendarGrid from "@/components/appointments/CalendarGrid";
import AgendaTab from "@/components/appointments/AgendaTab";
import AppointmentModal from "@/components/appointments/AppointmentModal";
import ServiceModal from "@/components/appointments/ServiceModal";
import AnalyticsTab from "@/components/appointments/AnalyticsTab";
import {
  hasAppointmentContact,
} from "@/components/appointments/contact-selection";
import { usePaginatedContacts } from "@/hooks/usePaginatedContacts";
import {
  type Appointment, type Service, DAY_KEYS,
  toLocalDate, addDays, getMondayOfWeek, fmt2,
} from "@/components/appointments/shared";
import {
  CalendarDays,
  List,
  Plus,
  CheckCircle2,
  AlertCircle,
  CalendarCheck,
  Tag,
  Link2,
  Settings,
  BarChart3,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { readPaymentPolicy } from "@/components/payments/payment-policy-fields";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  active: boolean;
}

interface BlockedDate {
  id: string;
  blockedDate: string;
  reason?: string;
  userId?: string;
}

interface CalendarIntegration {
  id: string;
  provider: "google" | "microsoft";
  email: string;
  active: boolean;
  label?: string;
  assignmentType?: "general" | "staff" | "service";
  assignmentId?: string;
}


/* ------------------------------------------------------------------ */
/*  Reusable sub-components                                            */
/* ------------------------------------------------------------------ */

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" fill="none">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function AppointmentsPage() {
  const t = useTranslations("appointments");
  const tc = useTranslations("common");
  const tHelp = useTranslations("help");
  const locale = useLocale();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : "es-MX";
  const { activeTenantId } = useTenant();
  const router = useRouter();
  const searchParams = useSearchParams();
  // roles.ts:162 le da esta página a los cuatro roles porque el agente agenda
  // por el cliente desde el calendario. Pero el catálogo de servicios y la
  // configuración (disponibilidad, bloqueos, recordatorios) son ajustes del
  // negocio: el backend ahora los exige admin/supervisor, así que las pestañas
  // que los editan no pueden seguir a la vista de todos.
  const { canManageSettings, canSeeGlobalAnalytics } = useRole();

  // ---- Data state ----
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>(
    DAY_KEYS.map((_, i) => ({
      dayOfWeek: i + 1,
      startTime: "09:00",
      endTime: "18:00",
      active: i < 5,
    }))
  );
  // False until we confirm the tenant has at least one slot persisted in DB.
  // The form shows Mon-Fri as convenient defaults, which previously looked
  // "already saved" to operators who then left without clicking Guardar — the
  // bot ends up telling every customer "no hay disponibilidad".
  const [hasSavedAvailability, setHasSavedAvailability] = useState(true);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [calendarIntegrations, setCalendarIntegrations] = useState<CalendarIntegration[]>([]);
  const [externalEvents, setExternalEvents] = useState<any[]>([]);

  // ---- UI state ----
  const [activeTab, setActiveTab] = useState<"calendar" | "agenda" | "services" | "config" | "analytics">("calendar");
  const [weekStart, setWeekStart] = useState<Date>(getMondayOfWeek(new Date()));
  const [toast, setToast] = useState<string | null>(null);

  // ---- Appointment modal ----
  const [showModal, setShowModal] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [modalForm, setModalForm] = useState({
    serviceName: "",
    date: "",
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    notes: "",
    assignedTo: "",
    contactId: "",
  });
  const [saving, setSaving] = useState(false);
  const {
    contacts: appointmentContacts,
    search: appointmentContactSearch,
    setSearch: setAppointmentContactSearch,
    hasMore: appointmentContactsHasMore,
    loading: loadingAppointmentContacts,
    error: appointmentContactsLoadFailed,
    loadMore: loadMoreAppointmentContacts,
    retry: retryAppointmentContacts,
  } = usePaginatedContacts(activeTenantId, showModal);

  // ---- Agenda filters ----
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // ---- Availability ----
  const [newBlockedDate, setNewBlockedDate] = useState("");
  const [newBlockedReason, setNewBlockedReason] = useState("");
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  // ---- Reminder settings ----
  const [reminderSettings, setReminderSettings] = useState<{
    reminder24h: boolean; reminder2h: boolean; attendanceCheck: boolean; autoComplete: boolean;
  }>({ reminder24h: true, reminder2h: true, attendanceCheck: true, autoComplete: true });

  // ---- WhatsApp Flows (booking, opt-in) ----
  const [bookingFlowsConfig, setBookingFlowsConfig] = useState<{
    enabled: boolean; flowId: string; flowCta?: string; flowMode?: "published" | "draft";
  }>({ enabled: false, flowId: "", flowCta: "Agendar", flowMode: "published" });

  // ---- Service modal ----
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({
    name: "",
    duration: 30,
    durationMax: null as number | null,
    durationType: "fixed" as "fixed" | "flexible" | "open",
    buffer: 0,
    price: 0,
    color: "#6c5ce7",
    category: "",
    maxConcurrent: 1,
    rebookAfterDays: null as number | null,
    requiredFields: [] as string[],
    locationType: "in_person",
    locationAddress: "",
    meetingLink: "",
    paymentPolicy: "none" as "none" | "full" | "deposit" | "any",
    depositPercent: null as number | null,
    depositAmount: null as number | null,
  });
  const [savingService, setSavingService] = useState(false);

  /* ================================================================ */
  /*  Toast helper                                                     */
  /* ================================================================ */

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  /* ================================================================ */
  /*  Data loaders                                                     */
  /* ================================================================ */

  const loadAppointments = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const weekEnd = addDays(weekStart, 6);
      const params = `startDate=${toLocalDate(weekStart)}&endDate=${toLocalDate(weekEnd)}`;
      const res = await api.getAppointments(activeTenantId, params);
      if (res?.success) {
        setAppointments(res.data || []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [activeTenantId, weekStart]);

  const loadAvailability = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const res = await api.getAvailability(activeTenantId);
      const trimTime = (t: string) => (t || "").slice(0, 5);
      if (res?.success && res.data?.length) {
        // res.data is the array directly (not res.data.slots)
        const slots = Array.isArray(res.data) ? res.data : (res.data?.slots || res.data);
        const merged = DAY_KEYS.map((_, i) => {
          const existing = (slots as any[]).find((s: any) => s.dayOfWeek === i + 1);
          return existing
            ? { dayOfWeek: existing.dayOfWeek, startTime: trimTime(existing.startTime), endTime: trimTime(existing.endTime), active: existing.isActive !== false }
            : { dayOfWeek: i + 1, startTime: "09:00", endTime: "18:00", active: false };
        });
        setAvailabilitySlots(merged);
        setHasSavedAvailability(merged.some(s => s.active));
      } else if (res?.success && res.data?.slots?.length) {
        // Fallback for wrapped response
        const merged = DAY_KEYS.map((_, i) => {
          const existing = res.data.slots.find((s: any) => s.dayOfWeek === i + 1);
          return existing
            ? { dayOfWeek: existing.dayOfWeek, startTime: trimTime(existing.startTime), endTime: trimTime(existing.endTime), active: existing.isActive !== false }
            : { dayOfWeek: i + 1, startTime: "09:00", endTime: "18:00", active: false };
        });
        setAvailabilitySlots(merged);
        setHasSavedAvailability(merged.some(s => s.active));
      } else {
        setHasSavedAvailability(false);
      }
    } catch {
      /* ignore */
    }
  }, [activeTenantId]);

  const loadBlockedDates = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const res = await api.getBlockedDates(activeTenantId);
      if (res?.success) setBlockedDates(res.data || []);
    } catch {
      /* ignore */
    }
  }, [activeTenantId]);

  const loadServices = useCallback(async () => {
    if (!activeTenantId) return;
    setLoadingServices(true);
    try {
      const res = await api.getServices(activeTenantId);
      if (res?.success) {
        // Map API field names to frontend interface
        const mapped = (res.data || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          duration: s.durationMinutes || s.duration || 30,
          durationMax: s.durationMinutesMax || s.durationMax || null,
          durationType: s.durationType || s.duration_type || 'fixed',
          buffer: s.bufferMinutes || s.buffer || 0,
          price: parseFloat(s.price || 0),
          color: s.color || '#6c5ce7',
          active: s.isActive ?? s.active ?? true,
          category: s.category || null,
          maxConcurrent: s.maxConcurrent || 1,
          rebookAfterDays: s.rebookAfterDays ?? null,
          requiredFields: s.requiredFields || [],
        }));
        setServices(mapped);
      }
    } catch {
      /* ignore */
    }
    setLoadingServices(false);
  }, [activeTenantId]);

  const loadCalendarIntegrations = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const res = await api.getCalendarIntegrations(activeTenantId);
      if (res?.success) setCalendarIntegrations(res.data || []);
    } catch {
      /* ignore */
    }
  }, [activeTenantId]);

  const loadExternalEvents = useCallback(async () => {
    if (!activeTenantId || calendarIntegrations.length === 0) return;
    try {
      const startDate = weekStart.toISOString().split('T')[0];
      const endDate = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await api.getCalendarEvents(activeTenantId, startDate, endDate);
      if (res?.success) setExternalEvents(res.data || []);
    } catch {
      /* ignore */
    }
  }, [activeTenantId, calendarIntegrations.length, weekStart]);

  const handleSyncCalendar = useCallback(async () => {
    if (syncing || !activeTenantId) return;
    setSyncing(true);
    try {
      const startDate = toLocalDate(weekStart);
      const endDate = toLocalDate(addDays(weekStart, 6));
      const res = await api.syncCalendar(activeTenantId, startDate, endDate);
      if (res?.success) {
        setExternalEvents(res.data || []);
      }
      await loadAppointments();
      setLastSyncAt(new Date());
      showToast(t("syncComplete"));
    } catch {
      await loadExternalEvents();
    } finally {
      setSyncing(false);
    }
  }, [syncing, activeTenantId, weekStart, loadAppointments, loadExternalEvents, showToast, t]);

  const getTimeSince = useCallback((date: Date) => {
    const diff = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diff < 1) return t("justNow");
    return t("lastSynced", { time: t("minutesAgo", { min: String(diff) }) });
  }, [t]);

  // Initial load (including calendar integrations for banner visibility)
  useEffect(() => {
    loadAppointments();
    loadServices();
    loadCalendarIntegrations();
  }, [loadAppointments, loadServices, loadCalendarIntegrations]);

  // A tenant switch invalidates both the loaded CRM contacts and any open form
  // that still references an appointment from the previous tenant.
  useEffect(() => {
    setEditingAppointment(null);
    setShowModal(false);
  }, [activeTenantId]);

  // Load external events when calendar is connected and week changes
  useEffect(() => {
    loadExternalEvents();
  }, [loadExternalEvents]);

  // Auto-refresh external events every 2 minutes when on calendar tab with connected calendar
  useEffect(() => {
    if (activeTab !== "calendar" || calendarIntegrations.length === 0) return;
    const interval = setInterval(() => {
      loadExternalEvents();
      loadAppointments();
      setLastSyncAt(new Date());
    }, 120_000);
    return () => clearInterval(interval);
  }, [activeTab, calendarIntegrations.length, loadExternalEvents, loadAppointments]);

  // Live calendar updates via WebSocket
  useEffect(() => {
    if (!activeTenantId) return;
    const accessToken = localStorage.getItem("accessToken");
    if (!accessToken) return;
    let socket: any;
    try {
      const { io } = require("socket.io-client");
      const socketUrl = (process.env.NEXT_PUBLIC_API_URL || "").replace("/api/v1", "");
      socket = io(`${socketUrl}/inbox`, {
        auth: { token: accessToken },
        transports: ["websocket", "polling"],
      });
      socket.on("appointmentCreated", () => {
        loadAppointments();
        loadExternalEvents();
        setLastSyncAt(new Date());
      });
      socket.on("appointmentUpdated", () => {
        loadAppointments();
        loadExternalEvents();
        setLastSyncAt(new Date());
      });
      socket.on("calendarSynced", () => {
        loadExternalEvents();
        setLastSyncAt(new Date());
      });
    } catch { /* socket.io not available */ }
    return () => { socket?.disconnect(); };
  }, [activeTenantId, loadAppointments, loadExternalEvents]);

  const loadReminderSettings = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const res = await api.getReminderSettings(activeTenantId);
      if (res?.success && res.data) setReminderSettings(res.data);
    } catch { /* ignore */ }
  }, [activeTenantId]);

  const handleUpdateReminderSettings = useCallback(async (update: Record<string, boolean>) => {
    if (!activeTenantId) return;
    setReminderSettings(prev => ({ ...prev, ...update }));
    try {
      const res = await api.updateReminderSettings(activeTenantId, update);
      if (res?.success && res.data) setReminderSettings(res.data);
    } catch { /* revert on error */ }
  }, [activeTenantId]);

  const loadBookingFlowsConfig = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const res = await api.getBookingFlowsConfig(activeTenantId);
      if (res?.success && res.data) setBookingFlowsConfig(res.data);
    } catch { /* ignore */ }
  }, [activeTenantId]);

  const handleUpdateBookingFlows = useCallback(async (update: Record<string, unknown>) => {
    if (!activeTenantId) return;
    try {
      const res = await api.updateBookingFlowsConfig(activeTenantId, update);
      if (res?.success && res.data) {
        setBookingFlowsConfig(res.data);
        showToast(t("configSection.flowSaved"));
      }
    } catch {
      // Enabling without a valid Flow ID is rejected server-side — revert to truth.
      showToast(t("configSection.flowSaveError"));
      loadBookingFlowsConfig();
    }
  }, [activeTenantId, showToast, loadBookingFlowsConfig, t]);

  // Tab-dependent loads
  useEffect(() => {
    if (activeTab === "config") {
      loadAvailability();
      loadBlockedDates();
      loadCalendarIntegrations();
      loadReminderSettings();
      loadBookingFlowsConfig();
    }
  }, [activeTab, loadAvailability, loadBlockedDates, loadCalendarIntegrations, loadReminderSettings, loadBookingFlowsConfig]);

  useEffect(() => {
    if (activeTab === "services") loadServices();
  }, [activeTab, loadServices]);

  /* ================================================================ */
  /*  KPIs                                                             */
  /* ================================================================ */

  const kpis = useMemo(() => {
    const total = appointments.length;
    const pending = appointments.filter((a) => a.status === "pending").length;
    const confirmed = appointments.filter((a) => a.status === "confirmed").length;
    const completed = appointments.filter((a) => a.status === "completed").length;
    return { total, pending, confirmed, completed };
  }, [appointments]);

  /* ================================================================ */
  /*  Calendar helpers                                                 */
  /* ================================================================ */

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const getAppointmentsForDay = useCallback(
    (day: Date) => {
      const dayStr = toLocalDate(day);
      return appointments.filter((a) => toLocalDate(new Date(a.startAt)) === dayStr);
    },
    [appointments]
  );

  const getAppointmentPosition = (appt: Appointment) => {
    const start = new Date(appt.startAt);
    const end = new Date(appt.endAt);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const topOffset = startMinutes - 7 * 60;
    const height = endMinutes - startMinutes;
    return {
      top: (topOffset / 60) * 64,
      height: Math.max((height / 60) * 64, 24),
    };
  };

  const todayStr = toLocalDate(new Date());

  /* ================================================================ */
  /*  Modal open/close                                                 */
  /* ================================================================ */

  const openCreateModal = useCallback((date?: Date, hour?: number) => {
    setEditingAppointment(null);
    setModalForm({
      serviceName: "",
      date: date ? toLocalDate(date) : toLocalDate(new Date()),
      startTime: hour !== undefined ? `${fmt2(hour)}:00` : "09:00",
      endTime: hour !== undefined ? `${fmt2(Math.min(hour + 1, 20))}:00` : "10:00",
      location: "",
      notes: "",
      assignedTo: "",
      contactId: "",
    });
    setShowModal(true);
  }, []);

  useEffect(() => {
    if (searchParams.get("create") !== "appointment") return;
    openCreateModal();
    router.replace("/admin/appointments", { scroll: false });
  }, [searchParams, router, openCreateModal]);

  const openEditModal = (appt: Appointment) => {
    setEditingAppointment(appt);
    const start = new Date(appt.startAt);
    const end = new Date(appt.endAt);
    setModalForm({
      serviceName: appt.serviceName,
      date: toLocalDate(start),
      startTime: `${fmt2(start.getHours())}:${fmt2(start.getMinutes())}`,
      endTime: `${fmt2(end.getHours())}:${fmt2(end.getMinutes())}`,
      location: appt.location || "",
      notes: appt.notes || "",
      assignedTo: appt.assignedTo || "",
      contactId: appt.contactId || "",
    });
    setShowModal(true);
  };

  /* ================================================================ */
  /*  CRUD: Appointments                                               */
  /* ================================================================ */

  const handleSave = async () => {
    if (!activeTenantId || !modalForm.serviceName || !modalForm.date) return;
    if (!editingAppointment && !hasAppointmentContact(modalForm.contactId, appointmentContacts)) {
      showToast(t("contactRequired"));
      return;
    }
    setSaving(true);
    try {
      const startAt = `${modalForm.date}T${modalForm.startTime}:00`;
      const endAt = `${modalForm.date}T${modalForm.endTime}:00`;
      const payload: any = {
        serviceName: modalForm.serviceName,
        startAt,
        endAt,
        location: modalForm.location || undefined,
        notes: modalForm.notes || undefined,
        assignedTo: modalForm.assignedTo || undefined,
        contactId: modalForm.contactId || undefined,
      };
      let response: any;
      if (editingAppointment) {
        response = await api.updateAppointment(activeTenantId, editingAppointment.id, payload);
      } else {
        response = await api.createAppointment(activeTenantId, payload);
      }
      if (!response?.success) {
        showToast(response.error || t("errors.saveAppointment"));
        return;
      }
      showToast(editingAppointment ? t("editAppointment") + " ✓" : t("newAppointment") + " ✓");
      setShowModal(false);
      loadAppointments();
    } catch {
      showToast(t("errors.saveAppointment"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRecurring = async (recurrence: { frequency: string; count: number }) => {
    if (!activeTenantId || !modalForm.serviceName || !modalForm.date) return;
    if (!hasAppointmentContact(modalForm.contactId, appointmentContacts)) {
      showToast(t("contactRequired"));
      return;
    }
    setSaving(true);
    try {
      const startAt = `${modalForm.date}T${modalForm.startTime}:00`;
      const endAt = `${modalForm.date}T${modalForm.endTime}:00`;
      const response = await api.createRecurringAppointment(activeTenantId, {
        serviceName: modalForm.serviceName,
        startAt,
        endAt,
        location: modalForm.location || undefined,
        notes: modalForm.notes || undefined,
        assignedTo: modalForm.assignedTo || undefined,
        contactId: modalForm.contactId || undefined,
        recurrence: {
          frequency: recurrence.frequency,
          count: recurrence.count,
        },
      });
      if (!response?.success) {
        showToast(response?.error || t("errors.saveAppointment"));
        return;
      }
      showToast(t("createRecurringSeries") + " ✓");
      setShowModal(false);
      loadAppointments();
    } catch {
      showToast(t("errors.saveAppointment"));
    } finally {
      setSaving(false);
    }
  };

  const handleReschedule = async (apptId: string, newDate: string, newStart: string, newEnd: string) => {
    if (!activeTenantId) return;
    try {
      await api.updateAppointment(activeTenantId, apptId, {
        startAt: `${newDate}T${newStart}:00`,
        endAt: `${newDate}T${newEnd}:00`,
      });
      showToast(t("update") + " ✓");
      loadAppointments();
    } catch {
      showToast(t("errors.updateAppointment"));
    }
  };

  const handleQuickAction = async (apptId: string, action: "confirm" | "cancel" | "complete") => {
    if (!activeTenantId) return;
    try {
      if (action === "cancel") {
        await api.cancelAppointment(activeTenantId, apptId);
        showToast(t("status.cancelled") + " ✓");
      } else {
        const statusMap = { confirm: "confirmed", complete: "completed" };
        await api.updateAppointment(activeTenantId, apptId, { status: statusMap[action] });
        showToast(action === "confirm" ? t("status.confirmed") + " ✓" : t("status.completed") + " ✓");
      }
      loadAppointments();
    } catch {
      showToast(t("errors.updateAppointment"));
    }
  };

  /* ================================================================ */
  /*  CRUD: Availability                                               */
  /* ================================================================ */

  const handleSaveAvailability = async () => {
    if (!activeTenantId) return;
    setSavingAvailability(true);
    try {
      // Send ALL 7 days with isActive flag so the backend knows which are enabled
      const allSlots = availabilitySlots.map(({ dayOfWeek, startTime, endTime, active }) => ({
        dayOfWeek, startTime, endTime, isActive: active,
      }));
      await api.saveAvailability(activeTenantId, { slots: allSlots });
      setHasSavedAvailability(allSlots.some(s => s.isActive));
      // Reload to verify persistence
      await loadAvailability();
      showToast(t("configSection.schedule") + " ✓");
    } catch {
      showToast(t("errors.saveAvailability"));
    }
    setSavingAvailability(false);
  };

  const handleAddBlockedDate = async (date?: string, reason?: string) => {
    const d = date || newBlockedDate;
    const r = reason || newBlockedReason;
    if (!activeTenantId || !d) return;
    try {
      await api.saveBlockedDate(activeTenantId, {
        blockedDate: d,
        reason: r || undefined,
      });
      setNewBlockedDate("");
      setNewBlockedReason("");
      loadBlockedDates();
      showToast(t("configSection.addBlockedDate") + " ✓");
    } catch {
      showToast(t("errors.addBlockedDate"));
    }
  };

  const handleDeleteBlockedDate = async (dateId: string) => {
    if (!activeTenantId) return;
    try {
      await api.deleteBlockedDate(activeTenantId, dateId);
      loadBlockedDates();
      showToast(t("configSection.blockedDates") + " ✓");
    } catch {
      showToast(t("errors.deleteBlockedDate"));
    }
  };

  /* ================================================================ */
  /*  CRUD: Services                                                   */
  /* ================================================================ */

  const openCreateServiceModal = () => {
    setEditingService(null);
    setServiceForm({ name: "", duration: 30, durationMax: null, durationType: "fixed", buffer: 0, price: 0, color: "#6c5ce7", category: "", maxConcurrent: 1, rebookAfterDays: null, requiredFields: [], locationType: "in_person", locationAddress: "", meetingLink: "", paymentPolicy: "none", depositPercent: null, depositAmount: null });
    setShowServiceModal(true);
  };

  const openEditServiceModal = (svc: Service) => {
    setEditingService(svc);
    setServiceForm({
      name: svc.name,
      duration: svc.duration,
      durationMax: svc.durationMax || null,
      durationType: svc.durationType || "fixed",
      buffer: svc.buffer,
      price: svc.price,
      color: svc.color,
      category: svc.category || "",
      maxConcurrent: svc.maxConcurrent || 1,
      rebookAfterDays: (svc as any).rebookAfterDays ?? null,
      requiredFields: svc.requiredFields || [],
      locationType: (svc as any).locationType || (svc as any).location_type || "in_person",
      locationAddress: (svc as any).locationAddress || (svc as any).location_address || "",
      meetingLink: (svc as any).meetingLink || (svc as any).meeting_link || "",
      // Sin esto, editar un servicio con anticipo lo devolvia a "sin pago".
      ...readPaymentPolicy(svc),
    });
    setShowServiceModal(true);
  };

  const handleSaveService = async () => {
    if (!activeTenantId || !serviceForm.name) return;
    setSavingService(true);
    try {
      const payload = {
        ...serviceForm,
        durationMinutesMax: serviceForm.durationMax,
      };
      let response: any;
      if (editingService) {
        response = await api.updateService(activeTenantId, editingService.id, payload);
      } else {
        response = await api.createService(activeTenantId, payload);
      }
      if (!response?.success) {
        showToast(response?.error || t("errors.saveService"));
        setSavingService(false);
        return;
      }
      showToast(editingService ? t("toasts.serviceUpdated") : t("toasts.serviceCreated"));
      setShowServiceModal(false);
      loadServices();
    } catch {
      showToast(t("errors.saveService"));
    }
    setSavingService(false);
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!activeTenantId) return;
    try {
      await api.deleteService(activeTenantId, serviceId);
      loadServices();
      showToast(t("toasts.serviceDeleted"));
    } catch {
      showToast(t("errors.deleteService"));
    }
  };

  const handleToggleServiceActive = async (svc: Service) => {
    if (!activeTenantId) return;
    try {
      await api.updateService(activeTenantId, svc.id, { active: !svc.active });
      loadServices();
    } catch {
      showToast(t("errors.updateService"));
    }
  };

  /* ================================================================ */
  /*  Calendar integrations                                            */
  /* ================================================================ */

  const handleConnectCalendar = async (provider: "google" | "microsoft", assignmentType?: string, assignmentId?: string) => {
    if (!activeTenantId) return;
    setConnectingCalendar(true);
    try {
      const res =
        provider === "google"
          ? await api.connectGoogleCalendar(activeTenantId, assignmentType, assignmentId)
          : await api.connectMicrosoftCalendar(activeTenantId, assignmentType, assignmentId);
      if (res?.data?.url) {
        window.location.href = res.data.url;
      }
    } catch {
      showToast(t("errors.connectCalendar"));
    }
    setConnectingCalendar(false);
  };

  // Calendar disconnect state
  const [disconnectModal, setDisconnectModal] = useState<{ integrationId: string; futureCount: number; otherCalendars: any[]; canReassign: boolean } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnectCalendar = async (integrationId: string) => {
    if (!activeTenantId) return;
    try {
      await api.disconnectCalendar(activeTenantId, integrationId);
      loadCalendarIntegrations();
      showToast(t("toasts.calendarDisconnected"));
    } catch (err: any) {
      // Parse structured error from backend
      const errorData = err?.response?.data || err?.data || {};
      if (errorData.futureCount || (errorData.message && typeof errorData.message === 'object')) {
        const data = typeof errorData.message === 'object' ? errorData.message : errorData;
        setDisconnectModal({
          integrationId,
          futureCount: data.futureCount || 0,
          otherCalendars: data.otherCalendars || [],
          canReassign: data.canReassign || false,
        });
      } else {
        const msg = errorData.message || err?.message || '';
        if (msg.includes('future appointment') || msg.includes('Cannot disconnect')) {
          // Fallback: try to parse from text
          const count = parseInt(msg.match(/(\d+) future/)?.[1] || '0');
          setDisconnectModal({ integrationId, futureCount: count, otherCalendars: [], canReassign: false });
        } else {
          showToast(t("errors.disconnectCalendar"));
        }
      }
    }
  };

  const handleReassignAndDisconnect = async (targetId: string) => {
    if (!activeTenantId || !disconnectModal) return;
    setDisconnecting(true);
    try {
      await api.fetch(`/appointments/${activeTenantId}/calendar/${disconnectModal.integrationId}/reassign-disconnect`, {
        method: 'POST',
        body: JSON.stringify({ targetIntegrationId: targetId }),
      });
      setDisconnectModal(null);
      loadCalendarIntegrations();
      showToast(t("toasts.calendarDisconnected"));
    } catch (err: any) {
      showToast(err?.message || t("errors.disconnectCalendar"));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCancelAllAndDisconnect = async () => {
    if (!activeTenantId || !disconnectModal) return;
    setDisconnecting(true);
    try {
      // Cancel all future appointments, then disconnect
      const appts = await api.fetch(`/appointments/${activeTenantId}?status=pending,confirmed`);
      for (const appt of (appts?.data || [])) {
        if (new Date(appt.startAt) > new Date()) {
          await api.cancelAppointment(activeTenantId, appt.id).catch(() => {});
        }
      }
      await api.disconnectCalendar(activeTenantId, disconnectModal.integrationId);
      setDisconnectModal(null);
      loadCalendarIntegrations();
      loadAppointments();
      showToast(t("toasts.calendarDisconnected"));
    } catch (err: any) {
      showToast(err?.message || t("errors.disconnectCalendar"));
    } finally {
      setDisconnecting(false);
    }
  };

  /* ================================================================ */
  /*  Filtered list (agenda)                                           */
  /* ================================================================ */

  const filteredAppointments = useMemo(() => {
    let list = [...appointments];
    if (filterStatus) list = list.filter((a) => a.status === filterStatus);
    if (filterStartDate) list = list.filter((a) => toLocalDate(new Date(a.startAt)) >= filterStartDate);
    if (filterEndDate) list = list.filter((a) => toLocalDate(new Date(a.startAt)) <= filterEndDate);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.serviceName.toLowerCase().includes(q) ||
          a.contactName?.toLowerCase().includes(q) ||
          a.assignedName?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [appointments, filterStatus, filterStartDate, filterEndDate, searchQuery]);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  const tabs = [
    { id: "calendar" as const, label: t("calendar"), icon: CalendarDays },
    { id: "agenda" as const, label: t("agenda"), icon: List },
    ...(canManageSettings ? [
      { id: "services" as const, label: t("servicesSection.title"), icon: Tag },
      { id: "config" as const, label: t("configSection.title"), icon: Settings },
    ] : []),
    ...(canSeeGlobalAnalytics ? [
      { id: "analytics" as const, label: t("analyticsTab"), icon: BarChart3 },
    ] : []),
  ];

  return (
    <>
      <div className="max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          action={
            <button onClick={() => openCreateModal()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect">
              <Plus size={16} /> {t("newAppointment")}
            </button>
          }
        />

        <HelpPanel
          title={tHelp("appointments.title")}
          description={tHelp("appointments.description")}
          tips={tHelp.raw("appointments.tips") as string[]}
          mediaKey="appointments"
        />

        {/* ── KPI row (compact) ─────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-stagger">
          {[
            { label: t("status.pending"), value: kpis.pending, color: "text-amber-500" },
            { label: t("status.confirmed"), value: kpis.confirmed, color: "text-emerald-500" },
            { label: t("status.completed"), value: kpis.completed, color: "text-blue-500" },
            { label: `${t("total")} ${t("thisWeek")}`, value: kpis.total, color: "text-neutral-900 dark:text-neutral-100" },
          ].map(k => (
            <div key={k.label} className="flex items-center justify-between px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{k.label}</span>
              <span className={cn("text-lg font-semibold tabular-nums", k.color)}>{k.value}</span>
            </div>
          ))}
        </div>

        {/* ── Calendar sync banner ─────────────────────────────── */}
        {calendarIntegrations.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto">
              {calendarIntegrations.map((cal: any, i: number) => (
                <div key={cal.id} className="flex items-center gap-1.5 shrink-0">
                  {i > 0 && <span className="text-neutral-300 dark:text-neutral-700 mx-1">·</span>}
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  {cal.provider === "google" ? <GoogleIcon size={14} /> : <MicrosoftIcon size={14} />}
                  <span className="text-xs text-neutral-600 dark:text-neutral-400 truncate max-w-[180px]">
                    {cal.account_email || cal.email || t("connected")}
                  </span>
                  {(cal.label || cal.assignment_type) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 shrink-0">
                      {cal.label || t(cal.assignment_type === "service" ? "assignmentService" : cal.assignment_type === "staff" ? "assignmentStaff" : "assignmentGeneral")}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {lastSyncAt && (
                <span className="text-[10px] text-neutral-400 dark:text-neutral-500 hidden sm:inline">
                  {getTimeSince(lastSyncAt)}
                </span>
              )}
              <button
                onClick={handleSyncCalendar}
                disabled={syncing}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-neutral-200 dark:border-neutral-700 bg-transparent text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
                {syncing ? t("syncingCalendar") : t("syncNowBtn")}
              </button>
            </div>
          </div>
        )}

        {canManageSettings && calendarIntegrations.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700">
            <Link2 size={14} className="text-neutral-400" />
            <span className="text-xs text-neutral-500 dark:text-neutral-400 flex-1">{t('syncCalendarDesc')}</span>
            <button onClick={() => handleConnectCalendar("google")} disabled={connectingCalendar}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 cursor-pointer bg-transparent border-none hover:underline disabled:opacity-50">
              {t('syncCalendar')}
            </button>
          </div>
        )}

        <TabNav tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as typeof activeTab)} />

        {/* ============================================================ */}
        {/*  LOADING STATE                                                */}
        {/* ============================================================ */}
        {loading && (activeTab === "calendar" || activeTab === "agenda") && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-20 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* TAB: CALENDAR */}
        {activeTab === "calendar" && !loading && (
          <CalendarGrid
            appointments={appointments}
            services={services}
            externalEvents={externalEvents}
            weekStart={weekStart}
            dateLocale={dateLocale}
            onWeekChange={setWeekStart}
            onCreateAppointment={openCreateModal}
            onEditAppointment={openEditModal}
            onReschedule={handleReschedule}
            hasConnectedCalendar={calendarIntegrations.length > 0}
            syncing={syncing}
            onSync={handleSyncCalendar}
          />
        )}


        {/* TAB: AGENDA */}
        {activeTab === "agenda" && !loading && (
          <AgendaTab
            appointments={appointments}
            services={services}
            dateLocale={dateLocale}
            onEditAppointment={openEditModal}
            onQuickAction={handleQuickAction}
          />
        )}


        {/* TAB: SERVICIOS */}
        {activeTab === "services" && (
          <ServicesTab
            services={services}
            loading={loadingServices}
            activeTenantId={activeTenantId}
            onCreateService={openCreateServiceModal}
            onEditService={openEditServiceModal}
            onDeleteService={handleDeleteService}
            onToggleActive={handleToggleServiceActive}
          />
        )}


        {/* ============================================================ */}
        {/*  TAB: CONFIGURACION (refactored component)                    */}
        {/* ============================================================ */}
        {activeTab === "config" && activeTenantId && (
          <ConfigTab
            activeTenantId={activeTenantId}
            availabilitySlots={availabilitySlots}
            setAvailabilitySlots={setAvailabilitySlots}
            hasSavedAvailability={hasSavedAvailability}
            blockedDates={blockedDates}
            calendarIntegrations={calendarIntegrations}
            externalEventsCount={externalEvents.length}
            onConnectCalendar={handleConnectCalendar}
            onDisconnectCalendar={handleDisconnectCalendar}
            onSaveAvailability={handleSaveAvailability}
            onAddBlockedDate={handleAddBlockedDate}
            onDeleteBlockedDate={handleDeleteBlockedDate}
            onRefresh={() => { loadCalendarIntegrations(); loadBlockedDates(); loadAvailability(); loadReminderSettings(); }}
            showToast={showToast}
            services={services.map(s => ({ id: s.id, name: s.name }))}
            reminderSettings={reminderSettings}
            onUpdateReminderSettings={handleUpdateReminderSettings}
            bookingFlowsConfig={bookingFlowsConfig}
            onUpdateBookingFlows={handleUpdateBookingFlows}
          />
        )}

        {/* TAB: ANALYTICS */}
        {activeTab === "analytics" && activeTenantId && (
          <AnalyticsTab activeTenantId={activeTenantId} />
        )}
      </div>{/* end max-w */}

      {/* MODAL: Appointment */}
      {showModal && (
        <AppointmentModal
          form={modalForm}
          onChange={setModalForm}
          services={services}
          contacts={appointmentContacts}
          contactsLoading={loadingAppointmentContacts}
          contactsLoadFailed={appointmentContactsLoadFailed}
          contactSearch={appointmentContactSearch}
          onContactSearchChange={setAppointmentContactSearch}
          contactsHasMore={appointmentContactsHasMore}
          onLoadMoreContacts={loadMoreAppointmentContacts}
          onRetryContacts={retryAppointmentContacts}
          editingAppointment={editingAppointment}
          saving={saving}
          onSave={handleSave}
          onSaveRecurring={handleSaveRecurring}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* MODAL: Service */}
      {showServiceModal && (
        <ServiceModal
          form={serviceForm}
          onChange={setServiceForm}
          editingService={editingService}
          saving={savingService}
          onSave={handleSaveService}
          onClose={() => setShowServiceModal(false)}
        />
      )}


      {/* TOAST */}
      {/* Disconnect Calendar Modal */}
      {disconnectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => !disconnecting && setDisconnectModal(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                <AlertTriangle size={20} className="text-amber-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold m-0">{t("disconnectCalendarTitle")}</h3>
                <p className="text-xs text-muted-foreground m-0">{t("disconnectCalendarCount", { count: disconnectModal.futureCount })}</p>
              </div>
            </div>

            <div className="space-y-3">
              {disconnectModal.canReassign && disconnectModal.otherCalendars.length > 0 && (
                <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                  <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-2">{t("reassignOption")}</p>
                  {disconnectModal.otherCalendars.map((cal: any) => (
                    <button
                      key={cal.id}
                      onClick={() => handleReassignAndDisconnect(cal.id)}
                      disabled={disconnecting}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-indigo-500/5 text-sm cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-500/15 transition-colors mb-1 disabled:opacity-50"
                    >
                      <span className="flex-1 text-left font-medium">{cal.label}</span>
                      <span className="text-xs text-muted-foreground">{cal.provider}</span>
                    </button>
                  ))}
                </div>
              )}

              {!disconnectModal.canReassign && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                  <p className="text-xs text-amber-700 dark:text-amber-300">{t("noOtherCalendar")}</p>
                </div>
              )}

              <button
                onClick={handleCancelAllAndDisconnect}
                disabled={disconnecting}
                className="w-full py-2 px-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium cursor-pointer hover:bg-red-100 dark:hover:bg-red-500/15 transition-colors disabled:opacity-50"
              >
                {t("cancelAllAndDisconnect")}
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setDisconnectModal(null)}
                disabled={disconnecting}
                className="px-4 py-2 rounded-lg border border-border bg-transparent text-sm text-muted-foreground cursor-pointer hover:bg-muted transition-colors"
              >
                {tc("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 size={16} className="text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </>
  );
}
