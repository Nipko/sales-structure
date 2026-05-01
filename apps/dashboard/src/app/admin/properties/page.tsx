"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import {
  Home,
  Plus,
  MapPin,
  Users,
  BedDouble,
  X,
} from "lucide-react";

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  night_price: number;
  cleaning_fee: number;
  currency: string;
  min_nights: number;
  amenities: string[];
  is_active: boolean;
}

const AMENITY_OPTIONS = [
  "wifi", "pool", "parking", "ac", "kitchen", "washer",
  "dryer", "tv", "bbq", "gym", "hot_tub", "balcony",
];

const formatCurrency = (n: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
  }).format(n);

export default function PropertiesPage() {
  const t = useTranslations("properties");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    max_guests: 4,
    bedrooms: 1,
    bathrooms: 1,
    night_price: 0,
    cleaning_fee: 0,
    currency: "USD",
    min_nights: 1,
    amenities: [] as string[],
  });

  useEffect(() => {
    load();
  }, [activeTenantId]);

  async function load() {
    if (!activeTenantId) { setLoading(false); return; }
    setLoading(true);
    const res = await api.listProperties(activeTenantId);
    if (res.success && res.data) setProperties(res.data);
    setLoading(false);
  }

  async function handleCreate() {
    if (!activeTenantId || !form.name) return;
    setSaving(true);
    const res = await api.createProperty(activeTenantId, form);
    if (res.success) {
      setShowModal(false);
      setForm({ name: "", address: "", city: "", max_guests: 4, bedrooms: 1, bathrooms: 1, night_price: 0, cleaning_fee: 0, currency: "USD", min_nights: 1, amenities: [] });
      load();
    }
    setSaving(false);
  }

  function toggleAmenity(a: string) {
    setForm(prev => ({
      ...prev,
      amenities: prev.amenities.includes(a)
        ? prev.amenities.filter(x => x !== a)
        : [...prev.amenities, a],
    }));
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[400px]">
        <div className="w-10 h-10 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        icon={Home}
        action={
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus size={16} />
            {t("addProperty")}
          </button>
        }
      />

      {properties.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Home size={48} className="text-neutral-300 dark:text-neutral-600 mb-4" />
          <p className="text-neutral-500 dark:text-neutral-400 text-sm">
            {t("noProperties")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {properties.map((p) => (
            <Link
              key={p.id}
              href={`/admin/properties/${p.id}`}
              className="block rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                  {p.name}
                </h3>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    p.is_active
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  {p.is_active ? tc("active") : tc("inactive")}
                </span>
              </div>

              {p.city && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 mb-3">
                  <MapPin size={13} />
                  <span>{p.city}</span>
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-neutral-600 dark:text-neutral-300">
                <span className="font-semibold text-base text-neutral-900 dark:text-neutral-100">
                  {formatCurrency(p.night_price, p.currency)}
                  <span className="text-xs font-normal text-neutral-400">/{t("nightPrice").split("/")[1] || "night"}</span>
                </span>
              </div>

              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="flex items-center gap-1">
                  <Users size={13} />
                  {p.max_guests}
                </span>
                <span className="flex items-center gap-1">
                  <BedDouble size={13} />
                  {p.bedrooms}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Property Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {t("addProperty")}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <X size={18} className="text-neutral-500" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("address")}</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* City */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("city")}</label>
                <input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Number fields row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("maxGuests")}</label>
                  <input
                    type="number" min={1}
                    value={form.max_guests}
                    onChange={(e) => setForm({ ...form, max_guests: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("bedrooms")}</label>
                  <input
                    type="number" min={0}
                    value={form.bedrooms}
                    onChange={(e) => setForm({ ...form, bedrooms: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("bathrooms")}</label>
                  <input
                    type="number" min={0}
                    value={form.bathrooms}
                    onChange={(e) => setForm({ ...form, bathrooms: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Pricing row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("nightPrice")}</label>
                  <input
                    type="number" min={0}
                    value={form.night_price}
                    onChange={(e) => setForm({ ...form, night_price: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("cleaningFee")}</label>
                  <input
                    type="number" min={0}
                    value={form.cleaning_fee}
                    onChange={(e) => setForm({ ...form, cleaning_fee: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("minNights")}</label>
                  <input
                    type="number" min={1}
                    value={form.min_nights}
                    onChange={(e) => setForm({ ...form, min_nights: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Amenities */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">{t("amenities")}</label>
                <div className="flex flex-wrap gap-2">
                  {AMENITY_OPTIONS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleAmenity(a)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        form.amenities.includes(a)
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name || saving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? tc("saving") : tc("save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
