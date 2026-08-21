"use client";

import { useState, useEffect, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import {
    Car, Plus, X, Gauge, Fuel, Pencil, BadgeDollarSign, CalendarClock, Star,
    FileSpreadsheet,
} from "lucide-react";
import { SkeletonCards, SkeletonTable } from "@/components/ui/skeleton-loader";
import { BulkImportModal } from "@/components/BulkImportModal";
import { useOperatingCurrency } from "@/hooks/useOperatingCurrency";

const VEHICLES_API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
function resolveMediaUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = VEHICLES_API_BASE.replace(/\/api\/v1\/?$/, "");
    return `${apiOrigin}${url.startsWith("/") ? url : "/" + url}`;
}

interface Vehicle {
    id: string;
    make: string;
    model: string;
    year: number;
    trim_level?: string | null;
    color?: string | null;
    fuel_type?: string | null;
    transmission?: string | null;
    mileage_km: number;
    condition: string;
    price_cents: number;
    currency: string;
    status: string;
    category: string;
    photos?: string[];
    description?: string | null;
    is_featured?: boolean;
    sold_price_cents?: number | null;
}

interface TestDrive {
    id: string;
    vehicle_id: string;
    contact_name: string;
    contact_phone?: string | null;
    scheduled_date: string;
    scheduled_time: string;
    status: string;
    notes?: string | null;
    make: string;
    model: string;
    year: number;
    color?: string | null;
}

interface InventoryStats {
    total: number;
    available: number;
    reserved: number;
    sold: number;
    maintenance: number;
    avg_price_cents: number;
    brands: number;
}

const CATEGORIES = ["sedan", "suv", "hatchback", "pickup", "truck", "van", "coupe", "motorcycle"];
const FUEL_TYPES = ["gasoline", "diesel", "hybrid", "electric", "gas"];
const TRANSMISSIONS = ["automatic", "manual"];
const CURRENCIES = ["COP", "USD", "MXN", "ARS", "CLP", "PEN", "BRL"];
const STATUSES = ["available", "reserved", "sold", "maintenance"];

function formatPrice(cents: number, currency: string): string {
    return `${currency} ${(Number(cents || 0) / 100).toLocaleString()}`;
}

function formatDate(raw: string): string {
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    return d.toLocaleDateString();
}

function formatTime(raw: string): string {
    if (!raw) return "";
    // TIME column arrives as "HH:MM:SS" or ISO — keep HH:MM
    const m = String(raw).match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : String(raw);
}

const STATUS_BADGE: Record<string, string> = {
    available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    reserved: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    sold: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    maintenance: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
};

