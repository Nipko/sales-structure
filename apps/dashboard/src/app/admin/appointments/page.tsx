"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import ConfigTab from "@/components/appointments/ConfigTab";
import ServicesTab from "@/components/appointments/ServicesTab";
import CalendarGrid from "@/components/appointments/CalendarGrid";
import AgendaTab from "@/components/appointments/AgendaTab";
import AppointmentModal from "@/components/appointments/AppointmentModal";
import ServiceModal from "@/components/appointments/ServiceModal";
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
} from "lucide-react";

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
  const locale = useLocale();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : "es-MX";
  const { activeTenantId } = useTenant();
  const { user } = useAuth();

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
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [calendarIntegrations, setCalendarIntegrations] = useState<CalendarIntegration[]>([]);
  const [externalEvents, setExternalEvents] = useState<any[]>([]);

  // ---- UI state ----
  const [activeTab, setActiveTab] = useState<"calendar" | "agenda" | "services" | "config">("calendar");
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

  // ---- Service modal ----
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({
    name: "",
    duration: 30,
    buffer: 0,
    price: 0,
    color: "#6c5ce7",
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
      if (res?.success && res.data?.slots?.length) {
        const merged = DAY_KEYS.map((_, i) => {
          const existing = res.data.slots.find((s: any) => s.dayOfWeek === i + 1);
          return existing
            ? { ...existing, active: true }
            : { dayOfWeek: i + 1, startTime: "09:00", endTime: "18:00", active: false };
        });
        setAvailabilitySlots(merged);
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
          buffer: s.bufferMinutes || s.buffer || 0,
          price: parseFloat(s.price || 0),
          color: s.color || '#6c5ce7',
          active: s.isActive ?? s.active ?? true,
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

  // Initial load (including calendar integrations for banner visibility)
  useEffect(() => {
    loadAppointments();
    loadServices();
    loadCalendarIntegrations();
  }, [loadAppointments, loadServices, loadCalendarIntegrations]);

  // Load external events when calendar is connected and week changes
  useEffect(() => {
    loadExternalEvents();
  }, [loadExternalEvents]);

  // Tab-dependent loads
  useEffect(() => {
    if (activeTab === "config") {
      loadAvailability();
      loadBlockedDates();
      loadCalendarIntegrations();
    }
  }, [activeTab, loadAvailability, loadBlockedDates, loadCalendarIntegrations]);

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

  const openCreateModal = (date?: Date, hour?: number) => {
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
  };

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
      if (editingAppointment) {
        await api.updateAppointment(activeTenantId, editingAppointment.id, payload);
        showToast(t("editAppointment") + " ✓");
      } else {
        await api.createAppointment(activeTenantId, payload);
        showToast(t("newAppointment") + " ✓");
      }
      setShowModal(false);
      loadAppointments();
    } catch {
      showToast(t("errors.saveAppointment"));
    }
    setSaving(false);
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
      const activeSlots = availabilitySlots
        .filter((s) => s.active)
        .map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime }));
      await api.saveAvailability(activeTenantId, { userId: undefined, slots: activeSlots });
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
    setServiceForm({ name: "", duration: 30, buffer: 0, price: 0, color: "#6c5ce7" });
    setShowServiceModal(true);
  };

  const openEditServiceModal = (svc: Service) => {
    setEditingService(svc);
    setServiceForm({
      name: svc.name,
      duration: svc.duration,
      buffer: svc.buffer,
      price: svc.price,
      color: svc.color,
    });
    setShowServiceModal(true);
  };

  const handleSaveService = async () => {
    if (!activeTenantId || !serviceForm.name) return;
    setSavingService(true);
    try {
      if (editingService) {
        await api.updateService(activeTenantId, editingService.id, serviceForm);
        showToast(t("toasts.serviceUpdated"));
      } else {
        await api.createService(activeTenantId, serviceForm);
        showToast(t("toasts.serviceCreated"));
      }
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

  const handleConnectCalendar = async (provider: "google" | "microsoft") => {
    if (!activeTenantId) return;
    setConnectingCalendar(true);
    try {
      const res =
        provider === "google"
          ? await api.connectGoogleCalendar(activeTenantId)
          : await api.connectMicrosoftCalendar(activeTenantId);
      if (res?.data?.url) {
        window.location.href = res.data.url;
      }
    } catch {
      showToast(t("errors.connectCalendar"));
    }
    setConnectingCalendar(false);
  };

  const handleDisconnectCalendar = async (integrationId: string) => {
    if (!activeTenantId) return;
    try {
      await api.disconnectCalendar(activeTenantId, integrationId);
      loadCalendarIntegrations();
      showToast(t("toasts.calendarDisconnected"));
    } catch {
      showToast(t("errors.disconnectCalendar"));
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
    { id: "services" as const, label: t("servicesSection.title"), icon: Tag },
    { id: "config" as const, label: t("configSection.title"), icon: Settings },
  ];

  return (
    <>
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* ============================================================ */}
        {/*  HEADER                                                       */}
        {/* ============================================================ */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <CalendarDays size={24} className="text-primary" />
              </div>
              {t("title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-[52px]">
              {t("subtitle")}
            </p>
          </div>
          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus size={18} />
            {t("newAppointment")}
          </button>
        </div>

        {/* ============================================================ */}
        {/*  KPI CARDS                                                    */}
        {/* ============================================================ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: `${t("total")} ${t("thisWeek")}`,
              value: kpis.total,
              icon: CalendarDays,
              iconBg: "bg-violet-50 dark:bg-violet-500/10",
              iconColor: "text-violet-600 dark:text-violet-400",
            },
            {
              label: t("status.pending"),
              value: kpis.pending,
              icon: AlertCircle,
              iconBg: "bg-amber-50 dark:bg-amber-500/10",
              iconColor: "text-amber-600 dark:text-amber-400",
            },
            {
              label: t("status.confirmed"),
              value: kpis.confirmed,
              icon: CheckCircle2,
              iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
              iconColor: "text-emerald-600 dark:text-emerald-400",
            },
            {
              label: t("status.completed"),
              value: kpis.completed,
              icon: CalendarCheck,
              iconBg: "bg-blue-50 dark:bg-blue-500/10",
              iconColor: "text-blue-600 dark:text-blue-400",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {stat.label}
                  </p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
                    {stat.value}
                  </p>
                </div>
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", stat.iconBg)}>
                  <stat.icon size={22} className={stat.iconColor} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ============================================================ */}
        {/*  CONNECTED CALENDAR BANNER                                   */}
        {/* ============================================================ */}
        {calendarIntegrations.length > 0 && (
          <div className="flex items-center gap-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
              <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {calendarIntegrations.map((cal: any) => (
                  <span key={cal.id} className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    {cal.provider === 'microsoft' ? '📅 Outlook' : '📅 Google'} Calendar
                    <span className="text-xs text-emerald-500 dark:text-emerald-400">({cal.account_email || cal.accountEmail || t('connected')})</span>
                  </span>
                ))}
              </div>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                {externalEvents.length > 0
                  ? t('eventsSynced', { count: externalEvents.length })
                  : t('synced')}
                {' · '}{t('timezone')}: America/Bogota (UTC-5)
              </p>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/*  CALENDAR SYNC BANNER (shows when no calendar connected)     */}
        {/* ============================================================ */}
        {calendarIntegrations.length === 0 && (
          <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border border-blue-200 dark:border-blue-500/20">
            <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
              <Link2 size={22} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('syncCalendar')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('syncCalendarDesc')}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleConnectCalendar("google")} disabled={connectingCalendar}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:shadow-md transition-shadow disabled:opacity-50">
                <GoogleIcon size={16} /> Google
              </button>
              <button onClick={() => handleConnectCalendar("microsoft")} disabled={connectingCalendar}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:shadow-md transition-shadow disabled:opacity-50">
                <MicrosoftIcon size={16} /> Outlook
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/*  TAB BAR (pill style)                                         */}
        {/* ============================================================ */}
        <div className="flex gap-1 p-1.5 bg-gray-100 dark:bg-gray-800/60 rounded-xl w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer border-none",
                activeTab === tab.id
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-transparent"
              )}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ============================================================ */}
        {/*  LOADING STATE                                                */}
        {/* ============================================================ */}
        {loading && (activeTab === "calendar" || activeTab === "agenda") && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('loadingAppointments')}</p>
            </div>
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
            blockedDates={blockedDates}
            calendarIntegrations={calendarIntegrations}
            externalEventsCount={externalEvents.length}
            onConnectCalendar={handleConnectCalendar}
            onDisconnectCalendar={handleDisconnectCalendar}
            onSaveAvailability={handleSaveAvailability}
            onAddBlockedDate={handleAddBlockedDate}
            onDeleteBlockedDate={handleDeleteBlockedDate}
            onRefresh={() => { loadCalendarIntegrations(); loadBlockedDates(); loadAvailability(); }}
            showToast={showToast}
          />
        )}
      </div>

      {/* MODAL: Appointment */}
      {showModal && (
        <AppointmentModal
          form={modalForm}
          onChange={setModalForm}
          services={services}
          editingAppointment={editingAppointment}
          saving={saving}
          onSave={handleSave}
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
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-5 py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 size={16} className="text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </>
  );
}
