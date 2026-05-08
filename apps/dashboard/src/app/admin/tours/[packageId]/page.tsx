"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav, type TabItem } from "@/components/ui/tab-nav";
import { SkeletonPage } from "@/components/ui/skeleton-loader";
import Link from "next/link";
import {
    Compass, Info, CalendarDays, List, Save, Check, Trash2, Plus, X,
    Clock, MapPin, AlertTriangle,
} from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
function resolveMediaUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = BASE_URL.replace(/\/api\/v1\/?$/, "");
    return `${apiOrigin}${url.startsWith("/") ? url : "/" + url}`;
}

interface TourPackage {
    id: string;
    name: string;
    description?: string;
    duration_type: "hours" | "days";
    duration_value: number;
    price: number;
    currency: string;
    max_capacity: number;
    min_party_size: number;
    departure_location?: string;
    destination?: string;
    languages: string[];
    includes: string[];
    excludes: string[];
    what_to_bring?: string;
    child_discount_pct: number;
    cancellation_policy?: string;
    images?: string[];
    tags: string[];
    is_active: boolean;
}

interface InventoryRow {
    id: string;
    departure_date: string;
    departure_time?: string;
    available_seats: number;
    total_seats: number;
    price_override?: number;
    notes?: string;
}

interface TourBooking {
    id: string;
    package_name?: string;
    departure_date: string;
    departure_time?: string;
    party_size: number;
    adults: number;
    children: number;
    guest_name?: string;
    guest_phone?: string;
    total_price?: number;
    currency?: string;
    status: string;
    created_at: string;
}