const TD_STATUS_BADGE: Record<string, string> = {
    scheduled: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    completed: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    no_show: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

export default function VehiclesPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("vehicles");
    const tc = useTranslations("common");
    const tImport = useTranslations("bulkImport");

    const [tab, setTab] = useState<"inventory" | "testDrives">("inventory");
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [stats, setStats] = useState<InventoryStats | null>(null);
    const [testDrives, setTestDrives] = useState<TestDrive[]>([]);
    const [loading, setLoading] = useState(true);
    const [tdLoading, setTdLoading] = useState(false);
    const [tdLoaded, setTdLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<"all" | "available" | "reserved" | "sold">("all");
    const [showCreate, setShowCreate] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
    const [sellVehicle, setSellVehicle] = useState<Vehicle | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const showToast = useCallback((msg: string, ms = 2500) => {
        setToast(msg);
        setTimeout(() => setToast(null), ms);
    }, []);

    useEffect(() => {
        if (!activeTenantId) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTenantId, filter]);

    useEffect(() => {
        if (!activeTenantId || tab !== "testDrives" || tdLoaded) return;
        loadTestDrives();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTenantId, tab]);

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        setError(null);
        const params = filter === "all" ? undefined : { status: filter };
        const [res, statsRes] = await Promise.all([
            api.listVehicles(activeTenantId, params),
            api.getVehicleStats(activeTenantId),
        ]);
        if (res.success && res.data && Array.isArray(res.data.items)) {
            setVehicles(res.data.items);
        } else {
            setError(res.error || t("errorLoading"));
        }
        if (statsRes.success && statsRes.data) setStats(statsRes.data);
        setLoading(false);
    }

    async function loadTestDrives() {
        if (!activeTenantId) return;
        setTdLoading(true);
        const res = await api.listVehicleTestDrives(activeTenantId);
        if (res.success && Array.isArray(res.data)) setTestDrives(res.data);
        setTdLoading(false);
        setTdLoaded(true);
    }

    if (loading && vehicles.length === 0 && !error) {
        return (
            <div className="p-4 md:p-6 max-w-7xl mx-auto">
                <SkeletonCards count={6} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Car}
                action={
                    <div className="flex items-center gap-2">
                        {/* En usados el inventario rota entero cada pocas semanas:
                            cargarlo de a un auto es el punto de abandono. */}
                        <button
                            onClick={() => setShowImport(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                        >
                            <FileSpreadsheet size={16} /> {tImport("pickFile")}
                        </button>
                        <button
                            onClick={() => setShowCreate(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                        >
                            <Plus size={16} /> {t("createVehicle")}
                        </button>
                    </div>
                }
            />

            {/* Stats strip */}
            {stats && stats.total > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    {([
                        { key: "total", value: stats.total },
                        { key: "available", value: stats.available },
                        { key: "reserved", value: stats.reserved },
                        { key: "sold", value: stats.sold },
                    ] as const).map(s => (
                        <div key={s.key} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t(`stats.${s.key}`)}</p>
                            <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{s.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1.5 mb-4">
                {([
                    { key: "inventory" as const, label: t("tabInventory"), icon: Car },
                    { key: "testDrives" as const, label: t("tabTestDrives"), icon: CalendarClock },
                ]).map(tb => (
                    <button
                        key={tb.key}
                        onClick={() => setTab(tb.key)}
                        className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg border text-sm transition-colors ${
                            tab === tb.key
                                ? "font-semibold bg-indigo-600 text-white border-indigo-600"
                                : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                        }`}
                    >
                        <tb.icon size={14} /> {tb.label}
                    </button>
                ))}
            </div>

            {tab === "inventory" && (
                <>
                    {/* Status filter pills */}
                    <div className="flex gap-1.5 mb-5">
                        {([
                            { key: "all" as const, label: t("filterAll") },
                            { key: "available" as const, label: t("filterAvailable") },
                            { key: "reserved" as const, label: t("filterReserved") },
                            { key: "sold" as const, label: t("filterSold") },
                        ]).map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={`py-1 px-3 rounded-full border text-xs transition-colors ${
                                    filter === f.key
                                        ? "font-semibold bg-indigo-600 text-white border-indigo-600"
                                        : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {error ? (
                        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-8 text-center">
                            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
                            <button
                                onClick={load}
                                className="px-4 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            >
                                {t("retry")}
                            </button>
                        </div>
                    ) : loading ? (
                        <SkeletonCards count={6} />
                    ) : vehicles.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-12 text-center">
                            <Car size={40} className="mx-auto text-neutral-400 dark:text-neutral-600 mb-3" />
                            <p className="text-base font-medium text-neutral-700 dark:text-neutral-300 mb-1">{t("emptyTitle")}</p>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{t("emptyDesc")}</p>
                            <button
                                onClick={() => setShowCreate(true)}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                            >
                                <Plus size={16} /> {t("createFirst")}
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {vehicles.map(v => (
                                <div
                                    key={v.id}
                                    className="group rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                                >
                                    {v.photos?.[0] ? (
                                        <div
                                            className="h-40 bg-cover bg-center"
                                            style={{ backgroundImage: `url(${resolveMediaUrl(v.photos[0])})` }}
                                        />
                                    ) : (
                                        <div className="h-40 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/30 dark:to-indigo-900/20 flex items-center justify-center">
                                            <Car size={32} className="text-indigo-300 dark:text-indigo-700" />
                                        </div>
                                    )}
                                    <div className="p-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            {v.is_featured && <Star size={13} className="text-amber-500 shrink-0" />}
                                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate flex-1">
                                                {v.make} {v.model} {v.year}
                                            </h3>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[v.status] || STATUS_BADGE.available}`}>
                                                {t(`status.${STATUSES.includes(v.status) ? v.status : "available"}`)}
                                            </span>
                                        </div>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                                            {t(`category.${CATEGORIES.includes(v.category) ? v.category : "sedan"}`)}
                                            {" · "}
                                            {t(`condition.${v.condition === "used" ? "used" : "new"}`)}
                                            {v.color ? ` · ${v.color}` : ""}
                                        </p>
                                        <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                                            <span className="flex items-center gap-1"><Gauge size={12} /> {Number(v.mileage_km || 0).toLocaleString()} km</span>
                                            {v.fuel_type && FUEL_TYPES.includes(v.fuel_type) && (
                                                <span className="flex items-center gap-1"><Fuel size={12} /> {t(`fuelType.${v.fuel_type}`)}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-base font-semibold text-indigo-600 dark:text-indigo-400">
                                                {formatPrice(v.status === "sold" && v.sold_price_cents ? v.sold_price_cents : v.price_cents, v.currency)}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => setEditVehicle(v)}
                                                    title={t("editVehicle")}
                                                    className="p-1.5 rounded-lg text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                {v.status !== "sold" && (
                                                    <button
                                                        onClick={() => setSellVehicle(v)}
                                                        title={t("markSold")}
                                                        className="p-1.5 rounded-lg text-neutral-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                                    >
                                                        <BadgeDollarSign size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {tab === "testDrives" && (
                tdLoading ? (
                    <SkeletonTable rows={5} cols={5} />
                ) : testDrives.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-12 text-center">
                        <CalendarClock size={40} className="mx-auto text-neutral-400 dark:text-neutral-600 mb-3" />
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("testDrives.empty")}</p>
                    </div>
                ) : (
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-800 text-left">
                                        <th className="px-4 py-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("testDrives.customer")}</th>
                                        <th className="px-4 py-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("testDrives.vehicle")}</th>
                                        <th className="px-4 py-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("testDrives.date")}</th>
                                        <th className="px-4 py-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("testDrives.time")}</th>
                                        <th className="px-4 py-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("testDrives.statusLabel")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {testDrives.map(td => (
                                        <tr key={td.id} className="border-b border-neutral-100 dark:border-neutral-800/50 last:border-0">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-neutral-900 dark:text-neutral-100">{td.contact_name}</p>
                                                {td.contact_phone && <p className="text-xs text-neutral-500 dark:text-neutral-400">{td.contact_phone}</p>}
                                            </td>
                                            <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                                                {td.make} {td.model} {td.year}
                                            </td>
                                            <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">{formatDate(td.scheduled_date)}</td>
                                            <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">{formatTime(td.scheduled_time)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TD_STATUS_BADGE[td.status] || TD_STATUS_BADGE.scheduled}`}>
                                                    {t(`testDrives.status.${TD_STATUS_BADGE[td.status] ? td.status : "scheduled"}`)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            )}

            {(showCreate || editVehicle) && (
                <VehicleModal
                    tenantId={activeTenantId!}
                    vehicle={editVehicle}
                    onClose={() => { setShowCreate(false); setEditVehicle(null); }}
                    onSaved={(wasEdit) => {
                        setShowCreate(false);
                        setEditVehicle(null);
                        showToast(wasEdit ? t("toast.updated") : t("toast.created"));
                        load();
                    }}
                    t={t}
                    tc={tc}
                />
            )}

            {sellVehicle && (
                <MarkSoldModal
                    tenantId={activeTenantId!}
                    vehicle={sellVehicle}
                    onClose={() => setSellVehicle(null)}
                    onSold={() => {
                        setSellVehicle(null);
                        showToast(t("toast.sold"));
                        load();
                    }}
                    t={t}
                    tc={tc}
                />
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-lg bg-emerald-500 text-sm font-semibold text-white shadow-lg">
                    {toast}
                </div>
            )}

            <BulkImportModal
                open={showImport}
                onClose={() => setShowImport(false)}
                endpoint={`/vehicles/${activeTenantId}/bulk-import`}
                title={t("title")}
                onImported={load}
                fields={[
                    { key: "make", label: tImport("f_make"), required: true, aliases: ["marca"] },
                    { key: "model", label: tImport("f_model"), required: true, aliases: ["modelo", "linea"] },
                    { key: "year", label: tImport("f_year"), type: "number", required: true, aliases: ["año", "ano", "modelo año"] },
                    // El REST recibe CENTAVOS. La planilla trae pesos, asi que
                    // el import los multiplica: sin esto un auto de 45.000.000
                    // entraria como 450.000 y el agente lo ofreceria a ese precio.
                    { key: "priceCents", label: tImport("f_price"), type: "number", required: true, aliases: ["precio", "valor", "precio de venta"] },
                    { key: "mileageKm", label: tImport("f_mileage"), type: "number", aliases: ["kilometraje", "km", "kilometros"] },
                    { key: "condition", label: tImport("f_condition"), aliases: ["estado", "condicion", "nuevo o usado"] },
                    { key: "licensePlate", label: tImport("f_plate"), aliases: ["placa", "patente", "dominio"] },
                    { key: "category", label: tImport("f_category"), aliases: ["categoria", "tipo", "carroceria"] },
                ]}
                transform={row => ({ ...row, priceCents: typeof row.priceCents === "number" ? Math.round(row.priceCents * 100) : row.priceCents })}
            />
        </div>
    );
}

function VehicleModal({ tenantId, vehicle, onClose, onSaved, t, tc }: {
    tenantId: string;
    vehicle: Vehicle | null;
    onClose: () => void;
    onSaved: (wasEdit: boolean) => void;
    t: any;
    tc: any;
}) {
    const operatingCurrency = useOperatingCurrency();
    const isEdit = Boolean(vehicle);
    const [form, setForm] = useState({
        make: vehicle?.make || "",
        model: vehicle?.model || "",
        year: vehicle?.year || new Date().getFullYear(),
        price: vehicle ? Number(vehicle.price_cents || 0) / 100 : 0,
        currency: vehicle?.currency || operatingCurrency || "",
        mileageKm: vehicle?.mileage_km || 0,
        condition: vehicle?.condition === "used" ? "used" : "new",
        category: vehicle && CATEGORIES.includes(vehicle.category) ? vehicle.category : "sedan",
        fuelType: vehicle?.fuel_type && FUEL_TYPES.includes(vehicle.fuel_type) ? vehicle.fuel_type : "gasoline",
        transmission: vehicle?.transmission === "manual" ? "manual" : "automatic",
        color: vehicle?.color || "",
        status: vehicle && STATUSES.includes(vehicle.status) ? vehicle.status : "available",
        description: vehicle?.description || "",
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (!form.make.trim() || !form.model.trim()) {
            setError(t("makeModelRequired"));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const payload: any = {
                make: form.make.trim(),
                model: form.model.trim(),
                year: Number(form.year) || new Date().getFullYear(),
                priceCents: Math.round((Number(form.price) || 0) * 100),
                currency: form.currency,
                mileageKm: Number(form.mileageKm) || 0,
                condition: form.condition,
                category: form.category,
                fuelType: form.fuelType,
                transmission: form.transmission,
                color: form.color.trim() || undefined,
                description: form.description.trim() || undefined,
            };
            if (isEdit) payload.status = form.status;
            const res = isEdit
                ? await api.updateVehicle(tenantId, vehicle!.id, payload)
                : await api.createVehicle(tenantId, payload);
            if (res.success) onSaved(isEdit);
            else setError(res.error || tc("errorSaving"));
        } catch (err: any) {
            setError(err?.message || tc("errorSaving"));
        } finally {
            setSaving(false);
        }
    }

    const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
    const labelCls = "block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-neutral-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{isEdit ? t("editVehicle") : t("createVehicle")}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, condition: "new" })}
                            className={`px-3 py-3 rounded-lg border transition-colors ${form.condition === "new" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-neutral-200 dark:border-neutral-700"}`}
                        >
                            <span className="text-sm font-semibold">{t("condition.new")}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, condition: "used" })}
                            className={`px-3 py-3 rounded-lg border transition-colors ${form.condition === "used" ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "border-neutral-200 dark:border-neutral-700"}`}
                        >
                            <span className="text-sm font-semibold">{t("condition.used")}</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>{t("make")} *</label>
                            <input
                                value={form.make}
                                onChange={e => setForm({ ...form, make: e.target.value })}
                                placeholder={t("makePlaceholder")}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t("model")} *</label>
                            <input
                                value={form.model}
                                onChange={e => setForm({ ...form, model: e.target.value })}
                                placeholder={t("modelPlaceholder")}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className={labelCls}>{t("year")}</label>
                            <input
                                type="number"
                                min={1950}
                                max={new Date().getFullYear() + 2}
                                value={form.year}
                                onChange={e => setForm({ ...form, year: parseInt(e.target.value) || new Date().getFullYear() })}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t("price")}</label>
                            <input
                                type="number"
                                min={0}
                                value={form.price}
                                onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t("currencyLabel")}</label>
                            <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>{t("category.label")}</label>
                            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={inputCls}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>{t("mileageKm")}</label>
                            <input
                                type="number"
                                min={0}
                                value={form.mileageKm}
                                onChange={e => setForm({ ...form, mileageKm: parseInt(e.target.value) || 0 })}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className={labelCls}>{t("fuelType.label")}</label>
                            <select value={form.fuelType} onChange={e => setForm({ ...form, fuelType: e.target.value })} className={inputCls}>
                                {FUEL_TYPES.map(f => <option key={f} value={f}>{t(`fuelType.${f}`)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>{t("transmission.label")}</label>
                            <select value={form.transmission} onChange={e => setForm({ ...form, transmission: e.target.value })} className={inputCls}>
                                {TRANSMISSIONS.map(tr => <option key={tr} value={tr}>{t(`transmission.${tr}`)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>{t("color")}</label>
                            <input
                                value={form.color}
                                onChange={e => setForm({ ...form, color: e.target.value })}
                                placeholder={t("colorPlaceholder")}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    {isEdit && (
                        <div>
                            <label className={labelCls}>{t("status.label")}</label>
                            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputCls}>
                                {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className={labelCls}>{t("description")}</label>
                        <textarea
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            placeholder={t("descriptionPlaceholder")}
                            rows={3}
                            className={inputCls}
                        />
                    </div>

                    {error && <p className="text-xs text-red-500">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
                    <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !form.make.trim() || !form.model.trim()}
                        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? tc("saving") : isEdit ? t("saveChanges") : t("createVehicle")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function MarkSoldModal({ tenantId, vehicle, onClose, onSold, t, tc }: {
    tenantId: string;
    vehicle: Vehicle;
    onClose: () => void;
    onSold: () => void;
    t: any;
    tc: any;
}) {
    const [soldPrice, setSoldPrice] = useState<number>(Number(vehicle.price_cents || 0) / 100);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleConfirm() {
        setSaving(true);
        setError(null);
        try {
            const res = await api.markVehicleSold(tenantId, vehicle.id, {
                soldPriceCents: Math.round((Number(soldPrice) || 0) * 100),
            });
            if (res.success) onSold();
            else setError(res.error || tc("errorSaving"));
        } catch (err: any) {
            setError(err?.message || tc("errorSaving"));
        } finally {
            setSaving(false);
        }
    }

    const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-neutral-900 rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{t("markSold")}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-sm text-neutral-600 dark:text-neutral-300">
                        {t("markSoldDesc", { vehicle: `${vehicle.make} ${vehicle.model} ${vehicle.year}` })}
                    </p>
                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                            {t("soldPrice")} ({vehicle.currency})
                        </label>
                        <input
                            type="number"
                            min={0}
                            value={soldPrice}
                            onChange={e => setSoldPrice(parseFloat(e.target.value) || 0)}
                            className={inputCls}
                        />
                    </div>
                    {error && <p className="text-xs text-red-500">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
                    <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={saving}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {saving ? tc("saving") : t("confirmSold")}
                    </button>
                </div>
            </div>
        </div>
    );
}
