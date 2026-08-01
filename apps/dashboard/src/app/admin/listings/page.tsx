"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import {
    Building2, Plus, MapPin, BedDouble, Bath, Square, X, Tag, FileSpreadsheet,
} from "lucide-react";
import { BulkImportModal } from "@/components/BulkImportModal";
import { SkeletonCards } from "@/components/ui/skeleton-loader";
import { HelpPanel } from "@/components/ui/help-panel";

const LISTINGS_API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
function resolveMediaUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = LISTINGS_API_BASE.replace(/\/api\/v1\/?$/, "");
    return `${apiOrigin}${url.startsWith("/") ? url : "/" + url}`;
}

interface Listing {
    id: string;
    name: string;
    transaction_type: "sale" | "rent";
    property_kind: string;
    price: number;
    currency: string;
    bedrooms: number;
    bathrooms: number;
    area_m2: number;
    parking_spots: number;
    stratum?: number;
    neighborhood?: string;
    city?: string;
    images?: string[];
    status: string;
    is_active: boolean;
}

const PROPERTY_KINDS = [
    { key: "apartment", label: "Apartamento" },
    { key: "house", label: "Casa" },
    { key: "commercial", label: "Local comercial" },
    { key: "office", label: "Oficina" },
    { key: "land", label: "Lote / Terreno" },
];

