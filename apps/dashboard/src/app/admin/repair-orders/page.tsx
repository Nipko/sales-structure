"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { useOperatingCurrency } from "@/hooks/useOperatingCurrency";
import {
  api,
  type CreateRepairOrderInput,
  type RepairOrder,
  type RepairOrderSummary,
  type RepairOrderStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatMoney as formatMajorMoney } from "@/lib/format-money";

const STATUSES: readonly RepairOrderStatus[] = [
  "intake",
  "estimating",
  "awaiting_approval",
  "approved",
  "in_progress",
  "ready",
  "delivered",
  "rejected",
  "cancelled",
];

const NEXT_STATUS: Readonly<Record<RepairOrderStatus, readonly RepairOrderStatus[]>> = {
  intake: ["estimating", "cancelled"],
  estimating: ["cancelled"],
  awaiting_approval: ["cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["ready", "cancelled"],
  ready: ["in_progress", "delivered"],
  delivered: [],
  rejected: ["estimating", "cancelled"],
  cancelled: [],
};

const STATUS_STYLE: Readonly<Record<RepairOrderStatus, string>> = {
  intake: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  estimating: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  awaiting_approval: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  in_progress: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  delivered: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  rejected: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

function StatusBadge({ status, label }: { status: RepairOrderStatus; label: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {label}
    </span>
  );
}

export default function RepairOrdersPage() {
  const t = useTranslations("repairOrders");
  const locale = useLocale();
  const { activeTenantId } = useTenant();
  const { canHandleConversations } = useRole();
  const operatingCurrency = useOperatingCurrency();
  const [orders, setOrders] = useState<RepairOrder[]>([]);
  const [summary, setSummary] = useState<RepairOrderSummary>({
    open: 0,
    awaitingApproval: 0,
    readyForDelivery: 0,
    deliveredLast30Days: 0,
  });
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"all" | RepairOrderStatus>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RepairOrder | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const formatCents = useCallback((cents: number | null | undefined, currency?: string | null) => {
    if (cents === null || cents === undefined) return t("notAvailable");
    return formatMajorMoney(cents / 100, currency || operatingCurrency, { locale });
  }, [locale, operatingCurrency, t]);

  const load = useCallback(async () => {
    const tenantId = activeTenantId;
    const currentRequest = ++requestId.current;
    if (!tenantId) {
      setOrders([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [response, summaryResponse] = await Promise.all([
      api.listRepairOrders(tenantId, {
        status: status === "all" ? undefined : status,
        search: search.trim() || undefined,
        limit: 100,
      }),
      api.getRepairOrderSummary(tenantId),
    ]);
    if (currentRequest !== requestId.current) return;
    if (response.success && response.data) {
      setOrders(response.data.items || []);
      setTotal(response.data.total || 0);
      setError(null);
    } else {
      setError(response.error || t("loadError"));
    }
    if (summaryResponse.success && summaryResponse.data) setSummary(summaryResponse.data);
    setLoading(false);
  }, [activeTenantId, search, status, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [load]);

  async function openOrder(order: RepairOrder) {
    if (!activeTenantId) return;
    setSelected(order);
    const response = await api.getRepairOrder(activeTenantId, order.id);
    if (response.success && response.data) setSelected(response.data);
    else setError(response.error || t("detailError"));
  }

  async function transition(target: RepairOrderStatus) {
    if (!activeTenantId || !selected) return;
    if (target === "cancelled" && !window.confirm(t("cancelConfirm"))) return;
    setBusy(true);
    const response = await api.transitionRepairOrder(activeTenantId, selected.id, {
      status: target,
      expectedVersion: selected.version,
    });
    if (response.success) {
      await load();
      await openOrder({ ...selected, ...response.data } as RepairOrder);
    } else {
      setError(response.error || t("transitionError"));
    }
    setBusy(false);
  }

  async function recordEstimateDecision(accepted: boolean) {
    if (!activeTenantId || !selected) return;
    const evidence = window.prompt(t("decisionEvidencePrompt"));
    if (!evidence?.trim()) return;
    setBusy(true);
    const response = await api.recordRepairEstimateDecision(activeTenantId, selected.id, {
      accepted,
      evidence: evidence.trim(),
    });
    if (response.success) {
      await load();
      await openOrder({ ...selected, ...response.data } as RepairOrder);
    } else {
      setError(response.error || t("decisionError"));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Wrench className="h-6 w-6 text-violet-600" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("refresh")}
          </button>
          {canHandleConversations && (
            <button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">
              <Plus className="h-4 w-4" /> {t("newOrder")}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("metrics.open")} value={summary.open} />
        <MetricCard label={t("metrics.awaitingApproval")} value={summary.awaitingApproval} />
        <MetricCard label={t("metrics.readyForDelivery")} value={summary.readyForDelivery} />
        <MetricCard label={t("metrics.deliveredLast30Days")} value={summary.deliveredLast30Days} />
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[1fr_220px]">
        <label className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="all">{t("allStatuses")}</option>
          {STATUSES.map((item) => <option key={item} value={item}>{t(`status.${item}`)}</option>)}
        </select>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("close")}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">{t("results", { count: total })}</div>
        {loading ? (
          <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-600" /></div>
        ) : orders.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-4 text-center">
            <ClipboardCheck className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <h2 className="font-medium">{t("emptyTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("emptyDescription")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {orders.map((order) => (
              <button key={order.id} type="button" onClick={() => void openOrder(order)} className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-muted/50 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium"><Car className="h-4 w-4 text-violet-600" />{order.make} {order.model} {order.year || ""}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">{order.license_plate || order.vin || t("unidentifiedVehicle")}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{order.contact_name || t("unknownCustomer")}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">{order.customer_concern}</div>
                </div>
                <div className="text-sm md:text-right">
                  <div>{formatCents(order.final_amount_cents ?? order.estimate_amount_cents, order.currency)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{dateTime.format(new Date(order.updated_at))}</div>
                </div>
                <div className="flex items-center justify-between gap-2 md:justify-end">
                  <StatusBadge status={order.status} label={t(`status.${order.status}`)} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-background p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2"><StatusBadge status={selected.status} label={t(`status.${selected.status}`)} /><span className="text-xs text-muted-foreground">#{selected.id.slice(0, 8)}</span></div>
                <h2 className="mt-2 text-xl font-semibold">{selected.make} {selected.model} {selected.year || ""}</h2>
                <p className="text-sm text-muted-foreground">{selected.license_plate || selected.vin}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label={t("close")} className="rounded-lg p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid gap-4 py-5 sm:grid-cols-2 xl:grid-cols-3">
              <InfoCard title={t("customer")} value={selected.contact_name || t("unknownCustomer")} detail={selected.contact_phone || undefined} />
              <InfoCard title={t("vehicle")} value={`${selected.make} ${selected.model}`} detail={[selected.license_plate, selected.vin, selected.vehicle_mileage_km === null || selected.vehicle_mileage_km === undefined ? null : `${selected.vehicle_mileage_km} km`].filter(Boolean).join(" · ")} />
              <InfoCard title={t("technician")} value={selected.assigned_technician_name || t("noTechnician")} />
            </div>

            <section className="rounded-xl border border-border p-4">
              <h3 className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4 text-violet-600" />{t("reportedConcern")}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">{selected.customer_concern}</p>
              {!!selected.reported_symptoms?.length && <p className="mt-2 text-sm text-muted-foreground">{selected.reported_symptoms.join(" · ")}</p>}
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{t("concernWarning")}</p>
            </section>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <AmountCard title={t("estimate")} amount={formatCents(selected.estimate_amount_cents, selected.currency)} status={t(`approval.${selected.approval_status}`)} />
              <AmountCard title={t("finalTotal")} amount={formatCents(selected.final_amount_cents, selected.currency)} status={selected.diagnosis_summary || t("notAvailable")} />
            </div>

            {canHandleConversations && (
              <div className="mt-5 flex flex-wrap gap-2">
                {["intake", "estimating", "rejected", "awaiting_approval"].includes(selected.status) && (
                  <button type="button" onClick={() => setShowEstimate(true)} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">{t("publishEstimate")}</button>
                )}
                {!["delivered", "cancelled"].includes(selected.status) && (
                  <button type="button" onClick={() => setShowDetails(true)} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">{t("technicalDetails")}</button>
                )}
                {selected.status === "awaiting_approval" && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void recordEstimateDecision(true)} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300">{t("recordApproval")}</button>
                    <button type="button" disabled={busy} onClick={() => void recordEstimateDecision(false)} className="rounded-lg border border-orange-500/30 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-500/10 disabled:opacity-50 dark:text-orange-300">{t("recordRejection")}</button>
                  </>
                )}
                {NEXT_STATUS[selected.status].map((target) => (
                  <button key={target} type="button" disabled={busy} onClick={() => void transition(target)} className={cn("rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50", target === "cancelled" ? "border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-300" : "border-border hover:bg-muted")}>
                    {t(`action.${target}`)}
                  </button>
                ))}
              </div>
            )}

            <section className="mt-6">
              <h3 className="flex items-center gap-2 font-medium"><History className="h-4 w-4 text-violet-600" />{t("history")}</h3>
              <div className="mt-3 space-y-3 border-l border-border pl-4">
                {(selected.events || []).map((event) => (
                  <div key={event.id} className="relative text-sm before:absolute before:-left-[21px] before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:bg-violet-600">
                    <div className="font-medium">{t(`event.${event.event_type}`, { fallback: event.event_type })}</div>
                    <div className="text-xs text-muted-foreground">{dateTime.format(new Date(event.created_at))} · {t(`actor.${event.actor_type}`)}</div>
                  </div>
                ))}
                {!selected.events?.length && <p className="text-sm text-muted-foreground">{t("noHistory")}</p>}
              </div>
            </section>
          </aside>
        </div>
      )}

      {showCreate && activeTenantId && <CreateOrderDialog tenantId={activeTenantId} onClose={() => setShowCreate(false)} onSaved={async (order) => { setShowCreate(false); await load(); await openOrder(order); }} />}
      {showEstimate && selected && activeTenantId && <EstimateDialog tenantId={activeTenantId} order={selected} defaultCurrency={operatingCurrency} onClose={() => setShowEstimate(false)} onSaved={async (order) => { setShowEstimate(false); await load(); await openOrder(order); }} />}
      {showDetails && selected && activeTenantId && <TechnicalDetailsDialog tenantId={activeTenantId} order={selected} onClose={() => setShowDetails(false)} onSaved={async (order) => { setShowDetails(false); await load(); await openOrder(order); }} />}
    </div>
  );
}

function InfoCard({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <div className="rounded-xl border border-border p-4"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div><div className="mt-1 font-medium">{value}</div>{detail && <div className="mt-1 text-sm text-muted-foreground">{detail}</div>}</div>;
}

function AmountCard({ title, amount, status }: { title: string; amount: string; status: string }) {
  return <div className="rounded-xl border border-border p-4"><div className="text-sm text-muted-foreground">{title}</div><div className="mt-1 text-lg font-semibold">{amount}</div><div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{status}</div></div>;
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-semibold">{value}</div><div className="mt-1 text-sm text-muted-foreground">{label}</div></div>;
}

function DialogShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const t = useTranslations("repairOrders");
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} aria-label={t("close")}><X className="h-5 w-5" /></button></div>{children}</div></div>;
}

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

function CreateOrderDialog({ tenantId, onClose, onSaved }: { tenantId: string; onClose: () => void; onSaved: (order: RepairOrder) => void | Promise<void> }) {
  const t = useTranslations("repairOrders");
  const [contacts, setContacts] = useState<Array<{ id: string; label: string }>>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [form, setForm] = useState({ contactId: "", make: "", model: "", year: "", plate: "", vin: "", mileage: "", concern: "", symptoms: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api.getOrderContacts(tenantId, { search: contactSearch || undefined, limit: 50 }).then((response) => {
        if (!response.success || !response.data?.items) return;
        setContacts(response.data.items.map((item: Record<string, unknown>) => ({ id: String(item.id), label: [item.name, item.phone].filter(Boolean).join(" · ") || String(item.id) })));
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [contactSearch, tenantId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.plate.trim() && !form.vin.trim()) { setError(t("vehicleIdentityRequired")); return; }
    setSaving(true);
    const payload: CreateRepairOrderInput = {
      contactId: form.contactId,
      vehicle: {
        make: form.make,
        model: form.model,
        year: form.year ? Number(form.year) : undefined,
        licensePlate: form.plate || undefined,
        vin: form.vin || undefined,
        mileageKm: form.mileage ? Number(form.mileage) : undefined,
      },
      customerConcern: form.concern,
      reportedSymptoms: form.symptoms.split(",").map((value) => value.trim()).filter(Boolean),
    };
    const response = await api.createRepairOrder(tenantId, payload);
    if (response.success && response.data) await onSaved(response.data);
    else setError(response.error || t("saveError"));
    setSaving(false);
  }

  return <DialogShell title={t("newOrder")} onClose={onClose}><form onSubmit={save} className="mt-4 space-y-4">
    {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    <label className="block space-y-1"><span className="text-sm font-medium">{t("contact")}</span><input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder={t("searchContact")} className={inputClass} /><select required value={form.contactId} onChange={(event) => setForm({ ...form, contactId: event.target.value })} className={inputClass}><option value="">{t("selectContact")}</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.label}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2"><Field label={t("make")} required value={form.make} onChange={(make) => setForm({ ...form, make })} /><Field label={t("model")} required value={form.model} onChange={(model) => setForm({ ...form, model })} /><Field label={t("year")} type="number" value={form.year} onChange={(year) => setForm({ ...form, year })} /><Field label={t("mileage")} type="number" value={form.mileage} onChange={(mileage) => setForm({ ...form, mileage })} /><Field label={t("plate")} value={form.plate} onChange={(plate) => setForm({ ...form, plate })} /><Field label={t("vin")} value={form.vin} onChange={(vin) => setForm({ ...form, vin })} /></div>
    <label className="block space-y-1"><span className="text-sm font-medium">{t("reportedConcern")}</span><textarea required value={form.concern} onChange={(event) => setForm({ ...form, concern: event.target.value })} rows={4} className={inputClass} /><span className="text-xs text-muted-foreground">{t("concernWarning")}</span></label>
    <Field label={t("symptoms")} value={form.symptoms} onChange={(symptoms) => setForm({ ...form, symptoms })} placeholder={t("symptomsHint")} />
    <DialogActions saving={saving} onClose={onClose} />
  </form></DialogShell>;
}

function EstimateDialog({ tenantId, order, defaultCurrency, onClose, onSaved }: { tenantId: string; order: RepairOrder; defaultCurrency: string | null; onClose: () => void; onSaved: (order: RepairOrder) => void | Promise<void> }) {
  const t = useTranslations("repairOrders");
  const locale = useLocale();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(order.estimate_amount_cents ? String(order.estimate_amount_cents / 100) : "");
  const [currency, setCurrency] = useState(order.currency || defaultCurrency || "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    const amountCents = Math.round(Number(amount) * 100);
    const response = await api.updateRepairEstimate(tenantId, order.id, { expectedVersion: order.version, amountCents, currency, notes, lineItems: description ? [{ description, quantity: 1, unitAmountCents: amountCents }] : undefined });
    if (response.success && response.data) await onSaved(response.data); else setError(response.error || t("saveError"));
    setSaving(false);
  }
  return <DialogShell title={t("publishEstimate")} onClose={onClose}><form onSubmit={save} className="mt-4 space-y-4">{error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}<p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{t("estimateWarning")}</p><Field label={t("estimateDescription")} required value={description} onChange={setDescription} /><div className="grid grid-cols-[1fr_110px] gap-3"><Field label={t("amount")} type="number" required value={amount} onChange={setAmount} /><Field label={t("currency")} required value={currency} onChange={(value) => setCurrency(value.toUpperCase().slice(0, 3))} /></div>{amount && Number.isFinite(Number(amount)) && <p className="text-sm text-muted-foreground">{formatMajorMoney(Number(amount), currency, { locale })}</p>}<Field label={t("notes")} value={notes} onChange={setNotes} /><DialogActions saving={saving} onClose={onClose} /></form></DialogShell>;
}

function TechnicalDetailsDialog({ tenantId, order, onClose, onSaved }: { tenantId: string; order: RepairOrder; onClose: () => void; onSaved: (order: RepairOrder) => void | Promise<void> }) {
  const t = useTranslations("repairOrders");
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [diagnosis, setDiagnosis] = useState(order.diagnosis_summary || "");
  const [finalAmount, setFinalAmount] = useState(order.final_amount_cents ? String(order.final_amount_cents / 100) : "");
  const [mileage, setMileage] = useState(order.vehicle_mileage_km === null || order.vehicle_mileage_km === undefined ? "" : String(order.vehicle_mileage_km));
  const [promisedAt, setPromisedAt] = useState(order.promised_at ? new Date(order.promised_at).toISOString().slice(0, 16) : "");
  const [technicianId, setTechnicianId] = useState(order.assigned_technician_id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.listStaff(tenantId).then((response) => {
      if (!response.success || !Array.isArray(response.data)) return;
      setStaff(response.data.map((member: Record<string, unknown>) => ({
        id: String(member.id),
        name: String(member.name || member.id),
      })));
    });
  }, [tenantId]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    const response = await api.updateRepairDetails(tenantId, order.id, { expectedVersion: order.version, diagnosisSummary: diagnosis || undefined, finalAmountCents: finalAmount ? Math.round(Number(finalAmount) * 100) : undefined, mileageKm: mileage ? Number(mileage) : undefined, promisedAt: promisedAt ? new Date(promisedAt).toISOString() : undefined, assignedTechnicianId: technicianId || undefined });
    if (response.success && response.data) await onSaved(response.data); else setError(response.error || t("saveError"));
    setSaving(false);
  }
  return <DialogShell title={t("technicalDetails")} onClose={onClose}><form onSubmit={save} className="mt-4 space-y-4">{error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}<label className="block space-y-1"><span className="text-sm font-medium">{t("diagnosis")}</span><textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} rows={4} className={inputClass} /><span className="text-xs text-muted-foreground">{t("diagnosisHumanOnly")}</span></label><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1"><span className="text-sm font-medium">{t("technician")}</span><select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} className={inputClass}><option value="">{t("selectTechnician")}</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><span className="text-xs text-muted-foreground">{t("technicianHint")}</span></label><Field label={t("finalAmount")} type="number" value={finalAmount} onChange={setFinalAmount} /><Field label={t("mileage")} type="number" value={mileage} onChange={setMileage} /><Field label={t("promisedAt")} type="datetime-local" value={promisedAt} onChange={setPromisedAt} /></div><DialogActions saving={saving} onClose={onClose} /></form></DialogShell>;
}

function Field({ label, value, onChange, type = "text", required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="block space-y-1"><span className="text-sm font-medium">{label}</span><input type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} className={inputClass} /></label>;
}

function DialogActions({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  const t = useTranslations("repairOrders");
  return <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">{t("cancel")}</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{t("save")}</button></div>;
}
