"use client";

import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
  name: string;
  source: string;
  import_url: string;
  last_sync: string | null;
  events_imported: number;
  errors: number;
}

const AMENITY_OPTIONS = [
  "wifi", "pool", "parking", "ac", "kitchen", "washer",
  "dryer", "tv", "bbq", "gym", "hot_tub", "balcony",
];

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
  const [activeTab, setActiveTab] = useState("info");
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);

  const tabs: TabItem[] = [
    { id: "info", label: "Info", icon: Info },
    { id: "calendar", label: t("calendar"), icon: CalendarDays },
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

      {activeTab === "info" && (
        <InfoTab
          property={property}
          tenantId={activeTenantId!}
          onSaved={loadProperty}
          t={t}
          tc={tc}
        />
      )}
      {activeTab === "calendar" && (
        <CalendarTab tenantId={activeTenantId!} propertyId={propertyId} t={t} />
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
/*  Tab 1: Info                                                        */
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
  const [form, setForm] = useState({ ...property });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
      address: form.address,
      city: form.city,
      max_guests: form.max_guests,
      bedrooms: form.bedrooms,
      bathrooms: form.bathrooms,
      night_price: form.night_price,
      cleaning_fee: form.cleaning_fee,
      currency: form.currency,
      min_nights: form.min_nights,
      amenities: form.amenities,
      is_active: form.is_active,
    });
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("name")}</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("city")}</label>
          <input
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("address")}</label>
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
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

      <div className="grid grid-cols-3 gap-4">
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

      <div>
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">{t("amenities")}</label>
        <div className="flex flex-wrap gap-2">
          {AMENITY_OPTIONS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => toggleAmenity(a)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                (form.amenities || []).includes(a)
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

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
/*  Tab 2: Calendar                                                    */
/* ------------------------------------------------------------------ */

function CalendarTab({
  tenantId,
  propertyId,
  t,
}: {
  tenantId: string;
  propertyId: string;
  t: any;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCalendar();
  }, [tenantId, propertyId, year, month]);

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

  const monthName = new Date(year, month - 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = today.toISOString().split("T")[0];

  const dayMap = new Map(days.map(d => [d.date, d]));

  const cells: { day: number; date: string; status: string }[] = [];
  // Empty cells for offset
  for (let i = 0; i < startDow; i++) cells.push({ day: 0, date: "", status: "" });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = dayMap.get(dateStr);
    let status: string = entry?.status || "available";
    if (dateStr < todayStr) status = "past";
    cells.push({ day: d, date: dateStr, status });
  }

  const DOW_LABELS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

  return (
    <div>
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

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c, i) => {
              if (c.day === 0) return <div key={`empty-${i}`} />;

              let bg = "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400";
              if (c.status === "booked") bg = "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400";
              else if (c.status === "blocked") bg = "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400";
              else if (c.status === "past") bg = "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500";

              return (
                <div
                  key={c.date}
                  className={`flex items-center justify-center h-10 rounded-lg text-xs font-medium ${bg}`}
                >
                  {c.day}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 text-xs text-neutral-500 dark:text-neutral-400">
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
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3: Bookings                                                    */
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
/*  Tab 4: iCal Feeds                                                  */
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

  async function handleAdd() {
    if (!form.name || !form.import_url) return;
    const res = await api.addPropertyFeed(tenantId, propertyId, form);
    if (res.success) {
      setShowForm(false);
      setForm({ name: "", source: "Airbnb", import_url: "" });
      loadFeeds();
    }
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
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Feeds</h3>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            + {t("addFeed")}
          </button>
        </div>

        {showForm && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{t("feedName")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
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
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{f.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                      {f.source}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>{t("lastSync")}: {formatDate(f.last_sync)}</span>
                    <span>{f.events_imported} eventos</span>
                    {f.errors > 0 && <span className="text-red-500">{f.errors} errores</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleSync(f.id)}
                  disabled={syncing === f.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={14} className={syncing === f.id ? "animate-spin" : ""} />
                  {t("syncNow")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 5: Check-in                                                    */
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
    const res = await api.updateProperty(tenantId, property.id, form);
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
