"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  List,
  Clock,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CalendarCheck,
  CalendarX,
  UserCheck,
  MapPin,
  FileText,
  Save,
  Trash2,
  Ban,
  Eye,
  Tag,
  Pencil,
  Link2,
  Unlink,
  Search,
  Settings,
  CalendarClock,
  Timer,
  DollarSign,
  ToggleLeft,
  ToggleRight,
  Calendar,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Appointment {
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
}

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

interface Service {
  id: string;
  name: string;
  duration: number;
  buffer: number;
  price: number;
  color: string;
  active: boolean;
}

interface CalendarIntegration {
  id: string;
  provider: "google" | "microsoft";
  email: string;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; twText: string; twBg: string }
> = {
  pending: {
    label: "Pendiente",
    color: "#f59e0b",
    bg: "#f59e0b15",
    twText: "text-amber-500 dark:text-amber-400",
    twBg: "bg-amber-50 dark:bg-amber-500/10",
  },
  confirmed: {
    label: "Confirmada",
    color: "#22c55e",
    bg: "#22c55e15",
    twText: "text-emerald-600 dark:text-emerald-400",
    twBg: "bg-emerald-50 dark:bg-emerald-500/10",
  },
  cancelled: {
    label: "Cancelada",
    color: "#ef4444",
    bg: "#ef444415",
    twText: "text-red-500 dark:text-red-400",
    twBg: "bg-red-50 dark:bg-red-500/10",
  },
  completed: {
    label: "Completada",
    color: "#3b82f6",
    bg: "#3b82f615",
    twText: "text-blue-600 dark:text-blue-400",
    twBg: "bg-blue-50 dark:bg-blue-500/10",
  },
  no_show: {
    label: "No asistio",
    color: "#6b7280",
    bg: "#6b728015",
    twText: "text-gray-500 dark:text-gray-400",
    twBg: "bg-gray-50 dark:bg-gray-500/10",
  },
};

const DAY_NAMES = [
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
  "Domingo",
];

const DAY_NAMES_SHORT = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7-20

const DURATION_PRESETS = [15, 30, 45, 60, 90];

const SERVICE_COLORS = [
  "#6c5ce7",
  "#00d68f",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#06b6d4",
];

/* ------------------------------------------------------------------ */
/*  Utility functions                                                  */
/* ------------------------------------------------------------------ */

function fmt2(n: number) {
  return n.toString().padStart(2, "0");
}

