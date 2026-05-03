"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav, type TabItem } from "@/components/ui/tab-nav";
import {
  Home,
  Info,
  CalendarDays,
  List,
  Link2,
  DoorOpen,
  RefreshCw,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Save,
  AlertTriangle,
  Plus,
  X,
  Image,
  Edit2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { AMENITY_CATEGORIES } from "../page";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Property {
  id: string;
  name: string;
  description?: string;
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
  images?: string[];
  is_active: boolean;
  check_in_instructions: string;
  house_rules: string;
  check_in_time: string;
  check_out_time: string;
}

interface CalendarDay {
  date: string;
  status: "available" | "booked" | "blocked";
  bookingId?: string;
  source?: string;
  blockId?: string;
  summary?: string | null;
}

interface Booking {
  id: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  status: string;
  source: string;
  total_price: number;
  currency: string;
}

interface Feed {
  id: string;
  feed_name: string;
  source: string;
  import_url: string;
  last_sync_at: string | null;
  events_imported: number;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

const FEED_SOURCES = ["Airbnb", "Booking", "Vrbo", "Otro"];

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function PropertyDetailPage() {
  const params = useParams();
  const propertyId = params.propertyId as string;
  const { activeTenantId } = useTenant();
  const t = useTranslations("properties");
  const tc = useTranslations("common");
  // Calendar is the first tab (most important for vacation rental)
  const [activeTab, setActiveTab] = useState("calendar");
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);

  const tabs: TabItem[] = [
    { id: "calendar", label: t("calendar"), icon: CalendarDays },
    { id: "info", label: "Info", icon: Info },
    { id: "photos", label: t("photos"), icon: Image },
    { id: "bookings", label: t("bookings"), icon: List },
    { id: "feeds", label: t("feeds"), icon: Link2 },
    { id: "checkin", label: t("checkIn"), icon: DoorOpen },
  ];

  useEffect(() => {
    loadProperty();
  }, [activeTenantId, propertyId]);

  async function loadProperty() {
    if (!activeTenantId) return;
    setLoading(true);
    const res = await api.getProperty(activeTenantId, propertyId);
    if (res.success && res.data) setProperty(res.data);
    setLoading(false);
  }

  if (loading || !property) {
    return (
      <div className="flex justify-center items-center h-[400px]">
        <div className="w-10 h-10 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title={property.name}
        subtitle={property.city}
        icon={Home}
        breadcrumbs={
          <Link href="/admin/properties" className="text-xs text-indigo-500 hover:underline">
            &larr; {t("title")}
          </Link>
        }
      />

      <TabNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} className="mb-6" />

      {activeTab === "calendar" && (
        <CalendarTab
          tenantId={activeTenantId!}
          propertyId={propertyId}
          t={t}
          tc={tc}
          onGoToFeeds={() => setActiveTab("feeds")}
        />
      )}
      {activeTab === "info" && (
        <InfoTab
          property={property}
          tenantId={activeTenantId!}
          onSaved={loadProperty}
          t={t}
          tc={tc}
        />
      )}
      {activeTab === "photos" && (
        <PhotosTab
          property={property}
          tenantId={activeTenantId!}
          onSaved={loadProperty}
          t={t}
          tc={tc}
        />
      )}
      {activeTab === "bookings" && (
        <BookingsTab tenantId={activeTenantId!} propertyId={propertyId} t={t} tc={tc} />
      )}
      {activeTab === "feeds" && (
        <FeedsTab tenantId={activeTenantId!} propertyId={propertyId} t={t} tc={tc} />
      )}
      {activeTab === "checkin" && (
        <CheckInTab
          property={property}
          tenantId={activeTenantId!}
          onSaved={loadProperty}
          t={t}
          tc={tc}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Info                                                          */
/* ------------------------------------------------------------------ */

function InfoTab({
  property,
  tenantId,
  onSaved,
  t,
  tc,
}: {
  property: Property;
  tenantId: string;
  onSaved: () => void;
  t: any;
  tc: any;
}) {
  const [form, setForm] = useState({
    ...property,
    description: property.description || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Resync form when property reloads from parent (after save) — otherwise the
  // editor would show stale values until the user navigates away and back.
  useEffect(() => {
    setForm({
      ...property,
      description: property.description || "",
    });
  }, [property.id, property.name, property.address, property.city, property.max_guests, property.bedrooms, property.bathrooms, property.night_price, property.cleaning_fee, property.min_nights, property.is_active]);

  function toggleAmenity(a: string) {
    setForm(prev => ({
      ...prev,
      amenities: (prev.amenities || []).includes(a)
        ? prev.amenities.filter((x: string) => x !== a)
        : [...(prev.amenities || []), a],
    }));
  }

  async function handleSave() {
    setSaving(true);
    const res = await api.updateProperty(tenantId, property.id, {
      name: form.name,
      description: form.description,
      address: form.address,
      city: form.city,
      maxGuests: form.max_guests,
      bedrooms: form.bedrooms,
      bathrooms: form.bathrooms,
      nightPrice: form.night_price,
      cleaningFee: form.cleaning_fee,
      currency: form.currency,
      minNights: form.min_nights,
      amenities: form.amenities,
      isActive: form.is_active,
    });
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
    setSaving(false);
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Name + City */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")}</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("city")}</label>
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} />
        </div>
      </div>

      {/* Address */}
      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("address")}</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("description")}</label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder={t("descriptionPlaceholder")}
          className={`${inputCls} resize-y`}
        />
      </div>

      {/* Guests / Rooms / Baths */}
      <div className="grid grid-cols-3 gap-4">
        <NumberField label={t("maxGuests")} min={1} value={form.max_guests} onChange={(v) => setForm({ ...form, max_guests: v })} className={inputCls} />
        <NumberField label={t("bedrooms")} min={0} value={form.bedrooms} onChange={(v) => setForm({ ...form, bedrooms: v })} className={inputCls} />
        <NumberField label={t("bathrooms")} min={0} value={form.bathrooms} onChange={(v) => setForm({ ...form, bathrooms: v })} className={inputCls} />
      </div>

      {/* Pricing */}
      <div className="grid grid-cols-3 gap-4">
        <NumberField label={t("nightPrice")} min={0} value={form.night_price} onChange={(v) => setForm({ ...form, night_price: v })} className={inputCls} />
        <NumberField label={t("cleaningFee")} min={0} value={form.cleaning_fee} onChange={(v) => setForm({ ...form, cleaning_fee: v })} className={inputCls} />
        <NumberField label={t("minNights")} min={1} value={form.min_nights} onChange={(v) => setForm({ ...form, min_nights: v })} className={inputCls} />
      </div>

      {/* Amenities by category */}
      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3">{t("amenities")}</label>
        <div className="space-y-4">
          {AMENITY_CATEGORIES.map(cat => (
            <div key={cat.key}>
              <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 mb-1.5 uppercase tracking-wide">
                {cat.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cat.items.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleAmenity(item.key)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      (form.amenities || []).includes(item.key)
                        ? "bg-indigo-500 text-white border-indigo-500"
                        : "border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-indigo-300 dark:hover:border-indigo-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-600 focus:ring-indigo-500"
          />
          {tc("active")}
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {saved ? <Check size={16} /> : <Save size={16} />}
        {saved ? t("saved") : tc("save")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Photos                                                        */
/* ------------------------------------------------------------------ */

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function PhotosTab({
  property,
  tenantId,
  onSaved,
  t,
  tc,
}: {
  property: Property;
  tenantId: string;
  onSaved: () => void;
  t: any;
  tc: any;
}) {
  const [images, setImages] = useState<string[]>(property.images || []);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Resync when property reloads
  useEffect(() => {
    setImages(property.images || []);
  }, [property.id, JSON.stringify(property.images)]);

  const dirty = JSON.stringify(images) !== JSON.stringify(property.images || []);

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const slotsLeft = MAX_IMAGES - images.length;
    const errs: string[] = [];

    if (slotsLeft <= 0) {
      setErrors([t("photoLimitReached", { max: MAX_IMAGES })]);
      return;
    }

    // Filter & slice up to slotsLeft
    const valid: File[] = [];
    for (const f of files) {
      if (valid.length >= slotsLeft) {
        errs.push(t("photoLimitWillExceed", { max: MAX_IMAGES, dropped: files.length - valid.length }));
        break;
      }
      if (!f.type.startsWith("image/")) {
        errs.push(`${f.name}: ${t("photoInvalidType")}`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        errs.push(`${f.name}: ${t("photoTooLarge", { maxMb: 2 })}`);
        continue;
      }
      valid.push(f);
    }

    if (valid.length === 0) {
      setErrors(errs);
      return;
    }

    setErrors(errs);
    setUploading(true);
    setProgress({ current: 0, total: valid.length });

    const accessToken = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
    const newUrls: string[] = [];

    for (let i = 0; i < valid.length; i++) {
      const f = valid[i];
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch(
          `${apiBase}/media/upload/${tenantId}?entityType=property&entityId=${property.id}`,
          {
            method: "POST",
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: fd,
          },
        );
        if (res.ok) {
          const data = await res.json();
          const url = data.url || data.data?.url;
          if (url) newUrls.push(url);
        } else {
          const text = await res.text();
          errs.push(`${f.name}: ${tc("errorSaving")} (${res.status})`);
          console.error("upload error", res.status, text);
        }
      } catch (err: any) {
        errs.push(`${f.name}: ${err?.message || tc("errorSaving")}`);
      }
      setProgress({ current: i + 1, total: valid.length });
    }

    setImages(prev => [...prev, ...newUrls]);
    setErrors(errs);
    setUploading(false);
    setProgress(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  function removeAt(idx: number) {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }

  function setPrimary(idx: number) {
    if (idx === 0) return;
    setImages(prev => {
      const next = [...prev];
      const [picked] = next.splice(idx, 1);
      next.unshift(picked);
      return next;
    });
  }

  function moveLeft(idx: number) {
    if (idx === 0) return;
    setImages(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveRight(idx: number) {
    if (idx === images.length - 1) return;
    setImages(prev => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const res = await api.updateProperty(tenantId, property.id, { images });
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
    setSaving(false);
  }

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header with counter */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("photos")}</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("photosDesc", { max: MAX_IMAGES, maxMb: 2 })}
          </p>
        </div>
        <span className={`text-xs font-medium ${images.length >= MAX_IMAGES ? "text-amber-600 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"}`}>
          {images.length}/{MAX_IMAGES}
        </span>
      </div>

      {/* Drop zone */}
      {images.length < MAX_IMAGES && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`relative rounded-xl border-2 border-dashed transition-colors px-6 py-10 text-center ${
            dragOver
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
          } ${uploading ? "opacity-60 pointer-events-none" : "cursor-pointer hover:border-indigo-400"}`}
        >
          <label className="absolute inset-0 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>
          <Image size={32} className="mx-auto text-neutral-400 dark:text-neutral-500 mb-2" />
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {t("photoDropTitle")}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {t("photoDropSubtitle", { remaining: MAX_IMAGES - images.length, maxMb: 2 })}
          </p>
          {progress && (
            <div className="mt-4 max-w-xs mx-auto">
              <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                {t("photoUploadingProgress", { current: progress.current, total: progress.total })}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3">
          <ul className="text-xs text-red-700 dark:text-red-300 space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Gallery */}
      {images.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-6">
          {t("noPhotosYet")}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {images.map((url, i) => (
            <div key={url + i} className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-800">
              <img src={url} alt="" className="w-full h-full object-cover" />

              {/* Primary badge */}
              {i === 0 && (
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-indigo-500 text-white text-[10px] font-semibold uppercase tracking-wide">
                  {t("photoPrimary")}
                </span>
              )}

              {/* Actions overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2 gap-1">
                <div className="flex gap-1">
                  {i > 0 && (
                    <button
                      onClick={() => setPrimary(i)}
                      title={t("photoSetPrimary")}
                      className="p-1.5 rounded-lg bg-white/90 hover:bg-white text-neutral-700 transition-colors"
                    >
                      <Check size={14} />
                    </button>
                  )}
                  {i > 0 && (
                    <button
                      onClick={() => moveLeft(i)}
                      title={t("photoMoveLeft")}
                      className="p-1.5 rounded-lg bg-white/90 hover:bg-white text-neutral-700 transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  )}
                  {i < images.length - 1 && (
                    <button
                      onClick={() => moveRight(i)}
                      title={t("photoMoveRight")}
                      className="p-1.5 rounded-lg bg-white/90 hover:bg-white text-neutral-700 transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => removeAt(i)}
                  title={tc("delete")}
                  className="p-1.5 rounded-lg bg-red-500/90 hover:bg-red-600 text-white transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save bar (only when dirty) */}
      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-end gap-2 p-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-lg">
          <span className="text-xs text-neutral-500 dark:text-neutral-400 mr-auto">
            {t("photosUnsaved")}
          </span>
          <button
            onClick={() => setImages(property.images || [])}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {tc("cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? t("saved") : tc("save")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Calendar                                                      */
/* ------------------------------------------------------------------ */

function CalendarTab({
  tenantId,
  propertyId,
  t,
  tc: tcCommon,
  onGoToFeeds,
}: {
  tenantId: string;
  propertyId: string;
  t: any;
  tc: any;
  onGoToFeeds: () => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoaded, setFeedsLoaded] = useState(false);
  // Range selection state for blocking multiple days
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockNote, setBlockNote] = useState("");
  const [blockSaving, setBlockSaving] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<{ blockId: string; date: string } | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  useEffect(() => {
    loadCalendar();
  }, [tenantId, propertyId, year, month]);

  useEffect(() => {
    loadFeedsCount();
  }, [tenantId, propertyId]);

  async function loadFeedsCount() {
    const res = await api.listPropertyFeeds(tenantId, propertyId);
    if (res.success && res.data) setFeeds(res.data);
    setFeedsLoaded(true);
  }

  async function loadCalendar() {
    setLoading(true);
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    const res = await api.getPropertyCalendar(tenantId, propertyId, monthStr);
    if (res.success && res.data) setDays(res.data);
    else setDays([]);
    setLoading(false);
  }

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function handleDayClick(cell: any) {
    if (cell.status === "past" || cell.status === "booked") return;

    if (cell.status === "blocked" && cell.source === "Manual" && cell.blockId) {
      setUnblockTarget({ blockId: cell.blockId, date: cell.date });
      return;
    }
    if (cell.status === "blocked") return;

    // Range selection on available cells: first click sets start, second click sets end
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(cell.date);
      setRangeEnd(null);
    } else {
      // Second click — finalize range and open modal
      if (cell.date < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(cell.date);
      } else {
        setRangeEnd(cell.date);
      }
      setShowBlockModal(true);
    }
  }

  function handleSingleDayBlock(date: string) {
    setRangeStart(date);
    setRangeEnd(date);
    setShowBlockModal(true);
  }

  async function handleConfirmBlock() {
    const start = rangeStart;
    const end = rangeEnd || rangeStart;
    if (!start || !end) return;
    setBlockSaving(true);
    try {
      await api.createPropertyBlock(tenantId, propertyId, {
        checkIn: start,
        checkOut: end,
        summary: blockNote.trim() || undefined,
      });
      setShowBlockModal(false);
      setRangeStart(null);
      setRangeEnd(null);
      setBlockNote("");
      loadCalendar();
    } finally {
      setBlockSaving(false);
    }
  }

  async function handleConfirmUnblock() {
    if (!unblockTarget) return;
    await api.deletePropertyBlock(tenantId, unblockTarget.blockId);
    setUnblockTarget(null);
    loadCalendar();
  }

  function isInRange(date: string): boolean {
    if (!rangeStart) return false;
    const end = rangeEnd || hoverDate || rangeStart;
    const lo = rangeStart < end ? rangeStart : end;
    const hi = rangeStart < end ? end : rangeStart;
    return date >= lo && date <= hi;
  }

  const monthName = new Date(year, month - 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = today.toISOString().split("T")[0];

  const dayMap = new Map(days.map(d => [d.date, d]));

  const cells: { day: number; date: string; status: string; source?: string; blockId?: string; summary?: string | null }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: 0, date: "", status: "" });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = dayMap.get(dateStr);
    let status: string = entry?.status || "available";
    if (dateStr < todayStr) status = "past";
    cells.push({ day: d, date: dateStr, status, source: entry?.source, blockId: entry?.blockId, summary: entry?.summary });
  }

  const DOW_LABELS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

  return (
    <div>
      {/* No feeds banner */}
      {feedsLoaded && feeds.length === 0 && (
        <div className="mb-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("syncAvailability")}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("syncAvailabilityDesc")}</p>
          </div>
          <button
            onClick={onGoToFeeds}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition-colors shrink-0"
          >
            {t("connect")}
          </button>
        </div>
      )}

      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
          <ChevronLeft size={18} className="text-neutral-500" />
        </button>
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 capitalize">
          {monthName}
        </span>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
          <ChevronRight size={18} className="text-neutral-500" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW_LABELS.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-neutral-400 dark:text-neutral-500 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Range selection hint */}
          {rangeStart && !rangeEnd && (
            <div className="mb-2 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-xs text-indigo-900 dark:text-indigo-200 flex items-center justify-between">
              <span>{t("blockRangeHint", { start: rangeStart })}</span>
              <button
                onClick={() => { setRangeStart(null); setRangeEnd(null); }}
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {tcCommon("cancel")}
              </button>
            </div>
          )}

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c, i) => {
              if (c.day === 0) return <div key={`empty-${i}`} />;

              const inRange = c.status === "available" && isInRange(c.date);
              let bg = "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400";
              let cursor = "cursor-pointer hover:ring-2 hover:ring-emerald-500 hover:ring-offset-1";

              if (c.status === "booked") {
                bg = "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400";
                cursor = "cursor-not-allowed opacity-80";
              }
              else if (c.status === "blocked") {
                bg = "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400";
                cursor = c.source === 'Manual' ? "cursor-pointer hover:ring-2 hover:ring-amber-500 hover:ring-offset-1" : "cursor-not-allowed opacity-80";
              }
              else if (c.status === "past") {
                bg = "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500";
                cursor = "cursor-not-allowed opacity-60";
              }

              if (inRange) {
                bg = "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500";
              }

              const sourceLabel = c.source === 'direct' ? null
                : c.source === 'Manual' ? 'Manual'
                : c.source; // 'Airbnb', 'Booking', 'Vrbo', etc.
              const tooltip = c.summary
                ? `${sourceLabel || ''}${sourceLabel ? ' · ' : ''}${c.summary}`
                : sourceLabel || undefined;

              return (
                <div
                  key={c.date}
                  onClick={() => handleDayClick(c)}
                  onMouseEnter={() => setHoverDate(c.date)}
                  onMouseLeave={() => setHoverDate(null)}
                  title={tooltip}
                  className={`flex flex-col items-center justify-center h-14 rounded-lg text-xs font-medium transition-all ${bg} ${cursor}`}
                >
                  <span className="text-[13px] leading-none">{c.day}</span>
                  {sourceLabel && (
                    <span className="text-[9px] opacity-80 leading-none mt-0.5 truncate max-w-full px-1">
                      {sourceLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend + how-to */}
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-100 dark:bg-emerald-900/30" />
                {t("available")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30" />
                {t("booked")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30" />
                {t("blocked")}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {t("blockHowTo")}
            </p>
          </div>
        </>
      )}

      {/* Block range modal */}
      {showBlockModal && rangeStart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl p-5 w-full max-w-sm shadow-xl">
            <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{t("blockDates")}</h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              {rangeEnd && rangeEnd !== rangeStart
                ? t("blockRangeFromTo", { start: rangeStart, end: rangeEnd })
                : t("blockSingleDay", { date: rangeStart })}
            </p>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              {t("blockNote")}
            </label>
            <textarea
              rows={2}
              value={blockNote}
              onChange={(e) => setBlockNote(e.target.value)}
              placeholder={t("blockNotePlaceholder")}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowBlockModal(false);
                  setRangeStart(null);
                  setRangeEnd(null);
                  setBlockNote("");
                }}
                disabled={blockSaving}
                className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {tcCommon("cancel")}
              </button>
              <button
                onClick={handleConfirmBlock}
                disabled={blockSaving}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {blockSaving ? tcCommon("saving") : t("block")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock confirmation modal */}
      {unblockTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl p-5 w-full max-w-xs shadow-xl">
            <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-2">{t("unblockDate")}</h4>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
              {t("unblockConfirm", { date: unblockTarget.date })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setUnblockTarget(null)}
                className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                {tcCommon("cancel")}
              </button>
              <button
                onClick={handleConfirmUnblock}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                {t("unblock")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Bookings                                                      */
/* ------------------------------------------------------------------ */

function BookingsTab({
  tenantId,
  propertyId,
  t,
  tc,
}: {
  tenantId: string;
  propertyId: string;
  t: any;
  tc: any;
}) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBookings();
  }, [tenantId, propertyId]);

  async function loadBookings() {
    setLoading(true);
    const res = await api.listPropertyBookings(tenantId, propertyId);
    if (res.success && res.data) setBookings(res.data);
    setLoading(false);
  }

  const formatDate = (s: string) => {
    try { return new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return s; }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-neutral-500 dark:text-neutral-400">
        {tc("noData")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <th className="text-left py-2 px-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("name")}</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">Check-in</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">Check-out</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">{t("feedSource")}</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">Status</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
              <td className="py-2.5 px-3 text-neutral-900 dark:text-neutral-100">{b.guest_name || "-"}</td>
              <td className="py-2.5 px-3 text-neutral-600 dark:text-neutral-300">{formatDate(b.check_in)}</td>
              <td className="py-2.5 px-3 text-neutral-600 dark:text-neutral-300">{formatDate(b.check_out)}</td>
              <td className="py-2.5 px-3">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {b.source}
                </span>
              </td>
              <td className="py-2.5 px-3">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  b.status === "confirmed"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : b.status === "cancelled"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                }`}>
                  {b.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: iCal Feeds                                                    */
/* ------------------------------------------------------------------ */

function FeedsTab({
  tenantId,
  propertyId,
  t,
  tc,
}: {
  tenantId: string;
  propertyId: string;
  t: any;
  tc: any;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", source: "Airbnb", import_url: "" });
  const [editingFeedId, setEditingFeedId] = useState<string | null>(null);

  const exportUrl = `${BASE_URL}/vacation-rental/${tenantId}/properties/${propertyId}/ical`;

  useEffect(() => {
    loadFeeds();
  }, [tenantId, propertyId]);

  async function loadFeeds() {
    setLoading(true);
    const res = await api.listPropertyFeeds(tenantId, propertyId);
    if (res.success && res.data) setFeeds(res.data);
    setLoading(false);
  }

  const [addError, setAddError] = useState<string | null>(null);
  async function handleAdd() {
    setAddError(null);
    if (!form.name || !form.import_url) return;
    if (!/^https?:\/\/.+/i.test(form.import_url.trim())) {
      setAddError(t("invalidIcalUrl") || "URL de iCal inválida");
      return;
    }
    const payload = {
      feedName: form.name,
      source: form.source,
      importUrl: form.import_url.trim(),
    };
    
    let res;
    if (editingFeedId) {
      res = await api.updatePropertyFeed(tenantId, editingFeedId, payload);
    } else {
      res = await api.addPropertyFeed(tenantId, propertyId, payload);
    }

    if (res.success) {
      setShowForm(false);
      setEditingFeedId(null);
      setForm({ name: "", source: "Airbnb", import_url: "" });
      loadFeeds();
    } else {
      setAddError(res.error || tc("errorSaving"));
    }
  }

  async function handleDelete(feedId: string) {
    if (!confirm("¿Estás seguro de que quieres eliminar este calendario?")) return;
    await api.deletePropertyFeed(tenantId, feedId);
    loadFeeds();
  }

  function handleEdit(f: any) {
    setForm({ name: f.feed_name, source: f.source, import_url: f.import_url || "" });
    setEditingFeedId(f.id);
    setShowForm(true);
  }

  async function handleSync(feedId: string) {
    setSyncing(feedId);
    await api.syncPropertyFeed(tenantId, feedId);
    await loadFeeds();
    setSyncing(null);
  }

  function copyExportUrl() {
    navigator.clipboard.writeText(exportUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const formatDate = (s: string | null) => {
    if (!s) return "-";
    try { return new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return s; }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Export URL */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("exportUrl")}</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-3">{t("exportUrlDesc")}</p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={exportUrl}
            className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-600 dark:text-neutral-300 font-mono"
          />
          <button
            onClick={copyExportUrl}
            className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            title="Copy"
          >
            {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} className="text-neutral-500" />}
          </button>
        </div>
      </div>

      {/* Feeds list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Sincronización (iCal)</h3>
          <button
            onClick={() => {
              setEditingFeedId(null);
              setForm({ name: "", source: "Airbnb", import_url: "" });
              setShowForm(!showForm);
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            + Agregar Calendario
          </button>
        </div>

        {showForm && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 mb-4 space-y-3">
            {/* How-to instructions */}
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 p-3 text-xs text-indigo-900 dark:text-indigo-200">
              <p className="font-semibold mb-1.5">{t("addFeedHowToTitle")}</p>
              <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
                <li>{t("addFeedStep1", { source: form.source })}</li>
                <li>{t("addFeedStep2")}</li>
                <li>{t("addFeedStep3")}</li>
              </ol>
              <p className="mt-2 text-[11px] opacity-80">
                {t("addFeedExportHint")}{" "}
                <button onClick={copyExportUrl} className="underline hover:no-underline font-medium">
                  {t("copyExportUrl")}
                </button>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("feedName")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("feedNamePlaceholder")}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("feedSource")}</label>
                <select
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {FEED_SOURCES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("importUrl")}</label>
                <input
                  value={form.import_url}
                  onChange={(e) => setForm({ ...form, import_url: e.target.value })}
                  placeholder="https://www.airbnb.com/calendar/ical/...ics"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {addError && (
              <p className="text-xs text-red-500">{addError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowForm(false); setAddError(null); setEditingFeedId(null); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleAdd}
                disabled={!form.name || !form.import_url}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {tc("save")}
              </button>
            </div>
          </div>
        )}

        {feeds.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-8">
            {tc("noData")}
          </p>
        ) : (
          <div className="space-y-2">
            {feeds.map((f) => (
              <div
                key={f.id}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{f.feed_name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                      {f.source}
                    </span>
                    {f.last_sync_status === "success" && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 inline-flex items-center gap-1">
                        <Check size={10} /> OK
                      </span>
                    )}
                    {f.last_sync_status === "error" && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 inline-flex items-center gap-1">
                        <AlertTriangle size={10} /> Error
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>{t("lastSync")}: {formatDate(f.last_sync_at)}</span>
                    <span>{f.events_imported || 0} eventos</span>
                  </div>
                  {f.last_sync_status === "error" && f.last_sync_error && (
                    <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400 break-words">
                      {f.last_sync_error}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(f)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                    title="Editar"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    onClick={() => handleSync(f.id)}
                    disabled={syncing === f.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors ml-2"
                  >
                    <RefreshCw size={14} className={syncing === f.id ? "animate-spin" : ""} />
                    Sincronizar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Check-in                                                      */
/* ------------------------------------------------------------------ */

function CheckInTab({
  property,
  tenantId,
  onSaved,
  t,
  tc,
}: {
  property: Property;
  tenantId: string;
  onSaved: () => void;
  t: any;
  tc: any;
}) {
  const [form, setForm] = useState({
    check_in_instructions: property.check_in_instructions || "",
    house_rules: property.house_rules || "",
    check_in_time: property.check_in_time || "15:00",
    check_out_time: property.check_out_time || "11:00",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await api.updateProperty(tenantId, property.id, {
      checkInInstructions: form.check_in_instructions,
      houseRules: form.house_rules,
      checkInTime: form.check_in_time,
      checkOutTime: form.check_out_time,
    });
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
    setSaving(false);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Check-in</label>
          <input
            type="time"
            value={form.check_in_time}
            onChange={(e) => setForm({ ...form, check_in_time: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Check-out</label>
          <input
            type="time"
            value={form.check_out_time}
            onChange={(e) => setForm({ ...form, check_out_time: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("checkInInstructions")}</label>
        <textarea
          rows={5}
          value={form.check_in_instructions}
          onChange={(e) => setForm({ ...form, check_in_instructions: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("houseRules")}</label>
        <textarea
          rows={5}
          value={form.house_rules}
          onChange={(e) => setForm({ ...form, house_rules: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {saved ? <Check size={16} /> : <Save size={16} />}
        {saved ? t("saved") : tc("save")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable: NumberField (lets users clear the value & retype)        */
/* ------------------------------------------------------------------ */

function NumberField({
  label, min, value, onChange, className,
}: {
  label: string;
  min: number;
  value: number;
  onChange: (n: number) => void;
  className: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9]/g, "");
          setDraft(v);
          if (v !== "") onChange(Math.max(min, parseInt(v, 10)));
        }}
        onBlur={() => {
          if (draft === "") {
            setDraft(String(min));
            onChange(min);
          }
        }}
        className={className}
      />
    </div>
  );
}
