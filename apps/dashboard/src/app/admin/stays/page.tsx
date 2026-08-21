"use client";

/**
 * El registro global de estadías.
 *
 * El backend expone la lista desde hace tiempo; el cliente web nunca la usó.
 * Para encontrar una reserva había que abrir una tarjeta de propiedad y después
 * su pestaña Reservas, y el menú lateral llamaba "Reservas" al Kanban del CRM —
 * que es otra cosa. La auditoría intentó encontrar una reserva en Turismo y no
 * pudo; eso disparó toda la revisión.
 *
 * Vive detrás de `canHandleConversations`, no de la capacidad de catálogo:
 * administrar alojamientos y operar reservas son dos trabajos distintos, y un
 * agente que cerró una estadía en una conversación tiene que poder verla.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    BedDouble, RefreshCw, Loader2, Search, CalendarDays, User, Home,
    ChevronLeft, ChevronRight, Bot, Hand, Plus, X, XCircle,
} from "lucide-react";

interface Stay {
    id: string;
    property_id: string;
    property_name?: string;
    property_city?: string;
    guest_name?: string;
    guest_email?: string;
    guest_phone?: string;
    contact_name?: string;
    guests_count?: number;
    check_in: string;
    check_out: string;
    nights?: number;
    total_price?: number;
    currency?: string;
    status: string;
    payment_status?: string;
    origin?: "agent" | "manual";
    created_at?: string;
}

const PAGE_SIZE = 50;

/** Estados con traducción propia; cualquier otro se muestra tal cual. */
const STATUS_KEYS = ["confirmed", "pending", "pending_payment", "cancelled"];

const STATUS_STYLE: Record<string, string> = {
    confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    pending_payment: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    cancelled: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30",
};

function formatRange(checkIn: string, checkOut: string, locale: string): string {
    const fmt = (value: string) => {
        const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
        return Number.isNaN(date.getTime())
            ? String(value)
            : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(date);
    };
    return `${fmt(checkIn)} → ${fmt(checkOut)}`;
}