export default function TourDetailPage() {
    const params = useParams();
    const packageId = params.packageId as string;
    const { activeTenantId } = useTenant();
    const t = useTranslations("tours");
    const tc = useTranslations("common");
    const [activeTab, setActiveTab] = useState("info");
    const [pkg, setPkg] = useState<TourPackage | null>(null);
    const [loading, setLoading] = useState(true);

    const tabs: TabItem[] = [
        { id: "info", label: "Info", icon: Info },
        { id: "inventory", label: t("inventory"), icon: CalendarDays },
        { id: "bookings", label: t("bookings"), icon: List },
    ];

    useEffect(() => {
        loadPackage();
    }, [activeTenantId, packageId]);

    async function loadPackage() {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.getTourPackage(activeTenantId, packageId);
        if (res.success && res.data) setPkg(res.data);
        setLoading(false);
    }

    if (loading || !pkg) {
        return <div className="p-4 md:p-6 max-w-7xl mx-auto"><SkeletonPage /></div>;
    }

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
            <PageHeader
                title={pkg.name}
                subtitle={pkg.destination || (pkg.duration_type === "days" ? t("multiDay") : t("sameDay"))}
                icon={Compass}
                breadcrumbs={
                    <Link href="/admin/tours" className="text-xs text-indigo-500 hover:underline">
                        &larr; {t("title")}
                    </Link>
                }
            />

            <TabNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} className="mb-6" />

            {activeTab === "info" && (
                <InfoTab pkg={pkg} tenantId={activeTenantId!} onSaved={loadPackage} t={t} tc={tc} />
            )}
            {activeTab === "inventory" && (
                <InventoryTab tenantId={activeTenantId!} packageId={packageId} pkg={pkg} t={t} tc={tc} />
            )}
            {activeTab === "bookings" && (
                <BookingsTab tenantId={activeTenantId!} packageId={packageId} t={t} tc={tc} />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Tab: Info                                                          */
/* ------------------------------------------------------------------ */

function InfoTab({ pkg, tenantId, onSaved, t, tc }: {
    pkg: TourPackage;
    tenantId: string;
    onSaved: () => void;
    t: any;
    tc: any;
}) {
    const [form, setForm] = useState({
        name: pkg.name,
        description: pkg.description || "",
        durationType: pkg.duration_type,
        durationValue: pkg.duration_value,
        price: pkg.price,
        currency: pkg.currency,
        maxCapacity: pkg.max_capacity,
        minPartySize: pkg.min_party_size,
        departureLocation: pkg.departure_location || "",
        destination: pkg.destination || "",
        languages: pkg.languages || [],
        includes: pkg.includes || [],
        excludes: pkg.excludes || [],
        whatToBring: pkg.what_to_bring || "",
        childDiscountPct: pkg.child_discount_pct || 0,
        cancellationPolicy: pkg.cancellation_policy || "",
        isActive: pkg.is_active,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [includesDraft, setIncludesDraft] = useState("");
    const [excludesDraft, setExcludesDraft] = useState("");

    useEffect(() => {
        setForm({
            name: pkg.name,
            description: pkg.description || "",
            durationType: pkg.duration_type,
            durationValue: pkg.duration_value,
            price: pkg.price,
            currency: pkg.currency,
            maxCapacity: pkg.max_capacity,
            minPartySize: pkg.min_party_size,
            departureLocation: pkg.departure_location || "",
            destination: pkg.destination || "",
            languages: pkg.languages || [],
            includes: pkg.includes || [],
            excludes: pkg.excludes || [],
            whatToBring: pkg.what_to_bring || "",
            childDiscountPct: pkg.child_discount_pct || 0,
            cancellationPolicy: pkg.cancellation_policy || "",
            isActive: pkg.is_active,
        });
    }, [pkg.id, pkg.name, pkg.price, pkg.duration_value, pkg.is_active]);

    async function handleSave() {
        setSaving(true);
        const res = await api.updateTourPackage(tenantId, pkg.id, form);
        if (res.success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            onSaved();
        }
        setSaving(false);
    }

    function addIncludesItem() {
        if (!includesDraft.trim()) return;
        setForm(prev => ({ ...prev, includes: [...prev.includes, includesDraft.trim()] }));
        setIncludesDraft("");
    }
    function addExcludesItem() {
        if (!excludesDraft.trim()) return;
        setForm(prev => ({ ...prev, excludes: [...prev.excludes, excludesDraft.trim()] }));
        setExcludesDraft("");
    }

    const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

    return (
        <div className="max-w-2xl space-y-5">
            <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")}</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </div>

            <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("description")}</label>
                <textarea
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className={`${inputCls} resize-y`}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("destination")}</label>
                    <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("departureLocation")}</label>
                    <input value={form.departureLocation} onChange={(e) => setForm({ ...form, departureLocation: e.target.value })} className={inputCls} />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                        {form.durationType === "days" ? t("days") : t("hours")}
                    </label>
                    <input
                        type="number"
                        min={1}
                        value={form.durationValue}
                        onChange={(e) => setForm({ ...form, durationValue: parseInt(e.target.value) || 1 })}
                        className={inputCls}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("price")}</label>
                    <input
                        type="number"
                        min={0}
                        value={form.price}
                        onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                        className={inputCls}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("currency")}</label>
                    <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                        <option value="COP">COP</option>
                        <option value="USD">USD</option>
                        <option value="MXN">MXN</option>
                        <option value="ARS">ARS</option>
                        <option value="BRL">BRL</option>
                        <option value="CLP">CLP</option>
                        <option value="PEN">PEN</option>
                        <option value="EUR">EUR</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("maxCapacity")}</label>
                    <input
                        type="number"
                        min={1}
                        value={form.maxCapacity}
                        onChange={(e) => setForm({ ...form, maxCapacity: parseInt(e.target.value) || 1 })}
                        className={inputCls}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("minPartySize")}</label>
                    <input
                        type="number"
                        min={1}
                        value={form.minPartySize}
                        onChange={(e) => setForm({ ...form, minPartySize: parseInt(e.target.value) || 1 })}
                        className={inputCls}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("childDiscountPct")}</label>
                    <input
                        type="number"
                        min={0}
                        max={100}
                        value={form.childDiscountPct}
                        onChange={(e) => setForm({ ...form, childDiscountPct: parseInt(e.target.value) || 0 })}
                        className={inputCls}
                    />
                </div>
            </div>

            {/* Includes */}
            <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("includes")}</label>
                <div className="flex gap-2 mb-2">
                    <input
                        value={includesDraft}
                        onChange={(e) => setIncludesDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIncludesItem())}
                        placeholder={t("includesPlaceholder")}
                        className={inputCls}
                    />
                    <button onClick={addIncludesItem} type="button" className="px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <Plus size={16} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {form.includes.map((it, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs">
                            {it}
                            <button onClick={() => setForm(prev => ({ ...prev, includes: prev.includes.filter((_, j) => j !== i) }))} className="hover:opacity-70">
                                <X size={10} />
                            </button>
                        </span>
                    ))}
                </div>
            </div>

            {/* Excludes */}
            <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("excludes")}</label>
                <div className="flex gap-2 mb-2">
                    <input
                        value={excludesDraft}
                        onChange={(e) => setExcludesDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExcludesItem())}
                        placeholder={t("excludesPlaceholder")}
                        className={inputCls}
                    />
                    <button onClick={addExcludesItem} type="button" className="px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <Plus size={16} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {form.excludes.map((it, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs">
                            {it}
                            <button onClick={() => setForm(prev => ({ ...prev, excludes: prev.excludes.filter((_, j) => j !== i) }))} className="hover:opacity-70">
                                <X size={10} />
                            </button>
                        </span>
                    ))}
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("whatToBring")}</label>
                <textarea
                    rows={2}
                    value={form.whatToBring}
                    onChange={(e) => setForm({ ...form, whatToBring: e.target.value })}
                    className={`${inputCls} resize-y`}
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("cancellationPolicy")}</label>
                <textarea
                    rows={2}
                    value={form.cancellationPolicy}
                    onChange={(e) => setForm({ ...form, cancellationPolicy: e.target.value })}
                    className={`${inputCls} resize-y`}
                />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="w-4 h-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                />
                {tc("active")}
            </label>

            <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
                {saved ? <Check size={16} /> : <Save size={16} />}
                {saved ? tc("saved") : tc("save")}
            </button>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Tab: Inventory (cupos por fecha)                                   */
