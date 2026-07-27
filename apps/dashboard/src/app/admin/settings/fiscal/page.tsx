"use client";

import { useTranslations, useLocale } from "next-intl";
import { useState, useEffect, useCallback, useMemo } from "react";
import { SUPPORTED_BILLING_COUNTRIES } from "@parallext/shared";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CO_MUNICIPIOS } from "@/lib/co-municipios";
import { Receipt, Save, CheckCircle, AlertCircle, FileCode, RotateCw, RefreshCw, Loader2 } from "lucide-react";

type FiscalData = {
    consumidorFinal?: boolean;
    documentType: string;
    documentId: string;
    dv?: string;
    legalOrganizationId: string;
    businessName?: string;
    names?: string;
    tributeId?: string;
    address?: string;
    municipalityId?: string;
    daneCode?: string;
    municipalityName?: string;
    email?: string;
    phone?: string;
};

type FiscalInvoice = {
    id: string;
    type: string;
    status: string;
    invoiceNumber?: string | null;
    cufe?: string | null;
    pdfUrl?: string | null;
    amountCents: number;
    currency: string;
    failureReason?: string | null;
    issuedAt?: string | null;
    createdAt: string;
};

const DOC_TYPES = ["6", "3", "5", "7"];

export default function FiscalPage() {
    const t = useTranslations("settings.fiscalPage");
    const tc = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();
    const { user } = useAuth();
    const { activeTenantId } = useTenant();

    const [billingCountry, setBillingCountry] = useState("");
    const [savingCountry, setSavingCountry] = useState(false);
    const [savedCountry, setSavedCountry] = useState(false);

    // Nombres de país en el idioma activo, sin agregar 75 claves × 4 idiomas.
    const countryOptions = useMemo(() => {
        let display: Intl.DisplayNames | null = null;
        try { display = new Intl.DisplayNames([locale], { type: "region" }); } catch { /* sin soporte → código */ }
        return SUPPORTED_BILLING_COUNTRIES
            .map((code) => ({ code, label: display?.of(code) || code }))
            .sort((a, b) => a.label.localeCompare(b.label, locale));
    }, [locale]);

    const [data, setData] = useState<FiscalData>({
        documentType: "6", documentId: "", dv: "", legalOrganizationId: "1",
        businessName: "", names: "", tributeId: "21", address: "",
        municipalityId: "", daneCode: "", email: "", phone: "",
    });
    const [invoices, setInvoices] = useState<FiscalInvoice[]>([]);
    const [savingData, setSavingData] = useState(false);
    const [savedData, setSavedData] = useState(false);
    const [busy, setBusy] = useState(false);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [error, setError] = useState("");

    const tenantId = activeTenantId || user?.tenantId;

    const muniByCode = useMemo(() => {
        const map: Record<string, { n: string; d: string }> = {};
        for (const g of CO_MUNICIPIOS) for (const m of g.m) map[m.c] = { n: m.n, d: g.d };
        return map;
    }, []);

    const load = useCallback(async () => {
        if (!tenantId) return;
        try {
            const [dRes, iRes] = await Promise.all([api.getFiscalData(tenantId), api.getFiscalInvoices(tenantId)]);
            if (dRes.success && (dRes.data as any)?.fiscalData) setData((prev) => ({ ...prev, ...(dRes.data as any).fiscalData }));
            if (dRes.success) setBillingCountry(((dRes.data as any)?.billingCountry as string) || "");
            if (iRes.success) setInvoices((iRes.data as FiscalInvoice[]) || []);
        } catch {
            setError(tc("connectionError"));
        }
    }, [tenantId, tc]);

    const loadInvoices = useCallback(async () => {
        if (!tenantId) return;
        const iRes = await api.getFiscalInvoices(tenantId);
        if (iRes.success) setInvoices((iRes.data as FiscalInvoice[]) || []);
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const saveData = async () => {
        if (!tenantId) return;
        setSavingData(true); setError("");
        try {
            const payload: Record<string, any> = { ...data };
            Object.keys(payload).forEach((k) => { if (payload[k] === "" || payload[k] == null) delete payload[k]; });
            // The "consumidor final" toggle was removed — this form only captures a
            // REAL tax profile now. Force it off so a tenant that previously opted
            // into consumidor final can migrate to a real NIT (otherwise the backend
            // keeps treating them as B2C and ignores the NIT they just entered).
            payload.consumidorFinal = false;
            const res = await api.updateFiscalData(tenantId, payload);
            if (res.success) {
                setSavedData(true); setTimeout(() => setSavedData(false), 3000);
                // If billing sent us here mid-checkout to complete the fiscal
                // profile, return and resume the payment (the plan/cycle round-trip
                // through the URL so nothing is lost).
                const params = new URLSearchParams(window.location.search);
                if (params.get("returnTo") === "billing") {
                    const q = new URLSearchParams();
                    const plan = params.get("plan"); if (plan) q.set("resumePlan", plan);
                    const cycle = params.get("cycle"); if (cycle) q.set("cycle", cycle);
                    router.push(`/admin/settings/billing${q.toString() ? `?${q}` : ""}`);
                    return;
                }
            }
            else setError(res.error || tc("errorSaving"));
        } catch { setError(tc("connectionError")); }
        setSavingData(false);
    };

    const saveCountry = async (code: string) => {
        if (!tenantId || !code || code === billingCountry) return;
        const previous = billingCountry;
        setBillingCountry(code);
        setSavingCountry(true); setError("");
        try {
            const res = await api.updateBillingCountry(tenantId, code);
            if (res.success) {
                setSavedCountry(true); setTimeout(() => setSavedCountry(false), 3000);
            } else {
                setBillingCountry(previous);
                setError(res.error || tc("errorSaving"));
            }
        } catch {
            setBillingCountry(previous);
            setError(tc("connectionError"));
        }
        setSavingCountry(false);
    };

    const retry = async (id: string) => {
        if (!tenantId) return;
        setRetryingId(id); setBusy(true); setError("");
        const res = await api.retryTenantFiscalInvoice(tenantId, id);
        if (!res.success) { setError((res as any).error || tc("errorSaving")); setBusy(false); setRetryingId(null); return; }
        // Issuance runs async on the queue (~1-3s against Factus). Poll the list
        // until this invoice leaves "pending" (→ issued or failed), so the row
        // updates in place without needing a manual refresh.
        for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 2500));
            const iRes = await api.getFiscalInvoices(tenantId);
            if (iRes.success) {
                const list = (iRes.data as FiscalInvoice[]) || [];
                setInvoices(list);
                const cur = list.find((v) => v.id === id);
                if (cur && cur.status !== "pending") break;
            }
        }
        setBusy(false); setRetryingId(null);
    };

    const money = (cents: number, currency: string) =>
        new Intl.NumberFormat("es-CO", { style: "currency", currency: currency || "COP", maximumFractionDigits: 0 }).format(cents / 100);

    const statusBadge = (status: string) => ({
        issued: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        failed: "bg-red-500/10 text-red-600 dark:text-red-400",
        cancelled: "bg-neutral-500/10 text-neutral-500",
    } as Record<string, string>)[status] || "bg-neutral-500/10 text-neutral-500";

    const selectClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer transition-colors";
    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";
    const labelClasses = "mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300";

    return (
        <div className="max-w-3xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                    <Receipt size={20} className="text-teal-500" /> {t("title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* País de facturación. Decide si se exige NIT y si la factura DIAN aplica;
                se infería del huso horario en el alta y no había forma de corregirlo. */}
            <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div>
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("billingCountry")}</h2>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("billingCountryHint")}</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={billingCountry}
                        onChange={(e) => saveCountry(e.target.value)}
                        disabled={savingCountry}
                        className={cn(selectClasses, "max-w-xs")}
                    >
                        {!billingCountry && <option value="">—</option>}
                        {countryOptions.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                    {savingCountry && <Loader2 size={16} className="animate-spin text-neutral-400" />}
                    {savedCountry && (
                        <span className="flex items-center gap-1.5 text-[13px] text-emerald-600 dark:text-emerald-400">
                            <CheckCircle size={14} /> {tc("saved")}
                        </span>
                    )}
                </div>
            </section>

            {/* Acquirer fiscal data */}
            <section className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div>
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("dataTitle")}</h2>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("dataSubtitle")}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClasses}>{t("legalOrganization")}</label>
                        <select value={data.legalOrganizationId} onChange={(e) => setData({ ...data, legalOrganizationId: e.target.value })} className={selectClasses}>
                            <option value="1">{t("personaJuridica")}</option>
                            <option value="2">{t("personaNatural")}</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelClasses}>{t("documentType")}</label>
                        <select value={data.documentType} onChange={(e) => setData({ ...data, documentType: e.target.value })} className={selectClasses}>
                            {DOC_TYPES.map((d) => <option key={d} value={d}>{t(`docType.${d}`)}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                        <label className={labelClasses}>{t("documentId")}</label>
                        <input value={data.documentId} onChange={(e) => setData({ ...data, documentId: e.target.value })} className={inputClasses} placeholder="901234567" />
                    </div>
                    {data.documentType === "6" && (
                        <div>
                            <label className={labelClasses}>{t("dv")}</label>
                            <input value={data.dv || ""} onChange={(e) => setData({ ...data, dv: e.target.value })} className={inputClasses} placeholder="auto" />
                        </div>
                    )}
                </div>

                {data.legalOrganizationId === "1" ? (
                    <div>
                        <label className={labelClasses}>{t("businessName")}</label>
                        <input value={data.businessName || ""} onChange={(e) => setData({ ...data, businessName: e.target.value })} className={inputClasses} />
                    </div>
                ) : (
                    <div>
                        <label className={labelClasses}>{t("names")}</label>
                        <input value={data.names || ""} onChange={(e) => setData({ ...data, names: e.target.value })} className={inputClasses} />
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClasses}>{t("taxResponsibility")}</label>
                        <select value={data.tributeId || "21"} onChange={(e) => setData({ ...data, tributeId: e.target.value })} className={selectClasses}>
                            <option value="18">{t("responsableIva")}</option>
                            <option value="21">{t("noResponsableIva")}</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelClasses}>{t("email")}</label>
                        <input value={data.email || ""} onChange={(e) => setData({ ...data, email: e.target.value })} className={inputClasses} type="email" />
                    </div>
                </div>

                <div>
                    <label className={labelClasses}>{t("address")}</label>
                    <input value={data.address || ""} onChange={(e) => setData({ ...data, address: e.target.value })} className={inputClasses} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                        <label className={labelClasses}>{t("municipality")}</label>
                        <select
                            value={data.daneCode || ""}
                            onChange={(e) => { const code = e.target.value; setData({ ...data, daneCode: code, municipalityName: muniByCode[code]?.n }); }}
                            className={selectClasses}
                        >
                            <option value="">{t("municipalitySelect")}</option>
                            {CO_MUNICIPIOS.map((g) => (
                                <optgroup key={g.d} label={g.d}>
                                    {g.m.map((m) => <option key={m.c} value={m.c}>{m.n}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClasses}>{t("phone")}</label>
                        <input value={data.phone || ""} onChange={(e) => setData({ ...data, phone: e.target.value })} className={inputClasses} />
                    </div>
                </div>

                <div className="flex justify-end">
                    <button onClick={saveData} disabled={savingData}
                        className={cn("flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
                            savedData ? "bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-700", savingData && "opacity-70 cursor-wait")}>
                        {savedData ? <CheckCircle size={16} /> : <Save size={16} />}
                        {savingData ? tc("saving") : savedData ? tc("saved") : tc("saveChanges")}
                    </button>
                </div>
            </section>

            {/* Issued invoices */}
            <section className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("invoicesTitle")}</h2>
                    <button onClick={loadInvoices} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-800 disabled:opacity-50 dark:hover:text-neutral-200">
                        <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> {t("refresh")}
                    </button>
                </div>
                {invoices.length === 0 ? (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noInvoices")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                                    <th className="py-2 pr-4 font-medium">{t("colNumber")}</th>
                                    <th className="py-2 pr-4 font-medium">{t("colType")}</th>
                                    <th className="py-2 pr-4 font-medium">{t("colStatus")}</th>
                                    <th className="py-2 pr-4 font-medium">{t("colAmount")}</th>
                                    <th className="py-2 pr-4 font-medium">{t("colDate")}</th>
                                    <th className="py-2 font-medium">{t("colPdf")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv) => (
                                    <tr key={inv.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                                        <td className="py-2.5 pr-4 font-mono text-xs text-neutral-700 dark:text-neutral-300">{inv.invoiceNumber || "—"}</td>
                                        <td className="py-2.5 pr-4 text-neutral-600 dark:text-neutral-400">{t(inv.type === "credit_note" ? "typeCreditNote" : "typeInvoice")}</td>
                                        <td className="py-2.5 pr-4">
                                            <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", statusBadge(inv.status))}>{t(`status.${inv.status}`)}</span>
                                            {inv.status === "failed" && inv.failureReason && (
                                                <span className="ml-1 block max-w-[200px] truncate text-[11px] text-red-500" title={inv.failureReason}>{inv.failureReason}</span>
                                            )}
                                        </td>
                                        <td className="py-2.5 pr-4 text-neutral-700 dark:text-neutral-300">{money(inv.amountCents, inv.currency)}</td>
                                        <td className="py-2.5 pr-4 text-neutral-500">{new Date(inv.issuedAt || inv.createdAt).toLocaleDateString("es-CO")}</td>
                                        <td className="py-2.5">
                                            {retryingId === inv.id ? (
                                                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                                                    <Loader2 size={13} className="animate-spin" /> {t("processing")}
                                                </span>
                                            ) : inv.status === "issued" && tenantId ? (
                                                <div className="flex items-center gap-3">
                                                    <button title={t("pdfBranded")} onClick={() => api.downloadFiscalInvoice(tenantId, inv.id, "pdf", "branded")} className="inline-flex items-center gap-1 text-teal-500 hover:underline">
                                                        <Receipt size={14} /> PDF
                                                    </button>
                                                    <button title={t("xml")} onClick={() => api.downloadFiscalInvoice(tenantId, inv.id, "xml")} className="inline-flex items-center gap-1 text-neutral-400 hover:text-neutral-700">
                                                        <FileCode size={14} />
                                                    </button>
                                                </div>
                                            ) : (inv.status === "failed" || inv.status === "pending") ? (
                                                <button title={t("retry")} disabled={busy} onClick={() => retry(inv.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20">
                                                    <RotateCw size={13} /> {t("retry")}
                                                </button>
                                            ) : "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
