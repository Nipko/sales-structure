"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  pending: { label: "Pendiente", color: "#f59e0b", bg: "#f59e0b15" },
  confirmed: { label: "Confirmada", color: "#22c55e", bg: "#22c55e15" },
  cancelled: { label: "Cancelada", color: "#ef4444", bg: "#ef444415" },
  completed: { label: "Completada", color: "#3b82f6", bg: "#3b82f615" },
  no_show: { label: "No asistio", color: "#6b7280", bg: "#6b728015" },
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AppointmentsPage() {
  const t = useTranslations('appointments');
  const { activeTenantId } = useTenant();

  // Data
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [activeTab, setActiveTab] = useState<
    "calendar" | "list" | "availability"
  >("calendar");
  const [weekStart, setWeekStart] = useState<Date>(getMondayOfWeek(new Date()));
  const [toast, setToast] = useState<string | null>(null);

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null);
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

  // List filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // Availability
  const [availabilitySlots, setAvailabilitySlots] = useState<
    AvailabilitySlot[]
  >(
    DAY_NAMES.map((_, i) => ({
      dayOfWeek: i + 1,
      startTime: "09:00",
      endTime: "18:00",
      active: i < 5,
    }))
  );
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [newBlockedDate, setNewBlockedDate] = useState("");
  const [newBlockedReason, setNewBlockedReason] = useState("");
  const [savingAvailability, setSavingAvailability] = useState(false);

  /* ---- Toast helper ---- */
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  /* ---- Load appointments ---- */
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
          const existing = res.data.slots.find(
            (s: any) => s.dayOfWeek === i + 1
          );
          return existing
            ? { ...existing, active: true }
            : {
                dayOfWeek: i + 1,
                startTime: "09:00",
                endTime: "18:00",
                active: false,
              };
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
      if (res?.success) {
        setBlockedDates(res.data || []);
      }
    } catch {
      /* ignore */
    }
  }, [activeTenantId]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    if (activeTab === "availability") {
      loadAvailability();
      loadBlockedDates();
    }
  }, [activeTab, loadAvailability, loadBlockedDates]);

  /* ---- KPIs ---- */
  const kpis = useMemo(() => {
    const total = appointments.length;
    const pending = appointments.filter((a) => a.status === "pending").length;
    const confirmed = appointments.filter(
      (a) => a.status === "confirmed"
    ).length;
    const cancelled = appointments.filter(
      (a) => a.status === "cancelled"
    ).length;
    return { total, pending, confirmed, cancelled };
  }, [appointments]);

  /* ---- Week days ---- */
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  /* ---- Calendar helpers ---- */
  const getAppointmentsForDay = useCallback(
    (day: Date) => {
      const dayStr = toLocalDate(day);
      return appointments.filter((a) => {
        const aDate = toLocalDate(new Date(a.startAt));
        return aDate === dayStr;
      });
    },
    [appointments]
  );

  const getAppointmentPosition = (appt: Appointment) => {
    const start = new Date(appt.startAt);
    const end = new Date(appt.endAt);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const topOffset = startMinutes - 7 * 60; // relative to 7:00
    const height = endMinutes - startMinutes;
    return {
      top: (topOffset / 60) * 64, // 64px per hour
      height: Math.max((height / 60) * 64, 24),
    };
  };

  /* ---- Modal open/close ---- */
  const openCreateModal = (date?: Date, hour?: number) => {
    setEditingAppointment(null);
    setModalForm({
      serviceName: "",
      date: date ? toLocalDate(date) : toLocalDate(new Date()),
      startTime: hour !== undefined ? `${fmt2(hour)}:00` : "09:00",
      endTime:
        hour !== undefined ? `${fmt2(Math.min(hour + 1, 20))}:00` : "10:00",
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

  /* ---- CRUD ---- */
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
        await api.updateAppointment(
          activeTenantId,
          editingAppointment.id,
          payload
        );
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

  const handleQuickAction = async (
    apptId: string,
    action: "confirm" | "cancel" | "complete"
  ) => {
    if (!activeTenantId) return;
    try {
      if (action === "cancel") {
        await api.cancelAppointment(activeTenantId, apptId);
        showToast("Cita cancelada");
      } else {
        const statusMap = { confirm: "confirmed", complete: "completed" };
        await api.updateAppointment(activeTenantId, apptId, {
          status: statusMap[action],
        });
        showToast(
          action === "confirm" ? "Cita confirmada" : "Cita completada"
        );
      }
      loadAppointments();
    } catch {
      showToast("Error al actualizar la cita");
    }
  };

  /* ---- Availability CRUD ---- */
  const handleSaveAvailability = async () => {
    if (!activeTenantId) return;
    setSavingAvailability(true);
    try {
      const activeSlots = availabilitySlots
        .filter((s) => s.active)
        .map(({ dayOfWeek, startTime, endTime }) => ({
          dayOfWeek,
          startTime,
          endTime,
        }));
      await api.saveAvailability(activeTenantId, {
        userId: undefined,
        slots: activeSlots,
      });
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

  /* ---- Filtered list ---- */
  const filteredAppointments = useMemo(() => {
    let list = [...appointments];
    if (filterStatus) {
      list = list.filter((a) => a.status === filterStatus);
    }
    if (filterStartDate) {
      list = list.filter(
        (a) => toLocalDate(new Date(a.startAt)) >= filterStartDate
      );
    }
    if (filterEndDate) {
      list = list.filter(
        (a) => toLocalDate(new Date(a.startAt)) <= filterEndDate
      );
    }
    return list.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );
  }, [appointments, filterStatus, filterStartDate, filterEndDate]);

  /* ---- Today marker ---- */
  const todayStr = toLocalDate(new Date());

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <>
      <div>
        {/* ---- Header ---- */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-[28px] font-bold m-0 flex items-center gap-2.5">
              <CalendarDays size={28} className="text-primary" /> {t('title')}
            </h1>
            <p className="text-muted-foreground mt-1">
              Gestiona las citas de tu equipo
            </p>
          </div>
          <button
            onClick={() => openCreateModal()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer"
          >
            <Plus size={18} /> Nueva Cita
          </button>
        </div>

        {/* ---- KPI Cards ---- */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            {
              label: "Total esta semana",
              value: kpis.total,
              color: "#6c5ce7",
              icon: CalendarDays,
            },
            {
              label: "Pendientes",
              value: kpis.pending,
              color: "#f59e0b",
              icon: AlertCircle,
            },
            {
              label: "Confirmadas",
              value: kpis.confirmed,
              color: "#22c55e",
              icon: CheckCircle2,
            },
            {
              label: "Canceladas",
              value: kpis.cancelled,
              color: "#ef4444",
              icon: XCircle,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-5 rounded-[14px] bg-card border border-border"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {stat.label}
                  </div>
                  <div className="text-[28px] font-bold mt-1">{stat.value}</div>
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: `${stat.color}15` }}
                >
                  <stat.icon size={22} color={stat.color} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ---- Tabs ---- */}
        <div className="flex gap-1 mb-6 p-1 bg-muted rounded-lg w-fit">
          {(
            [
              { id: "calendar", label: "Calendario", icon: CalendarDays },
              { id: "list", label: "Lista", icon: List },
              { id: "availability", label: "Disponibilidad", icon: Clock },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer border-none",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground bg-transparent"
              )}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ---- Loading ---- */}
        {loading && activeTab !== "availability" && (
          <div className="text-center py-12 text-muted-foreground">
            Cargando citas...
          </div>
        )}

        {/* ================================================================ */}
        {/*  CALENDAR TAB                                                     */}
        {/* ================================================================ */}
        {activeTab === "calendar" && !loading && (
          <div className="rounded-[14px] bg-card border border-border overflow-hidden">
            {/* Week navigation */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <button
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                className="p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer border-none bg-transparent text-foreground"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="font-semibold text-sm">
                {weekDays[0].toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "short",
                })}{" "}
                -{" "}
                {weekDays[6].toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <button
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                className="p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer border-none bg-transparent text-foreground"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)]">
              <div className="border-b border-border" />
              {weekDays.map((day, i) => {
                const isToday = toLocalDate(day) === todayStr;
                return (
                  <div
                    key={i}
                    className={cn(
                      "text-center py-2.5 border-b border-l border-border text-xs font-semibold",
                      isToday
                        ? "text-primary bg-primary/5"
                        : "text-muted-foreground"
                    )}
                  >
                    <div>{DAY_NAMES_SHORT[i]}</div>
                    <div
                      className={cn(
                        "text-lg font-bold mt-0.5",
                        isToday ? "text-primary" : "text-foreground"
                      )}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Time grid */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] max-h-[calc(14*64px)] overflow-y-auto">
              {/* Hour labels + cells */}
              {HOURS.map((hour) => (
                <div
                  key={`row-${hour}`}
                  className="contents"
                >
                  {/* Hour label */}
                  <div className="h-16 flex items-start justify-end pr-2 pt-0.5 text-[11px] text-muted-foreground border-b border-border">
                    {fmt2(hour)}:00
                  </div>
                  {/* Day cells */}
                  {weekDays.map((day, di) => (
                    <div
                      key={`${hour}-${di}`}
                      className="h-16 border-b border-l border-border relative cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => openCreateModal(day, hour)}
                    >
                      {/* Render appointments */}
                      {hour === 7 &&
                        getAppointmentsForDay(day).map((appt) => {
                          const pos = getAppointmentPosition(appt);
                          const sc = STATUS_CONFIG[appt.status];
                          return (
                            <div
                              key={appt.id}
                              className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden cursor-pointer z-10 border-l-[3px]"
                              style={{
                                top: `${pos.top}px`,
                                height: `${pos.height}px`,
                                background: sc.bg,
                                borderLeftColor: sc.color,
                                color: sc.color,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(appt);
                              }}
                            >
                              <div className="font-semibold truncate">
                                {appt.serviceName}
                              </div>
                              {pos.height > 30 && (
                                <div className="truncate opacity-80">
                                  {formatTime(appt.startAt)} -{" "}
                                  {formatTime(appt.endAt)}
                                </div>
                              )}
                              {pos.height > 48 && appt.contactName && (
                                <div className="truncate opacity-70">
                                  {appt.contactName}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/*  LIST TAB                                                         */}
        {/* ================================================================ */}
        {activeTab === "list" && !loading && (
          <div>
            {/* Filters */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm"
              >
                <option value="">Todos los estados</option>
                {Object.entries(STATUS_CONFIG).map(([key, sc]) => (
                  <option key={key} value={key}>
                    {sc.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Desde:</label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Hasta:</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-card border border-border text-foreground text-sm"
                />
              </div>
            </div>

            {/* Table */}
            <div className="rounded-[14px] bg-card border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Servicio",
                      "Cliente",
                      "Fecha / Hora",
                      "Agente",
                      "Estado",
                      "Acciones",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-10 text-muted-foreground"
                      >
                        No hay citas para mostrar
                      </td>
                    </tr>
                  )}
                  {filteredAppointments.map((appt) => {
                    const sc = STATUS_CONFIG[appt.status];
                    return (
                      <tr
                        key={appt.id}
                        className="border-b border-border last:border-none hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium">
                          {appt.serviceName}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {appt.contactName || "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDateTime(appt.startAt)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {appt.assignedName || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-[11px] px-2.5 py-1 rounded-md font-semibold"
                            style={{ background: sc.bg, color: sc.color }}
                          >
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => openEditModal(appt)}
                              className="p-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer border-none bg-transparent text-muted-foreground"
                              title="Ver detalles"
                            >
                              <Eye size={15} />
                            </button>
                            {appt.status === "pending" && (
                              <button
                                onClick={() =>
                                  handleQuickAction(appt.id, "confirm")
                                }
                                className="p-1.5 rounded-md hover:bg-emerald-500/10 transition-colors cursor-pointer border-none bg-transparent text-emerald-500"
                                title="Confirmar"
                              >
                                <CheckCircle2 size={15} />
                              </button>
                            )}
                            {(appt.status === "pending" ||
                              appt.status === "confirmed") && (
                              <>
                                <button
                                  onClick={() =>
                                    handleQuickAction(appt.id, "complete")
                                  }
                                  className="p-1.5 rounded-md hover:bg-blue-500/10 transition-colors cursor-pointer border-none bg-transparent text-blue-500"
                                  title="Completar"
                                >
                                  <CalendarCheck size={15} />
                                </button>
                                <button
                                  onClick={() =>
                                    handleQuickAction(appt.id, "cancel")
                                  }
                                  className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent text-red-500"
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
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/*  AVAILABILITY TAB                                                 */}
        {/* ================================================================ */}
        {activeTab === "availability" && (
          <div className="grid gap-6">
            {/* Weekly schedule */}
            <div className="rounded-[14px] bg-card border border-border p-5">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Clock size={20} className="text-primary" />
                Horarios Semanales
              </h2>
              <div className="flex flex-col gap-3">
                {availabilitySlots.map((slot, i) => (
                  <div
                    key={slot.dayOfWeek}
                    className={cn(
                      "flex items-center gap-4 p-3 rounded-lg border transition-colors",
                      slot.active
                        ? "border-border bg-transparent"
                        : "border-border/50 bg-muted/30"
                    )}
                  >
                    {/* Toggle */}
                    <button
                      onClick={() => {
                        const updated = [...availabilitySlots];
                        updated[i] = { ...updated[i], active: !updated[i].active };
                        setAvailabilitySlots(updated);
                      }}
                      className={cn(
                        "w-10 h-5 rounded-full relative transition-colors cursor-pointer border-none",
                        slot.active ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                          slot.active ? "left-[22px]" : "left-0.5"
                        )}
                      />
                    </button>

                    <span
                      className={cn(
                        "w-24 text-sm font-medium",
                        slot.active
                          ? "text-foreground"
                          : "text-muted-foreground"
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
                            updated[i] = {
                              ...updated[i],
                              startTime: e.target.value,
                            };
                            setAvailabilitySlots(updated);
                          }}
                          className="px-2 py-1.5 rounded-md bg-background border border-border text-foreground text-sm"
                        />
                        <span className="text-muted-foreground text-sm">a</span>
                        <input
                          type="time"
                          value={slot.endTime}
                          onChange={(e) => {
                            const updated = [...availabilitySlots];
                            updated[i] = {
                              ...updated[i],
                              endTime: e.target.value,
                            };
                            setAvailabilitySlots(updated);
                          }}
                          className="px-2 py-1.5 rounded-md bg-background border border-border text-foreground text-sm"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">
                        No disponible
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSaveAvailability}
                  disabled={savingAvailability}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50"
                >
                  <Save size={16} />
                  {savingAvailability ? "Guardando..." : "Guardar Disponibilidad"}
                </button>
              </div>
            </div>

            {/* Blocked dates */}
            <div className="rounded-[14px] bg-card border border-border p-5">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <CalendarX size={20} className="text-destructive" />
                Fechas Bloqueadas
              </h2>

              {/* Add form */}
              <div className="flex gap-3 mb-4 flex-wrap">
                <input
                  type="date"
                  value={newBlockedDate}
                  onChange={(e) => setNewBlockedDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm"
                />
                <input
                  type="text"
                  placeholder="Motivo (opcional)"
                  value={newBlockedReason}
                  onChange={(e) => setNewBlockedReason(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm flex-1 min-w-[200px]"
                />
                <button
                  onClick={handleAddBlockedDate}
                  disabled={!newBlockedDate}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border-none bg-destructive text-destructive-foreground font-semibold text-sm cursor-pointer disabled:opacity-50"
                >
                  <Plus size={16} /> Bloquear Fecha
                </button>
              </div>

              {/* Blocked dates list */}
              {blockedDates.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay fechas bloqueadas
                </p>
              )}
              <div className="flex flex-col gap-2">
                {blockedDates.map((bd) => (
                  <div
                    key={bd.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border"
                  >
                    <div>
                      <span className="text-sm font-medium">
                        {new Date(
                          bd.blockedDate + "T12:00:00"
                        ).toLocaleDateString("es-MX", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </span>
                      {bd.reason && (
                        <span className="text-sm text-muted-foreground ml-3">
                          — {bd.reason}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteBlockedDate(bd.id)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors cursor-pointer border-none bg-transparent text-destructive"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/*  CREATE / EDIT MODAL                                              */}
      {/* ================================================================ */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">
                {editingAppointment ? "Editar Cita" : "Nueva Cita"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer border-none bg-transparent text-muted-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Service name */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  Servicio *
                </label>
                <input
                  type="text"
                  placeholder="Ej: Consulta general"
                  value={modalForm.serviceName}
                  onChange={(e) =>
                    setModalForm({ ...modalForm, serviceName: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={modalForm.date}
                  onChange={(e) =>
                    setModalForm({ ...modalForm, date: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                />
              </div>

              {/* Time row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                    Hora inicio *
                  </label>
                  <input
                    type="time"
                    value={modalForm.startTime}
                    onChange={(e) =>
                      setModalForm({ ...modalForm, startTime: e.target.value })
                    }
                    className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                    Hora fin *
                  </label>
                  <input
                    type="time"
                    value={modalForm.endTime}
                    onChange={(e) =>
                      setModalForm({ ...modalForm, endTime: e.target.value })
                    }
                    className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  <MapPin size={14} className="inline mr-1" />
                  Ubicacion (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej: Oficina central"
                  value={modalForm.location}
                  onChange={(e) =>
                    setModalForm({ ...modalForm, location: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  <FileText size={14} className="inline mr-1" />
                  Notas (opcional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Notas adicionales..."
                  value={modalForm.notes}
                  onChange={(e) =>
                    setModalForm({ ...modalForm, notes: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm resize-none"
                />
              </div>

              {/* Assigned agent */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  <UserCheck size={14} className="inline mr-1" />
                  Agente asignado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="ID del agente"
                  value={modalForm.assignedTo}
                  onChange={(e) =>
                    setModalForm({ ...modalForm, assignedTo: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                />
              </div>

              {/* Contact */}
              <div>
                <label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                  Contacto (opcional)
                </label>
                <input
                  type="text"
                  placeholder="ID del contacto"
                  value={modalForm.contactId}
                  onChange={(e) =>
                    setModalForm({ ...modalForm, contactId: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground text-sm"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 rounded-lg border border-border bg-transparent text-foreground text-sm font-medium cursor-pointer hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !modalForm.serviceName || !modalForm.date}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50"
              >
                <Save size={16} />
                {saving
                  ? "Guardando..."
                  : editingAppointment
                    ? "Actualizar"
                    : "Crear Cita"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Toast ---- */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl bg-foreground text-background text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </>
  );
}