function toLocalDate(d: Date) {
  return `${d.getFullYear()}-${fmt2(d.getMonth() + 1)}-${fmt2(d.getDate())}`;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

function formatWeekRange(start: Date, end: Date) {
  const s = start.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
  });
  const e = end.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${s} - ${e}`;
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
  const { activeTenantId } = useTenant();
  const { user } = useAuth();

  // ---- Data state ----
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>(
    DAY_NAMES.map((_, i) => ({
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
        const merged = DAY_NAMES.map((_, i) => {
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
        showToast("Cita actualizada correctamente");
      } else {
        await api.createAppointment(activeTenantId, payload);
        showToast("Cita creada correctamente");
      }
      setShowModal(false);
      loadAppointments();
    } catch {
      showToast("Error al guardar la cita");
    }
    setSaving(false);
  };

  const handleQuickAction = async (apptId: string, action: "confirm" | "cancel" | "complete") => {
    if (!activeTenantId) return;
    try {
      if (action === "cancel") {
        await api.cancelAppointment(activeTenantId, apptId);
        showToast("Cita cancelada");
      } else {
        const statusMap = { confirm: "confirmed", complete: "completed" };
        await api.updateAppointment(activeTenantId, apptId, { status: statusMap[action] });
        showToast(action === "confirm" ? "Cita confirmada" : "Cita completada");
      }
      loadAppointments();
    } catch {
      showToast("Error al actualizar la cita");
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
      showToast("Disponibilidad guardada");
    } catch {
      showToast("Error al guardar disponibilidad");
    }
    setSavingAvailability(false);
  };

  const handleAddBlockedDate = async () => {
    if (!activeTenantId || !newBlockedDate) return;
    try {
      await api.saveBlockedDate(activeTenantId, {
        blockedDate: newBlockedDate,
        reason: newBlockedReason || undefined,
      });
      setNewBlockedDate("");
      setNewBlockedReason("");
      loadBlockedDates();
      showToast("Fecha bloqueada agregada");
    } catch {
      showToast("Error al agregar fecha bloqueada");
    }
  };

  const handleDeleteBlockedDate = async (dateId: string) => {
    if (!activeTenantId) return;
    try {
      await api.deleteBlockedDate(activeTenantId, dateId);
      loadBlockedDates();
      showToast("Fecha bloqueada eliminada");
    } catch {
      showToast("Error al eliminar fecha bloqueada");
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
        showToast("Servicio actualizado");
      } else {
        await api.createService(activeTenantId, serviceForm);
        showToast("Servicio creado");
      }
      setShowServiceModal(false);
      loadServices();
    } catch {
      showToast("Error al guardar servicio");
    }
    setSavingService(false);
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!activeTenantId) return;
    try {
      await api.deleteService(activeTenantId, serviceId);
      loadServices();
      showToast("Servicio eliminado");
    } catch {
      showToast("Error al eliminar servicio");
    }
  };

  const handleToggleServiceActive = async (svc: Service) => {
    if (!activeTenantId) return;
    try {
      await api.updateService(activeTenantId, svc.id, { active: !svc.active });
      loadServices();
    } catch {
      showToast("Error al actualizar servicio");
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
      showToast("Error al conectar calendario");
    }
    setConnectingCalendar(false);
  };

  const handleDisconnectCalendar = async (integrationId: string) => {
    if (!activeTenantId) return;
    try {
      await api.disconnectCalendar(activeTenantId, integrationId);
      loadCalendarIntegrations();
      showToast("Calendario desconectado");
    } catch {
      showToast("Error al desconectar calendario");
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
    { id: "agenda" as const, label: "Agenda", icon: List },
    { id: "services" as const, label: "Servicios", icon: Tag },
    { id: "config" as const, label: "Configuracion", icon: Settings },
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
              Gestiona las citas y la agenda de tu equipo
            </p>
          </div>
          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus size={18} />
            Nueva cita
          </button>
        </div>

        {/* ============================================================ */}
        {/*  KPI CARDS                                                    */}
        {/* ============================================================ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Total esta semana",
              value: kpis.total,
              icon: CalendarDays,
              iconBg: "bg-violet-50 dark:bg-violet-500/10",
              iconColor: "text-violet-600 dark:text-violet-400",
            },
            {
              label: "Pendientes",
              value: kpis.pending,
              icon: AlertCircle,
              iconBg: "bg-amber-50 dark:bg-amber-500/10",
              iconColor: "text-amber-600 dark:text-amber-400",
            },
            {
              label: "Confirmadas",
              value: kpis.confirmed,
              icon: CheckCircle2,
              iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
              iconColor: "text-emerald-600 dark:text-emerald-400",
            },
            {
              label: "Completadas",
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
                    <span className="text-xs text-emerald-500 dark:text-emerald-400">({cal.account_email || cal.accountEmail || 'conectado'})</span>
                  </span>
                ))}
              </div>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                {externalEvents.length > 0
                  ? `${externalEvents.length} evento(s) sincronizado(s) esta semana`
                  : 'Sincronizado'}
                {' · '}Zona horaria: America/Bogota (UTC-5)
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
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Sincroniza tu calendario</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Conecta Google Calendar u Outlook para evitar conflictos de horario</p>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">Cargando citas...</p>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/*  TAB: CALENDARIO                                              */}
        {/* ============================================================ */}
        {activeTab === "calendar" && !loading && (
          <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            {/* Week navigation */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <button
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-600 dark:text-gray-300"
                title="Semana anterior"
              >
                <ChevronLeft size={20} />
              </button>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setWeekStart(getMondayOfWeek(new Date()))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Hoy
                </button>
                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                  {formatWeekRange(weekDays[0], weekDays[6])}
                </span>
              </div>

              <button
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-600 dark:text-gray-300"
                title="Semana siguiente"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-[56px_repeat(7,1fr)]">
              <div className="border-b border-gray-200 dark:border-gray-800" />
              {weekDays.map((day, i) => {
                const isToday = toLocalDate(day) === todayStr;
                return (
                  <div
                    key={i}
                    className={cn(
                      "text-center py-3 border-b border-l border-gray-200 dark:border-gray-800",
                      isToday && "bg-primary/5"
                    )}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {DAY_NAMES_SHORT[i]}
                    </div>
                    <div
                      className={cn(
                        "text-lg font-bold mt-0.5",
                        isToday
                          ? "text-primary"
                          : "text-gray-900 dark:text-white"
                      )}
                    >
                      {isToday ? (
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm">
                          {day.getDate()}
                        </span>
                      ) : (
                        day.getDate()
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Time grid */}
            <div className="grid grid-cols-[56px_repeat(7,1fr)] max-h-[calc(14*64px)] overflow-y-auto">
              {HOURS.map((hour) => (
                <div key={`row-${hour}`} className="contents">
                  <div className="h-16 flex items-start justify-end pr-2 pt-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800/50">
                    {fmt2(hour)}:00
                  </div>
                  {weekDays.map((day, di) => {
                    const isToday = toLocalDate(day) === todayStr;
                    return (
                      <div
                        key={`${hour}-${di}`}
                        className={cn(
                          "h-16 border-b border-l border-gray-100 dark:border-gray-800/50 relative cursor-pointer hover:bg-primary/5 transition-colors",
                          isToday && "bg-primary/[0.02]"
                        )}
                        onClick={() => openCreateModal(day, hour)}
                      >
                        {hour === 7 && (<>
                          {/* Internal appointments */}
                          {getAppointmentsForDay(day).map((appt) => {
                            const pos = getAppointmentPosition(appt);
                            const svc = services.find((s) => s.name === appt.serviceName);
                            const blockColor = svc?.color || STATUS_CONFIG[appt.status]?.color || "#6c5ce7";
                            return (
                              <div
                                key={appt.id}
                                className="absolute left-1 right-1 rounded-lg px-2 py-1 text-[10px] leading-tight overflow-hidden cursor-pointer z-10 border-l-[3px] shadow-sm"
                                style={{
                                  top: `${pos.top}px`,
                                  height: `${pos.height}px`,
                                  background: `${blockColor}15`,
                                  borderLeftColor: blockColor,
                                  color: blockColor,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal(appt);
                                }}
                              >
                                <div className="font-semibold truncate">{appt.serviceName}</div>
                                {pos.height > 30 && (
                                  <div className="truncate opacity-80">
                                    {formatTime(appt.startAt)} - {formatTime(appt.endAt)}
                                  </div>
                                )}
                                {pos.height > 48 && appt.contactName && (
                                  <div className="truncate opacity-70">{appt.contactName}</div>
                                )}
                              </div>
                            );
                          })}
                          {/* External calendar events (Google/Microsoft) */}
                          {externalEvents
                            .filter(evt => {
                              if (evt.allDay) return false;
                              const evtDate = evt.start ? toLocalDate(new Date(evt.start)) : '';
                              return evtDate === toLocalDate(day);
                            })
                            .map(evt => {
                              const start = new Date(evt.start);
                              const end = new Date(evt.end);
                              const startMin = start.getHours() * 60 + start.getMinutes();
                              const endMin = end.getHours() * 60 + end.getMinutes();
                              const topOffset = startMin - 7 * 60;
                              const height = Math.max((endMin - startMin) / 60 * 64, 20);
                              const extColor = evt.provider === 'microsoft' ? '#0078d4' : '#4285f4';
                              return (
                                <div
                                  key={`ext-${evt.id}`}
                                  className="absolute left-1 right-1 rounded-lg px-2 py-1 text-[10px] leading-tight overflow-hidden z-[5] border-l-[3px] opacity-70"
                                  style={{
                                    top: `${(topOffset / 60) * 64}px`,
                                    height: `${height}px`,
                                    background: `${extColor}12`,
                                    borderLeftColor: extColor,
                                    color: extColor,
                                    borderStyle: 'dashed',
                                  }}
                                  title={`${evt.title} (${evt.provider === 'microsoft' ? 'Outlook' : 'Google'})`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (evt.htmlLink) window.open(evt.htmlLink, '_blank');
                                  }}
                                >
                                  <div className="font-medium truncate flex items-center gap-1">
                                    <span className="opacity-60">{evt.provider === 'microsoft' ? '📅' : '📆'}</span>
                                    {evt.title}
                                  </div>
                                  {height > 30 && (
                                    <div className="truncate opacity-80">
                                      {start.getHours()}:{String(start.getMinutes()).padStart(2,'0')} - {end.getHours()}:{String(end.getMinutes()).padStart(2,'0')}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </>)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/*  TAB: AGENDA                                                  */}
        {/* ============================================================ */}
        {activeTab === "agenda" && !loading && (
          <div className="space-y-4">
            {/* Search & filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por servicio, cliente o agente..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>

              {/* Status filter pills */}
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={() => setFilterStatus("")}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                    !filterStatus
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                  )}
                >
                  Todos
                </button>
                {Object.entries(STATUS_CONFIG).map(([key, sc]) => (
                  <button
                    key={key}
                    onClick={() => setFilterStatus(filterStatus === key ? "" : key)}
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                      filterStatus === key
                        ? `${sc.twBg} ${sc.twText} border-current`
                        : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
                    )}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div className="flex gap-3 items-center flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Desde</label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Hasta</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {(filterStartDate || filterEndDate || searchQuery) && (
                <button
                  onClick={() => {
                    setFilterStartDate("");
                    setFilterEndDate("");
                    setSearchQuery("");
                    setFilterStatus("");
                  }}
                  className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none"
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
              {filteredAppointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                    <CalendarDays size={28} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    No hay citas para mostrar
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Ajusta los filtros o crea una nueva cita
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      {["Servicio", "Cliente", "Fecha / Hora", "Agente", "Estado", "Acciones"].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                    {filteredAppointments.map((appt) => {
                      const sc = STATUS_CONFIG[appt.status];
                      const svc = services.find((s) => s.name === appt.serviceName);
                      return (
                        <tr
                          key={appt.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: svc?.color || "#6c5ce7" }}
                              />
                              <span className="font-medium text-gray-900 dark:text-white">
                                {appt.serviceName}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                            {appt.contactName || (
                              <span className="text-gray-400">Sin asignar</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="text-gray-900 dark:text-white text-sm">
                              {formatDate(appt.startAt)}
                            </div>
                            <div className="text-gray-400 text-xs mt-0.5">
                              {formatTime(appt.startAt)} - {formatTime(appt.endAt)}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                            {appt.assignedName || (
                              <span className="text-gray-400">Sin agente</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={cn(
                                "inline-flex items-center text-[11px] px-2.5 py-1 rounded-full font-semibold",
                                sc.twBg,
                                sc.twText
                              )}
                            >
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditModal(appt)}
                                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                title="Ver detalles"
                              >
                                <Eye size={15} />
                              </button>
                              {appt.status === "pending" && (
                                <button
                                  onClick={() => handleQuickAction(appt.id, "confirm")}
                                  className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer border-none bg-transparent text-emerald-500"
                                  title="Confirmar"
                                >
                                  <CheckCircle2 size={15} />
                                </button>
                              )}
                              {(appt.status === "pending" || appt.status === "confirmed") && (
                                <>
                                  <button
                                    onClick={() => handleQuickAction(appt.id, "complete")}
                                    className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer border-none bg-transparent text-blue-500"
                                    title="Completar"
                                  >
                                    <CalendarCheck size={15} />
                                  </button>
                                  <button
                                    onClick={() => handleQuickAction(appt.id, "cancel")}
                                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent text-red-500"
                                    title="Cancelar"
                                  >
                                    <Ban size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/*  TAB: SERVICIOS                                               */}
        {/* ============================================================ */}
        {activeTab === "services" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Servicios disponibles
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Configura los servicios que puedes agendar
                </p>
              </div>
              <button
                onClick={openCreateServiceModal}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer hover:opacity-90 transition-opacity"
              >
                <Plus size={16} />
                Nuevo servicio
              </button>
            </div>

            {loadingServices ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : services.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                  <Tag size={28} className="text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  No hay servicios configurados
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Crea tu primer servicio para comenzar a agendar
                </p>
                <button
                  onClick={openCreateServiceModal}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium cursor-pointer border-none hover:opacity-90"
                >
                  <Plus size={16} />
                  Crear servicio
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {services.map((svc) => (
                  <div
                    key={svc.id}
                    className={cn(
                      "relative rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-md transition-shadow",
                      !svc.active && "opacity-60"
                    )}
                  >
                    {/* Color stripe */}
                    <div className="h-1.5" style={{ backgroundColor: svc.color }} />

                    <div className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: svc.color }}
                          />
                          <h3 className="font-semibold text-gray-900 dark:text-white text-base">
                            {svc.name}
                          </h3>
                        </div>
                        {/* Active toggle */}
                        <button
                          onClick={() => handleToggleServiceActive(svc)}
                          className={cn(
                            "w-10 h-[22px] rounded-full relative transition-colors cursor-pointer border-none flex-shrink-0",
                            svc.active ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                              svc.active ? "left-[22px]" : "left-[3px]"
                            )}
                          />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium">
                          <Timer size={12} />
                          {svc.duration} min
                        </span>
                        {svc.buffer > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium">
                            <CalendarClock size={12} />
                            +{svc.buffer} min buffer
                          </span>
                        )}
                        {svc.price > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium">
                            <DollarSign size={12} />
                            ${svc.price.toLocaleString("es-CO")}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                        <button
                          onClick={() => openEditServiceModal(svc)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent"
                        >
                          <Pencil size={13} />
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteService(svc.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent"
                        >
                          <Trash2 size={13} />
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/*  TAB: CONFIGURACION                                           */}
        {/* ============================================================ */}
        {activeTab === "config" && (
          <div className="space-y-6">
            {/* ---- Section 1: Horario de atencion ---- */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
              <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Clock size={18} className="text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      Horario de atencion
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Define los horarios disponibles para agendar citas
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-3">
                {availabilitySlots.map((slot, i) => (
                  <div
                    key={slot.dayOfWeek}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border transition-all",
                      slot.active
                        ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                        : "border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30"
                    )}
                  >
                    <button
                      onClick={() => {
                        const updated = [...availabilitySlots];
                        updated[i] = { ...updated[i], active: !updated[i].active };
                        setAvailabilitySlots(updated);
                      }}
                      className={cn(
                        "w-10 h-[22px] rounded-full relative transition-colors cursor-pointer border-none flex-shrink-0",
                        slot.active ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                          slot.active ? "left-[22px]" : "left-[3px]"
                        )}
                      />
                    </button>

                    <span
                      className={cn(
                        "w-28 text-sm font-medium",
                        slot.active
                          ? "text-gray-900 dark:text-white"
                          : "text-gray-400 dark:text-gray-500"
                      )}
                    >
                      {DAY_NAMES[i]}
                    </span>

                    {slot.active ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={slot.startTime}
                          onChange={(e) => {
                            const updated = [...availabilitySlots];
                            updated[i] = { ...updated[i], startTime: e.target.value };
                            setAvailabilitySlots(updated);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        <span className="text-gray-400 text-sm">a</span>
                        <input
                          type="time"
                          value={slot.endTime}
                          onChange={(e) => {
                            const updated = [...availabilitySlots];
                            updated[i] = { ...updated[i], endTime: e.target.value };
                            setAvailabilitySlots(updated);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                        No disponible
                      </span>
                    )}
                  </div>
                ))}

                <div className="flex justify-end pt-3">
                  <button
                    onClick={handleSaveAvailability}
                    disabled={savingAvailability}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    <Save size={16} />
                    {savingAvailability ? "Guardando..." : "Guardar disponibilidad"}
                  </button>
                </div>
              </div>
            </div>

            {/* ---- Section 2: Calendarios conectados ---- */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
              <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-500/10">
                    <Link2 size={18} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      Calendarios conectados
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Sincroniza tus citas con calendarios externos
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {calendarIntegrations.length > 0 && (
                  <div className="space-y-3 mb-6">
                    {calendarIntegrations.map((cal) => (
                      <div
                        key={cal.id}
                        className="flex items-center justify-between p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30"
                      >
                        <div className="flex items-center gap-3">
                          {cal.provider === "google" ? (
                            <GoogleIcon size={22} />
                          ) : (
                            <MicrosoftIcon size={22} />
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              {cal.provider === "google" ? "Google Calendar" : "Outlook Calendar"}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-0.5">
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  cal.active ? "bg-emerald-500" : "bg-gray-400"
                                )}
                              />
                              {cal.email}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDisconnectCalendar(cal.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/30 bg-transparent text-red-500 text-xs font-medium cursor-pointer hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <Unlink size={13} />
                          Desconectar
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {calendarIntegrations.length === 0 && (
                  <div className="text-center py-6 mb-6">
                    <Calendar size={32} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Conecta tu calendario para sincronizar citas automaticamente
                    </p>
                  </div>
                )}

                {/* Connect CTAs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleConnectCalendar("google")}
                    disabled={connectingCalendar}
                    className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-transparent text-left cursor-pointer hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-all disabled:opacity-50 group"
                  >
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 group-hover:shadow-md transition-shadow">
                      <GoogleIcon size={22} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        Google Calendar
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Conectar cuenta de Google
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleConnectCalendar("microsoft")}
                    disabled={connectingCalendar}
                    className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-transparent text-left cursor-pointer hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-all disabled:opacity-50 group"
                  >
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 group-hover:shadow-md transition-shadow">
                      <MicrosoftIcon size={22} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        Outlook Calendar
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Conectar cuenta de Microsoft
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* ---- Section 3: Fechas bloqueadas ---- */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
              <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-50 dark:bg-red-500/10">
                    <CalendarX size={18} className="text-red-500 dark:text-red-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      Fechas bloqueadas
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Bloquea dias especificos para evitar agendamientos
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {/* Add form */}
                <div className="flex gap-3 mb-5 flex-wrap">
                  <input
                    type="date"
                    value={newBlockedDate}
                    onChange={(e) => setNewBlockedDate(e.target.value)}
                    className="px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="text"
                    placeholder="Motivo (opcional)"
                    value={newBlockedReason}
                    onChange={(e) => setNewBlockedReason(e.target.value)}
                    className="px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm flex-1 min-w-[200px] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={handleAddBlockedDate}
                    disabled={!newBlockedDate}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-none bg-red-500 text-white font-semibold text-sm cursor-pointer disabled:opacity-40 hover:bg-red-600 transition-colors"
                  >
                    <Plus size={16} />
                    Bloquear fecha
                  </button>
                </div>

                {/* Blocked dates list */}
                {blockedDates.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      No hay fechas bloqueadas
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {blockedDates.map((bd) => (
                      <div
                        key={bd.id}
                        className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-red-500" />
                          <div>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {new Date(bd.blockedDate + "T12:00:00").toLocaleDateString("es-MX", {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              })}
                            </span>
                            {bd.reason && (
                              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                                — {bd.reason}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteBlockedDate(bd.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent text-red-500"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/*  MODAL: Create / Edit Appointment                               */}
      {/* ============================================================== */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <CalendarDays size={18} className="text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {editingAppointment ? "Editar cita" : "Nueva cita"}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Service selector */}
              {services.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    Servicio
                  </label>
                  <select
                    value={services.find((s) => s.name === modalForm.serviceName)?.id || ""}
                    onChange={(e) => {
                      const selected = services.find((s) => s.id === e.target.value);
                      if (selected) {
                        const newForm = { ...modalForm, serviceName: selected.name };
                        if (newForm.startTime) {
                          const [h, m] = newForm.startTime.split(":").map(Number);
                          const totalMin = h * 60 + m + selected.duration;
                          const endH = Math.min(Math.floor(totalMin / 60), 23);
                          const endM = totalMin % 60;
                          newForm.endTime = `${fmt2(endH)}:${fmt2(endM)}`;
                        }
                        setModalForm(newForm);
                      }
                    }}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">-- Seleccionar servicio --</option>
                    {services
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.duration} min)
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Service name (manual fallback) */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Nombre del servicio *
                </label>
                <input
                  type="text"
                  placeholder="Ej: Consulta general"
                  value={modalForm.serviceName}
                  onChange={(e) => setModalForm({ ...modalForm, serviceName: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={modalForm.date}
                  onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Time row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    Hora inicio *
                  </label>
                  <input
                    type="time"
                    value={modalForm.startTime}
                    onChange={(e) => setModalForm({ ...modalForm, startTime: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                    Hora fin *
                  </label>
                  <input
                    type="time"
                    value={modalForm.endTime}
                    onChange={(e) => setModalForm({ ...modalForm, endTime: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  <MapPin size={14} className="inline mr-1.5 -mt-0.5" />
                  Ubicacion
                </label>
                <input
                  type="text"
                  placeholder="Ej: Oficina central"
                  value={modalForm.location}
                  onChange={(e) => setModalForm({ ...modalForm, location: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  <FileText size={14} className="inline mr-1.5 -mt-0.5" />
                  Notas
                </label>
                <textarea
                  rows={3}
                  placeholder="Notas adicionales..."
                  value={modalForm.notes}
                  onChange={(e) => setModalForm({ ...modalForm, notes: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm resize-none placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Assigned agent */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  <UserCheck size={14} className="inline mr-1.5 -mt-0.5" />
                  Agente asignado
                </label>
                <input
                  type="text"
                  placeholder="ID del agente"
                  value={modalForm.assignedTo}
                  onChange={(e) => setModalForm({ ...modalForm, assignedTo: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Contact */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Contacto
                </label>
                <input
                  type="text"
                  placeholder="ID del contacto"
                  value={modalForm.contactId}
                  onChange={(e) => setModalForm({ ...modalForm, contactId: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900 rounded-b-2xl">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !modalForm.serviceName || !modalForm.date}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                <Save size={16} />
                {saving ? "Guardando..." : editingAppointment ? "Actualizar" : "Crear cita"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/*  MODAL: Create / Edit Service                                   */}
      {/* ============================================================== */}
      {showServiceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowServiceModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: `${serviceForm.color}15` }}>
                  <Tag size={18} style={{ color: serviceForm.color }} />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {editingService ? "Editar servicio" : "Nuevo servicio"}
                </h2>
              </div>
              <button
                onClick={() => setShowServiceModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Nombre del servicio *
                </label>
                <input
                  type="text"
                  placeholder="Ej: Consulta general"
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Duration presets */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Duracion *
                </label>
                <div className="flex gap-2 mb-2">
                  {DURATION_PRESETS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setServiceForm({ ...serviceForm, duration: d })}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                        serviceForm.duration === d
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                      )}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={5}
                  value={serviceForm.duration || ""}
                  onChange={(e) => setServiceForm({ ...serviceForm, duration: e.target.value === "" ? 0 : Number(e.target.value) })}
                  className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Duracion personalizada en minutos"
                />
              </div>

              {/* Buffer + Price row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    Tiempo entre citas (min)
                    <span className="relative group">
                      <span className="w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] flex items-center justify-center cursor-help font-bold">?</span>
                      <span className="absolute bottom-6 left-1/2 -translate-x-1/2 w-48 p-2 rounded-lg bg-gray-900 text-white text-[11px] leading-relaxed hidden group-hover:block z-50 shadow-lg">
                        Tiempo de descanso entre una cita y la siguiente. Por ejemplo, 10 min para preparar el espacio.
                      </span>
                    </span>
                  </label>
                  <select
                    value={serviceForm.buffer}
                    onChange={(e) => setServiceForm({ ...serviceForm, buffer: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value={0}>Sin tiempo entre citas</option>
                    <option value={5}>5 minutos</option>
                    <option value={10}>10 minutos</option>
                    <option value={15}>15 minutos</option>
                    <option value={20}>20 minutos</option>
                    <option value={30}>30 minutos</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                    Precio
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={serviceForm.price > 0 ? serviceForm.price.toLocaleString('es-CO') : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setServiceForm({ ...serviceForm, price: raw ? Number(raw) : 0 });
                      }}
                      placeholder="0"
                      className="w-full px-3 pl-7 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">COP</span>
                  </div>
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Color
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2 flex-wrap">
                    {SERVICE_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setServiceForm({ ...serviceForm, color: c })}
                        className={cn(
                          "w-7 h-7 rounded-full cursor-pointer border-2 transition-all hover:scale-110",
                          serviceForm.color === c
                            ? "border-gray-900 dark:border-white scale-110 shadow-md"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={serviceForm.color}
                    onChange={(e) => setServiceForm({ ...serviceForm, color: e.target.value })}
                    className="w-8 h-8 rounded-lg cursor-pointer border-none bg-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={() => setShowServiceModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveService}
                disabled={savingService || !serviceForm.name}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                <Save size={16} />
                {savingService ? "Guardando..." : editingService ? "Actualizar" : "Crear servicio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/*  TOAST                                                          */}
      {/* ============================================================== */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-5 py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 size={16} className="text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </>
  );
}