/* ------------------------------------------------------------------ */

function InventoryTab({ tenantId, packageId, pkg, t, tc }: {
    tenantId: string;
    packageId: string;
    pkg: TourPackage;
    t: any;
    tc: any;
}) {
    const [rows, setRows] = useState<InventoryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({
        departureDate: "",
        departureTime: "",
        totalSeats: pkg.max_capacity,
        priceOverride: "",
        notes: "",
    });

    useEffect(() => {
        loadInventory();
    }, [tenantId, packageId]);

    async function loadInventory() {
        setLoading(true);
        const today = new Date().toISOString().split("T")[0];
        const res = await api.listTourInventory(tenantId, packageId, today);
        if (res.success && res.data) setRows(res.data);
        setLoading(false);
    }

    async function handleAdd() {
        if (!form.departureDate || form.totalSeats < 1) return;
        const res = await api.createTourInventory(tenantId, packageId, {
            departureDate: form.departureDate,
            departureTime: form.departureTime || undefined,
            totalSeats: form.totalSeats,
            priceOverride: form.priceOverride ? parseFloat(form.priceOverride) : undefined,
            notes: form.notes || undefined,
        });
        if (res.success) {
            setShowForm(false);
            setForm({ departureDate: "", departureTime: "", totalSeats: pkg.max_capacity, priceOverride: "", notes: "" });
            loadInventory();
        }
    }

    async function handleDelete(id: string) {
        if (!confirm(t("inventoryDeleteConfirm"))) return;
        await api.deleteTourInventory(tenantId, id);
        loadInventory();
    }

    if (loading) {
        return <div className="flex justify-center py-12"><div className="w-8 h-8 border-[3px] border-neutral-200 border-t-indigo-500 rounded-full animate-spin" /></div>;
    }

    return (
        <div className="max-w-3xl space-y-4">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
                {t("inventoryHelp")}
            </div>

            <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">{t("scheduledDepartures")}</h3>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                >
                    <Plus size={14} /> {t("addDeparture")}
                </button>
            </div>

            {showForm && (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1">{t("departureDate")} *</label>
                            <input
                                type="date"
                                value={form.departureDate}
                                onChange={(e) => setForm({ ...form, departureDate: e.target.value })}
                                min={new Date().toISOString().split("T")[0]}
                                className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1">{t("departureTime")}</label>
                            <input
                                type="time"
                                value={form.departureTime}
                                onChange={(e) => setForm({ ...form, departureTime: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1">{t("totalSeats")} *</label>
                            <input
                                type="number"
                                min={1}
                                value={form.totalSeats}
                                onChange={(e) => setForm({ ...form, totalSeats: parseInt(e.target.value) || 1 })}
                                className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 mb-1">{t("priceOverride")} ({pkg.currency})</label>
                            <input
                                type="number"
                                min={0}
                                placeholder={String(pkg.price)}
                                value={form.priceOverride}
                                onChange={(e) => setForm({ ...form, priceOverride: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 mb-1">{t("notes")}</label>
                        <input
                            value={form.notes}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            placeholder={t("notesPlaceholder")}
                            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-lg text-xs text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                            {tc("cancel")}
                        </button>
                        <button
                            onClick={handleAdd}
                            disabled={!form.departureDate || form.totalSeats < 1}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {tc("save")}
                        </button>
                    </div>
                </div>
            )}

            {rows.length === 0 ? (
                <p className="text-sm text-neutral-500 text-center py-6">{t("noScheduledDepartures")}</p>
            ) : (
                <div className="space-y-2">
                    {rows.map((r) => {
                        const occupancyPct = r.total_seats > 0 ? Math.round(((r.total_seats - r.available_seats) / r.total_seats) * 100) : 0;
                        return (
                            <div key={r.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 flex items-center gap-4">
                                <div className="flex-shrink-0 w-16 text-center">
                                    <p className="text-[10px] text-neutral-500 uppercase">
                                        {new Date(r.departure_date + "T00:00:00").toLocaleString(undefined, { month: "short" })}
                                    </p>
                                    <p className="text-2xl font-bold leading-none">{new Date(r.departure_date + "T00:00:00").getDate()}</p>
                                    {r.departure_time && (
                                        <p className="text-[10px] text-neutral-500 mt-0.5">
                                            <Clock size={10} className="inline mr-0.5" />
                                            {r.departure_time.substring(0, 5)}
                                        </p>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-medium">
                                            {r.available_seats}/{r.total_seats} {t("seatsAvailable")}
                                        </span>
                                        {r.price_override && (
                                            <span className="text-xs text-indigo-600 dark:text-indigo-400">
                                                {pkg.currency} {Number(r.price_override).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                                        <div
                                            className={`h-full transition-all ${occupancyPct >= 100 ? "bg-red-500" : occupancyPct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                                            style={{ width: `${occupancyPct}%` }}
                                        />
                                    </div>
                                    {r.notes && <p className="text-[11px] text-neutral-500 mt-1 truncate">{r.notes}</p>}
                                </div>
                                <button
                                    onClick={() => handleDelete(r.id)}
                                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Tab: Bookings                                                      */
/* ------------------------------------------------------------------ */

function BookingsTab({ tenantId, packageId, t, tc }: {
    tenantId: string;
    packageId: string;
    t: any;
    tc: any;
}) {
    const [bookings, setBookings] = useState<TourBooking[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBookings();
    }, [tenantId, packageId]);

    async function loadBookings() {
        setLoading(true);
        const res = await api.listTourBookings(tenantId, packageId);
        if (res.success && res.data) setBookings(res.data);
        setLoading(false);
    }

    async function handleCancel(id: string) {
        if (!confirm(t("cancelBookingConfirm"))) return;
        await api.cancelTourBooking(tenantId, id);
        loadBookings();
    }

    if (loading) {
        return <div className="flex justify-center py-12"><div className="w-8 h-8 border-[3px] border-neutral-200 border-t-indigo-500 rounded-full animate-spin" /></div>;
    }

    if (bookings.length === 0) {
        return <p className="text-sm text-neutral-500 text-center py-12">{t("noBookings")}</p>;
    }

    const statusColor = (s: string) => {
        switch (s) {
            case "reserved": return "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
            case "confirmed": return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
            case "completed": return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
            case "cancelled": return "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400";
            case "no_show": return "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
            default: return "bg-neutral-100 text-neutral-600";
        }
    };

    return (
        <div className="max-w-4xl space-y-2">
            {bookings.map((b) => (
                <div key={b.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex items-center gap-4">
                    <div className="flex-shrink-0 w-14 text-center">
                        <p className="text-[10px] text-neutral-500 uppercase">
                            {new Date(b.departure_date + "T00:00:00").toLocaleString(undefined, { month: "short" })}
                        </p>
                        <p className="text-2xl font-bold leading-none">{new Date(b.departure_date + "T00:00:00").getDate()}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium truncate">{b.guest_name || t("guestUnknown")}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(b.status)}`}>
                                {t(`status.${b.status}`)}
                            </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-neutral-500">
                            <span>{b.party_size} {t("travellers")}</span>
                            {b.guest_phone && <span>{b.guest_phone}</span>}
                            {b.total_price ? <span className="text-indigo-600 dark:text-indigo-400 font-medium">{b.currency} {Number(b.total_price).toLocaleString()}</span> : null}
                        </div>
                    </div>
                    {b.status !== "cancelled" && b.status !== "completed" && (
                        <button
                            onClick={() => handleCancel(b.id)}
                            className="text-xs text-red-500 hover:underline"
                        >
                            {t("cancel")}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