export default function ListingsPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("listings");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const tImport = useTranslations("bulkImport");

    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [showZones, setShowZones] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [filter, setFilter] = useState<"all" | "sale" | "rent">("all");

    useEffect(() => {
        if (!activeTenantId) return;
        load();
    }, [activeTenantId, filter]);

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        const params = filter === "all" ? undefined : { transactionType: filter };
        const res = await api.listListings(activeTenantId, params);
        if (res.success && Array.isArray(res.data)) setListings(res.data);
        setLoading(false);
    }

    if (loading) {
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
                icon={Building2}
                action={
                    <div className="flex items-center gap-2">
                        {/* Zonas: sin esta puerta, listing_zone_agents y
                            resolveAgentForZone quedaban construidos y sin usar. */}
                        <button
                            onClick={() => setShowZones(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                        >
                            <MapPin size={16} /> {t("zonesTitle")}
                        </button>
                        {/* Cargar 40 propiedades de a una es el punto de abandono
                            documentado del alta de una inmobiliaria. */}
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
                            <Plus size={16} /> {t("createListing")}
                        </button>
                    </div>
                }
            />

            <HelpPanel
                title={tHelp("listings.title")}
                description={tHelp("listings.description")}
                tips={tHelp.raw("listings.tips") as string[]}
                mediaKey="listings"
            />

            {/* Filter pills */}
            <div className="flex gap-1.5 mb-5 mt-2">
                {([
                    { key: "all" as const, label: t("filterAll") },
                    { key: "sale" as const, label: t("filterSale") },
                    { key: "rent" as const, label: t("filterRent") },
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

            {listings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-12 text-center">
                    <Building2 size={40} className="mx-auto text-neutral-400 dark:text-neutral-600 mb-3" />
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
                    {listings.map(l => (
                        <Link
                            key={l.id}
                            href={`/admin/listings/${l.id}`}
                            className="group rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                        >
                            {l.images?.[0] ? (
                                <div
                                    className="h-40 bg-cover bg-center"
                                    style={{ backgroundImage: `url(${resolveMediaUrl(l.images[0])})` }}
                                />
                            ) : (
                                <div className="h-40 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/30 dark:to-indigo-900/20 flex items-center justify-center">
                                    <Building2 size={32} className="text-indigo-300 dark:text-indigo-700" />
                                </div>
                            )}
                            <div className="p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate flex-1">{l.name}</h3>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                        l.transaction_type === "sale"
                                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    }`}>
                                        {t(`transaction.${l.transaction_type}`)}
                                    </span>
                                </div>
                                {l.neighborhood && (
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1">
                                        <MapPin size={12} /> {l.neighborhood}{l.city ? `, ${l.city}` : ""}
                                    </p>
                                )}
                                <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                                    <span className="flex items-center gap-1"><BedDouble size={12} /> {l.bedrooms}</span>
                                    <span className="flex items-center gap-1"><Bath size={12} /> {l.bathrooms}</span>
                                    {l.area_m2 ? <span className="flex items-center gap-1"><Square size={12} /> {Math.round(l.area_m2)} m²</span> : null}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                                        {l.currency} {Number(l.price).toLocaleString()}
                                        {l.transaction_type === "rent" && <span className="text-[10px] font-normal opacity-70">/mes</span>}
                                    </span>
                                    {l.status !== "available" && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                            {t(`status.${l.status}`)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            <BulkImportModal
                open={showImport}
                onClose={() => setShowImport(false)}
                endpoint={`/listings/${activeTenantId}/bulk-import`}
                title={t("title")}
                onImported={load}
                fields={[
                    // Los alias son los encabezados que de verdad trae la
                    // planilla de una inmobiliaria, no los del sistema.
                    { key: "name", label: t("name"), required: true, aliases: ["nombre", "titulo", "inmueble", "propiedad"] },
                    { key: "transactionType", label: t("transactionType"), required: true, aliases: ["operacion", "tipo de operacion", "venta o arriendo"] },
                    { key: "propertyKind", label: t("propertyKind"), aliases: ["tipo", "tipo de inmueble"] },
                    { key: "price", label: t("price"), type: "number", aliases: ["precio", "valor", "precio de venta"] },
                    { key: "bedrooms", label: t("bedrooms"), type: "number", aliases: ["habitaciones", "alcobas", "cuartos", "dormitorios"] },
                    { key: "bathrooms", label: t("bathrooms"), type: "number", aliases: ["baños", "banos"] },
                    { key: "areaM2", label: t("areaM2"), type: "number", aliases: ["area", "metros", "m2", "metros cuadrados"] },
                    { key: "neighborhood", label: t("neighborhood"), aliases: ["barrio", "zona", "sector"] },
                    { key: "city", label: t("city"), aliases: ["ciudad", "municipio"] },
                ]}
            />
            {showCreate && (
                <CreateListingModal
                    tenantId={activeTenantId!}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); load(); }}
                    t={t}
                    tc={tc}
                />
            )}

            {showZones && <ZonesModal onClose={() => setShowZones(false)} />}
        </div>
    );
}

function CreateListingModal({ tenantId, onClose, onCreated, t, tc }: {
    tenantId: string;
    onClose: () => void;
    onCreated: () => void;
    t: any;
    tc: any;
}) {
    const [form, setForm] = useState({
        name: "",
        transactionType: "sale" as "sale" | "rent",
        propertyKind: "apartment",
        price: 0,
        currency: "COP",
        bedrooms: 2,
        bathrooms: 1,
        areaM2: 0,
        parkingSpots: 1,
        stratum: 4,
        neighborhood: "",
        city: "",
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (!form.name.trim()) {
            setError(t("nameRequired"));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await api.createListing(tenantId, form);
            if (res.success) onCreated();
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
            <div className="bg-white dark:bg-neutral-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{t("createListing")}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, transactionType: "sale" })}
                            className={`px-3 py-3 rounded-lg border transition-colors ${form.transactionType === "sale" ? "border-purple-500 bg-purple-50 dark:bg-purple-950/30" : "border-neutral-200 dark:border-neutral-700"}`}
                        >
                            <span className="text-sm font-semibold">{t("transaction.sale")}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, transactionType: "rent" })}
                            className={`px-3 py-3 rounded-lg border transition-colors ${form.transactionType === "rent" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-neutral-200 dark:border-neutral-700"}`}
                        >
                            <span className="text-sm font-semibold">{t("transaction.rent")}</span>
                        </button>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")} *</label>
                        <input
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder={t("namePlaceholder")}
                            className={inputCls}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("propertyKind")}</label>
                            <select value={form.propertyKind} onChange={e => setForm({ ...form, propertyKind: e.target.value })} className={inputCls}>
                                {PROPERTY_KINDS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("price")}</label>
                            <input
                                type="number"
                                min={0}
                                value={form.price}
                                onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("bedrooms")}</label>
                            <input type="number" min={0} value={form.bedrooms} onChange={e => setForm({ ...form, bedrooms: parseInt(e.target.value) || 0 })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("bathrooms")}</label>
                            <input type="number" min={0} step={0.5} value={form.bathrooms} onChange={e => setForm({ ...form, bathrooms: parseFloat(e.target.value) || 0 })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("areaM2")}</label>
                            <input type="number" min={0} value={form.areaM2} onChange={e => setForm({ ...form, areaM2: parseFloat(e.target.value) || 0 })} className={inputCls} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("neighborhood")}</label>
                            <input value={form.neighborhood} onChange={e => setForm({ ...form, neighborhood: e.target.value })} placeholder={t("neighborhoodPlaceholder")} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("city")}</label>
                            <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className={inputCls} />
                        </div>
                    </div>

                    {error && <p className="text-xs text-red-500">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800">
                    <button onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !form.name.trim()}
                        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? tc("saving") : t("createListing")}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Ruteo por zonas: qué asesor atiende cada barrio.
 *
 * `listing_zone_agents`, `resolveAgentForZone` y sus tres endpoints estaban
 * construidos ENTEROS y tenían cero llamadores — el ruteo por zonas existía y
 * no ruteaba nada, porque no había forma de cargar un solo mapeo. Con esto la
 * cascada de asignación de la visita (dueño del listing → zona → nadie) tiene
 * de dónde leer.
 */
function ZonesModal({ onClose }: { onClose: () => void }) {
    const { activeTenantId } = useTenant();
    const t = useTranslations("listings");
    const tc = useTranslations("common");

    const [zones, setZones] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [form, setForm] = useState({ neighborhood: "", city: "", agentId: "" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function load() {
        if (!activeTenantId) return;
        const [z, u] = await Promise.all([
            api.listListingZones(activeTenantId).catch(() => null),
            api.getUsers().catch(() => null),
        ]);
        if (z?.success && Array.isArray(z.data)) setZones(z.data);
        // Solo los que pueden atender una visita: el super_admin no es asesor.
        if (u?.success && Array.isArray(u.data)) {
            setUsers(u.data.filter((x: any) => x.role !== "super_admin" && x.isActive !== false));
        }
    }

    useEffect(() => { load(); }, [activeTenantId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function handleAdd() {
        if (!activeTenantId) return;
        if (!form.neighborhood.trim() || !form.agentId) {
            setError(t("zoneMissingFields"));
            return;
        }
        setBusy(true);
        setError("");
        const res = await api.setListingZone(activeTenantId, {
            neighborhood: form.neighborhood.trim(),
            city: form.city.trim() || undefined,
            agentId: form.agentId,
        }).catch(() => ({ success: false } as any));
        setBusy(false);
        if (!res?.success) {
            setError(tc("errorSaving"));
            return;
        }
        setForm({ neighborhood: "", city: "", agentId: "" });
        load();
    }

    async function handleRemove(id: string) {
        if (!activeTenantId) return;
        await api.removeListingZone(activeTenantId, id).catch(() => null);
        load();
    }

    const agentName = (id: string) => {
        const u = users.find((x: any) => x.id === id);
        return u?.name || u?.email || id.slice(0, 8);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()}>
            <div className="w-full max-w-lg rounded-xl bg-card border border-border p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-indigo-600" />
                        {t("zonesTitle")}
                    </h3>
                    <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground cursor-pointer">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <p className="text-xs text-muted-foreground mb-4">{t("zonesHint")}</p>

                {error && (
                    <div className="px-3 py-2 rounded-lg mb-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end mb-4">
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1 font-medium">{t("neighborhood")}</label>
                        <input
                            value={form.neighborhood}
                            onChange={e => setForm({ ...form, neighborhood: e.target.value })}
                            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1 font-medium">{t("city")}</label>
                        <input
                            value={form.city}
                            onChange={e => setForm({ ...form, city: e.target.value })}
                            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] text-muted-foreground mb-1 font-medium">{t("agent")}</label>
                        <select
                            value={form.agentId}
                            onChange={e => setForm({ ...form, agentId: e.target.value })}
                            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm cursor-pointer"
                        >
                            <option value="">{tc("select")}</option>
                            {users.map((u: any) => (
                                <option key={u.id} value={u.id}>{u.name || u.email}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={handleAdd}
                        disabled={busy}
                        className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold cursor-pointer"
                    >
                        <Plus size={16} />
                    </button>
                </div>

                <div className="border border-border rounded-lg divide-y divide-border">
                    {zones.length === 0 ? (
                        <p className="text-center py-6 text-sm text-muted-foreground">{t("noZones")}</p>
                    ) : zones.map((z: any) => (
                        <div key={z.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div>
                                <span className="font-medium">{z.neighborhood}</span>
                                {z.city && <span className="text-muted-foreground"> · {z.city}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{agentName(z.agent_id)}</span>
                                <button
                                    onClick={() => handleRemove(z.id)}
                                    className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