export default function StaysPage() {
    const t = useTranslations("stays");
    const tc = useTranslations("common");
    // Fechas y moneda siguen el idioma elegido, no un `es-CO` fijo: la app
    // corre en cuatro idiomas y una fecha en formato ajeno se lee mal.
    const locale = useLocale();
    const { activeTenantId } = useTenant();

    const [stays, setStays] = useState<Stay[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [status, setStatus] = useState("");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [creating, setCreating] = useState(false);
    const [cancelTarget, setCancelTarget] = useState<Stay | null>(null);
    const [cancelBusy, setCancelBusy] = useState(false);
    const [cancelError, setCancelError] = useState("");

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError("");
        try {
            const res = await api.listStays(activeTenantId, {
                status: status || undefined,
                search: search.trim() || undefined,
                limit: PAGE_SIZE,
                offset,
            });
            if (res.success) {
                setStays(res.data?.bookings ?? []);
                setTotal(res.data?.total ?? 0);
            } else {
                // Una lista vacía y una consulta que falló no son lo mismo: sin
                // esto, un error se lee como "no hay reservas".
                setError(res.error || t("loadFailed"));
                setStays([]);
            }
        } catch {
            setError(t("loadFailed"));
            setStays([]);
        } finally {
            setLoading(false);
        }
    }, [activeTenantId, status, search, offset, t]);

    useEffect(() => { load(); }, [load]);

    async function confirmCancel() {
        if (!activeTenantId || !cancelTarget) return;
        setCancelBusy(true);
        setCancelError("");
        const res = await api.cancelPropertyBooking(activeTenantId, cancelTarget.id)
            .catch(() => ({ success: false, error: "" } as any));
        setCancelBusy(false);
        if (!res?.success) {
            // El motivo importa: una reserva que administra el channel manager
            // no se cancela desde acá, y decir "no se pudo" invita a reintentar.
            setCancelError(res?.error || t("cancelFailed"));
            return;
        }
        setCancelTarget(null);
        load();
    }

    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <BedDouble className="h-6 w-6 text-sky-600" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={load}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {tc("refresh")}
                    </button>
                    {/* Cargar una estadía no puede exigir abrir antes la ficha
                        del alojamiento: quien atiende trabaja desde el registro. */}
                    <button
                        onClick={() => setCreating(true)}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm transition"
                    >
                        <Plus className="h-4 w-4" />
                        {t("newStay")}
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => { setOffset(0); setSearch(e.target.value); }}
                        placeholder={t("searchPlaceholder")}
                        className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm"
                    />
                </div>
                <select
                    value={status}
                    onChange={(e) => { setOffset(0); setStatus(e.target.value); }}
                    className="px-3 py-2 bg-card border border-border rounded-lg text-sm"
                >
                    <option value="">{t("allStatuses")}</option>
                    <option value="confirmed">{t("status.confirmed")}</option>
                    <option value="pending">{t("status.pending")}</option>
                    <option value="pending_payment">{t("status.pending_payment")}</option>
                    <option value="cancelled">{t("status.cancelled")}</option>
                </select>
            </div>

            {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {loading && stays.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                </div>
            ) : stays.length === 0 && !error ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                    <BedDouble className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">{t("empty")}</p>
                </div>
            ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-xs text-muted-foreground">
                                <tr>
                                    <th className="text-left font-medium px-4 py-2">{t("col.guest")}</th>
                                    <th className="text-left font-medium px-4 py-2">{t("col.property")}</th>
                                    <th className="text-left font-medium px-4 py-2">{t("col.dates")}</th>
                                    <th className="text-left font-medium px-4 py-2">{t("col.status")}</th>
                                    <th className="text-left font-medium px-4 py-2">{t("col.origin")}</th>
                                    <th className="text-right font-medium px-4 py-2">{t("col.total")}</th>
                                    <th className="w-10 px-4 py-2"><span className="sr-only">{t("cancelStay")}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {stays.map((stay) => (
                                    <tr key={stay.id} className="border-t border-border hover:bg-muted/30">
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span className="font-medium">
                                                    {stay.guest_name || stay.contact_name || t("noGuest")}
                                                </span>
                                            </div>
                                            {stay.guest_phone && (
                                                <span className="text-xs text-muted-foreground">{stay.guest_phone}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                <Home className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span>{stay.property_name || "—"}</span>
                                            </div>
                                            {stay.property_city && (
                                                <span className="text-xs text-muted-foreground">{stay.property_city}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                                                {formatRange(stay.check_in, stay.check_out, locale)}
                                            </div>
                                            {stay.nights != null && (
                                                <span className="text-xs text-muted-foreground">
                                                    {t("nights", { count: stay.nights })}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={`inline-block px-2 py-0.5 rounded border text-xs ${
                                                STATUS_STYLE[stay.status] || STATUS_STYLE.pending
                                            }`}>
                                                {/* Un estado nuevo del backend se muestra crudo antes
                                                    que romper la fila: la reserva sigue siendo legible. */}
                                                {STATUS_KEYS.includes(stay.status)
                                                    ? t(`status.${stay.status}` as never)
                                                    : stay.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2">
                                            {/* Quién creó la estadía: el dato ya existía derivado de
                                                `conversation_id` y el dueño no podía verlo. */}
                                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                                {stay.origin === "agent"
                                                    ? <><Bot className="h-3.5 w-3.5" />{t("origin.agent")}</>
                                                    : <><Hand className="h-3.5 w-3.5" />{t("origin.manual")}</>}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-right whitespace-nowrap">
                                            {stay.total_price != null
                                                ? new Intl.NumberFormat(locale, {
                                                    style: "currency",
                                                    currency: stay.currency || "COP",
                                                    maximumFractionDigits: 0,
                                                }).format(Number(stay.total_price))
                                                : "—"}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            {stay.status !== "cancelled" && (
                                                <button
                                                    onClick={() => { setCancelError(""); setCancelTarget(stay); }}
                                                    title={t("cancelStay")}
                                                    aria-label={t("cancelStay")}
                                                    className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition"
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
                        <span>{t("pagination", { page, pages, total })}</span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                                disabled={offset === 0 || loading}
                                className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-40"
                                aria-label={tc("previous")}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setOffset(offset + PAGE_SIZE)}
                                disabled={page >= pages || loading}
                                className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-40"
                                aria-label={tc("next")}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {creating && activeTenantId && (
                <NewStayModal
                    tenantId={activeTenantId}
                    onClose={() => setCreating(false)}
                    onCreated={() => { setCreating(false); setOffset(0); load(); }}
                />
            )}

            {cancelTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCancelTarget(null)}>
                    <div className="bg-card border border-border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-base font-semibold mb-1">{t("cancelStay")}</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            {t("cancelConfirm", {
                                guest: cancelTarget.guest_name || cancelTarget.contact_name || t("noGuest"),
                                property: cancelTarget.property_name || "—",
                            })}
                        </p>
                        {cancelError && (
                            <p className="text-xs text-red-600 dark:text-red-400 mb-3">{cancelError}</p>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setCancelTarget(null)}
                                disabled={cancelBusy}
                                className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted"
                            >
                                {tc("cancel")}
                            </button>
                            <button
                                onClick={confirmCancel}
                                disabled={cancelBusy}
                                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
                            >
                                {cancelBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {t("cancelStay")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface PropertyOption { id: string; name: string; city?: string }

/**
 * Alta de estadía desde el registro.
 *
 * Comprueba disponibilidad ANTES de intentar crear, porque el rechazo del
 * servidor llega con la fecha ya cargada y sin decir qué fechas sí hay. Y
 * cuando el alojamiento lo administra un channel manager, el error tiene un
 * motivo propio: no es un fallo, es que el calendario es de otro.
 */
function NewStayModal({ tenantId, onClose, onCreated }: {
    tenantId: string;
    onClose: () => void;
    onCreated: () => void;
}) {
    const t = useTranslations("stays");
    const tc = useTranslations("common");

    const [properties, setProperties] = useState<PropertyOption[]>([]);
    const [form, setForm] = useState({
        propertyId: "", checkIn: "", checkOut: "", guestsCount: 1,
        guestName: "", guestPhone: "", guestEmail: "",
    });
    const [checking, setChecking] = useState(false);
    const [availability, setAvailability] = useState<{ available: boolean; reason?: string; totalPrice?: number } | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        api.listProperties(tenantId)
            .then((res) => {
                if (res.success && Array.isArray(res.data)) {
                    setProperties(res.data.map((p: any) => ({ id: p.id, name: p.name, city: p.city })));
                }
            })
            .catch(() => setProperties([]));
    }, [tenantId]);

    const rangeReady = Boolean(form.propertyId && form.checkIn && form.checkOut && form.checkIn < form.checkOut);

    useEffect(() => {
        if (!rangeReady) { setAvailability(null); return; }
        let cancelled = false;
        setChecking(true);
        api.getPropertyAvailability(tenantId, form.propertyId, form.checkIn, form.checkOut)
            .then((res) => {
                if (cancelled) return;
                setAvailability(res.success && res.data ? res.data : null);
            })
            .catch(() => { if (!cancelled) setAvailability(null); })
            .finally(() => { if (!cancelled) setChecking(false); });
        return () => { cancelled = true; };
    }, [tenantId, form.propertyId, form.checkIn, form.checkOut, rangeReady]);

    async function handleSave() {
        if (!rangeReady || !form.guestName.trim()) return;
        setSaving(true);
        setError("");
        const res = await api.createPropertyBooking(tenantId, form.propertyId, {
            checkIn: form.checkIn,
            checkOut: form.checkOut,
            guestsCount: form.guestsCount,
            guestName: form.guestName.trim(),
            guestPhone: form.guestPhone.trim() || undefined,
            guestEmail: form.guestEmail.trim() || undefined,
        }).catch(() => ({ success: false, error: "" } as any));
        setSaving(false);
        if (res?.success) { onCreated(); return; }
        setError(res?.error || t("createFailed"));
    }

    const inputCls = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm";
    const canSave = rangeReady && form.guestName.trim().length > 0 && availability?.available === true && !saving;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <h3 className="text-base font-semibold">{t("newStay")}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">{t("col.property")}</label>
                        <select
                            value={form.propertyId}
                            onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                            className={inputCls}
                        >
                            <option value="">{t("pickProperty")}</option>
                            {properties.map((p) => (
                                <option key={p.id} value={p.id}>{p.city ? `${p.name} — ${p.city}` : p.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("checkIn")}</label>
                            <input type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("checkOut")}</label>
                            <input type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} className={inputCls} />
                        </div>
                    </div>

                    {rangeReady && (
                        <div className="rounded-lg border border-border px-3 py-2 text-xs">
                            {checking
                                ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("checkingAvailability")}</span>
                                : availability?.available
                                    ? <span className="text-emerald-600 dark:text-emerald-400">{t("availableRange")}</span>
                                    : <span className="text-amber-600 dark:text-amber-400">{t("unavailableRange")}</span>}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("guestName")}</label>
                            <input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("guests")}</label>
                            <input
                                type="number"
                                min={1}
                                value={form.guestsCount}
                                onChange={(e) => setForm({ ...form, guestsCount: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("guestPhone")}</label>
                            <input value={form.guestPhone} onChange={(e) => setForm({ ...form, guestPhone: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("guestEmail")}</label>
                            <input type="email" value={form.guestEmail} onChange={(e) => setForm({ ...form, guestEmail: e.target.value })} className={inputCls} />
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
                    <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {tc("create")}
                    </button>
                </div>
            </div>
        </div>
    );
}
