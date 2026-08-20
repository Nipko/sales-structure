"use client";

/**
 * El registro global de reservas de tours.
 *
 * `GET /tours/:tenantId/bookings` existía y ninguna pantalla lo usaba: las
 * reservas reales vivían anidadas dentro del paquete, y el paquete está detrás
 * de la capacidad de catálogo. Un operador que necesitaba el manifiesto de la
 * salida de mañana tenía que abrir primero el producto que la vende.
 *
 * Detrás de `canHandleConversations`, como corresponde a un objeto operativo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    Compass, RefreshCw, Loader2, Search, CalendarDays, Users, Bot, Hand,
} from "lucide-react";

interface TourBooking {
    id: string;
    package_id: string;
    package_name?: string;
    // Los nombres son los de la tabla: `guest_*`. Escribirlos como `customer_*`
    // dejaba el manifiesto entero mostrando "Sin viajero" con datos correctos
    // debajo.
    guest_name?: string;
    contact_name?: string;
    guest_phone?: string;
    guest_email?: string;
    departure_date: string;
    party_size?: number;
    total_price?: number;
    currency?: string;
    status: string;
    payment_status?: string;
    origin?: "agent" | "manual";
    conversation_id?: string | null;
    created_at?: string;
}

/** Estados con traducción propia; cualquier otro se muestra crudo. */
const STATUS_KEYS = ["confirmed", "reserved", "pending_payment", "cancelled"];

const STATUS_STYLE: Record<string, string> = {
    confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    reserved: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    pending_payment: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    cancelled: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30",
};

export default function TourBookingsPage() {
    const t = useTranslations("tourBookings");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [bookings, setBookings] = useState<TourBooking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        setError("");
        try {
            const res = await api.listTourBookings(activeTenantId);
            if (res.success) {
                setBookings(res.data ?? []);
            } else {
                // Distinguir "no hay salidas" de "no se pudo leer": lo contrario
                // es lo que hacía que un fallo pareciera un día sin reservas.
                setError(res.error || t("loadFailed"));
                setBookings([]);
            }
        } catch {
            setError(t("loadFailed"));
            setBookings([]);
        } finally {
            setLoading(false);
        }
    }, [activeTenantId, t]);

    useEffect(() => { load(); }, [load]);

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        return bookings.filter((booking) => {
            if (status && booking.status !== status) return false;
            if (!term) return true;
            return [booking.guest_name, booking.contact_name, booking.guest_phone, booking.package_name]
                .some(value => String(value || "").toLowerCase().includes(term));
        });
    }, [bookings, search, status]);

    /** Salidas agrupadas por fecha: así se lee un manifiesto. */
    const byDeparture = useMemo(() => {
        const groups = new Map<string, TourBooking[]>();
        for (const booking of visible) {
            const day = String(booking.departure_date || "").slice(0, 10);
            groups.set(day, [...(groups.get(day) || []), booking]);
        }
        return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [visible]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Compass className="h-6 w-6 text-teal-600" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {tc("refresh")}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("searchPlaceholder")}
                        className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm"
                    />
                </div>
                <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="px-3 py-2 bg-card border border-border rounded-lg text-sm"
                >
                    <option value="">{t("allStatuses")}</option>
                    <option value="confirmed">{t("status.confirmed")}</option>
                    <option value="reserved">{t("status.reserved")}</option>
                    <option value="pending_payment">{t("status.pending_payment")}</option>
                    <option value="cancelled">{t("status.cancelled")}</option>
                </select>
            </div>

            {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {loading && bookings.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                </div>
            ) : byDeparture.length === 0 && !error ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                    <Compass className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">{t("empty")}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {byDeparture.map(([day, group]) => {
                        const seats = group.reduce((sum, b) => sum + (Number(b.party_size) || 0), 0);
                        return (
                            <div key={day} className="rounded-lg border border-border overflow-hidden">
                                <div className="flex items-center justify-between gap-3 px-4 py-2 bg-muted/50 text-sm">
                                    <span className="inline-flex items-center gap-2 font-medium">
                                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                        {day || t("noDate")}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Users className="h-3.5 w-3.5" />
                                        {t("travellers", { count: seats })}
                                    </span>
                                </div>
                                <div className="divide-y divide-border">
                                    {group.map((booking) => (
                                        <div key={booking.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                                            <div className="min-w-0">
                                                <p className="font-medium truncate">
                                                    {booking.guest_name || booking.contact_name || t("noCustomer")}
                                                </p>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {booking.package_name || "—"}
                                                    {booking.guest_phone ? ` · ${booking.guest_phone}` : ""}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    {(booking.origin ?? (booking.conversation_id ? "agent" : "manual")) === "agent"
                                                        ? <><Bot className="h-3.5 w-3.5" />{t("origin.agent")}</>
                                                        : <><Hand className="h-3.5 w-3.5" />{t("origin.manual")}</>}
                                                </span>
                                                <span className={`inline-block px-2 py-0.5 rounded border text-xs ${
                                                    STATUS_STYLE[booking.status] || STATUS_STYLE.pending
                                                }`}>
                                                    {/* Un estado nuevo del backend se muestra crudo antes
                                                        que romper la fila. */}
                                                    {STATUS_KEYS.includes(booking.status)
                                                        ? t(`status.${booking.status}` as never)
                                                        : booking.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
