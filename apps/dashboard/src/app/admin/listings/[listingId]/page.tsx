"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import {
    Building2, Save, Check, MapPin, ExternalLink, Home,
} from "lucide-react";

interface Listing {
    id: string;
    name: string;
    transaction_type: "sale" | "rent";
    property_kind: string;
    price: number;
    currency: string;
    rent_period?: string;
    hoa_fee?: number;
    deposit?: number;
    min_rental_months?: number;
    financing_available: boolean;
    bedrooms: number;
    bathrooms: number;
    area_m2: number;
    parking_spots: number;
    stratum?: number;
    year_built?: number;
    address?: string;
    neighborhood?: string;
    city?: string;
    description?: string;
    amenities?: string[];
    images?: string[];
    external_url?: string;
    status: string;
    is_active: boolean;
}

export default function ListingDetailPage() {
    const params = useParams();
    const listingId = params.listingId as string;
    const { activeTenantId } = useTenant();
    const t = useTranslations("listings");
    const tc = useTranslations("common");

    const [listing, setListing] = useState<Listing | null>(null);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<any>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => { load(); }, [activeTenantId, listingId]);

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.getListing(activeTenantId, listingId);
        if (res.success && res.data) {
            setListing(res.data);
            setForm({
                name: res.data.name,
                transactionType: res.data.transaction_type,
                propertyKind: res.data.property_kind,
                price: res.data.price,
                currency: res.data.currency,
                rentPeriod: res.data.rent_period,
                hoaFee: res.data.hoa_fee || 0,
                deposit: res.data.deposit || 0,
                minRentalMonths: res.data.min_rental_months || 0,
                financingAvailable: res.data.financing_available,
                bedrooms: res.data.bedrooms,
                bathrooms: Number(res.data.bathrooms),
                areaM2: Number(res.data.area_m2 || 0),
                parkingSpots: res.data.parking_spots,
                stratum: res.data.stratum || 0,
                yearBuilt: res.data.year_built || 0,
                address: res.data.address || "",
                neighborhood: res.data.neighborhood || "",
                city: res.data.city || "",
                description: res.data.description || "",
                externalUrl: res.data.external_url || "",
                status: res.data.status,
                isActive: res.data.is_active,
            });
        }
        setLoading(false);
    }

    async function handleSave() {
        if (!activeTenantId || !listing) return;
        setSaving(true);
        const res = await api.updateListing(activeTenantId, listing.id, form);
        if (res.success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            load();
        }
        setSaving(false);
    }

    if (loading || !listing) {
        return (
            <div className="flex justify-center items-center h-[400px]">
                <div className="w-10 h-10 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
            </div>
        );
    }

    const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto">
            <PageHeader
                title={listing.name}
                subtitle={listing.neighborhood ? `${listing.neighborhood}${listing.city ? `, ${listing.city}` : ""}` : ""}
                icon={Building2}
                breadcrumbs={
                    <Link href="/admin/listings" className="text-xs text-indigo-500 hover:underline">
                        &larr; {t("title")}
                    </Link>
                }
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")}</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("status.label")}</label>
                    <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputCls}>
                        <option value="available">{t("status.available")}</option>
                        <option value="reserved">{t("status.reserved")}</option>
                        <option value="sold">{t("status.sold")}</option>
                        <option value="rented">{t("status.rented")}</option>
                        <option value="inactive">{t("status.inactive")}</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-5">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("price")} ({form.currency})</label>
                    <input type="number" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className={inputCls} />
                </div>
                {form.transactionType === "rent" && (
                    <>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("hoaFee")}</label>
                            <input type="number" value={form.hoaFee} onChange={e => setForm({ ...form, hoaFee: parseFloat(e.target.value) || 0 })} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("deposit")}</label>
                            <input type="number" value={form.deposit} onChange={e => setForm({ ...form, deposit: parseFloat(e.target.value) || 0 })} className={inputCls} />
                        </div>
                    </>
                )}
            </div>

            <div className="grid grid-cols-3 gap-4 mb-5">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("bedrooms")}</label>
                    <input type="number" value={form.bedrooms} onChange={e => setForm({ ...form, bedrooms: parseInt(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("bathrooms")}</label>
                    <input type="number" step={0.5} value={form.bathrooms} onChange={e => setForm({ ...form, bathrooms: parseFloat(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("areaM2")}</label>
                    <input type="number" value={form.areaM2} onChange={e => setForm({ ...form, areaM2: parseFloat(e.target.value) || 0 })} className={inputCls} />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-5">
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("parking")}</label>
                    <input type="number" value={form.parkingSpots} onChange={e => setForm({ ...form, parkingSpots: parseInt(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("stratum")}</label>
                    <input type="number" min={1} max={6} value={form.stratum} onChange={e => setForm({ ...form, stratum: parseInt(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("yearBuilt")}</label>
                    <input type="number" value={form.yearBuilt} onChange={e => setForm({ ...form, yearBuilt: parseInt(e.target.value) || 0 })} className={inputCls} />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("address")}</label>
                    <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("neighborhood")}</label>
                    <input value={form.neighborhood} onChange={e => setForm({ ...form, neighborhood: e.target.value })} className={inputCls} />
                </div>
            </div>

            <div className="mb-5">
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("city")}</label>
                <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className={inputCls} />
            </div>

            <div className="mb-5">
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("description")}</label>
                <textarea
                    rows={4}
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder={t("descriptionPlaceholder")}
                    className={`${inputCls} resize-y`}
                />
            </div>

            <div className="mb-5">
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("externalUrl")}</label>
                <input
                    value={form.externalUrl}
                    onChange={e => setForm({ ...form, externalUrl: e.target.value })}
                    placeholder="https://www.fincaraiz.com.co/..."
                    className={inputCls}
                />
                {form.externalUrl && (
                    <a href={form.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline mt-1 inline-flex items-center gap-1">
                        <ExternalLink size={12} /> {t("openExternal")}
                    </a>
                )}
            </div>

            {form.transactionType === "sale" && (
                <label className="flex items-center gap-2 text-sm cursor-pointer mb-5">
                    <input
                        type="checkbox"
                        checked={form.financingAvailable}
                        onChange={e => setForm({ ...form, financingAvailable: e.target.checked })}
                        className="w-4 h-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {t("financingAvailable")}
                </label>
            )}

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
