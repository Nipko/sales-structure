"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Receipt, Save, CheckCircle, AlertCircle, AlertTriangle, RefreshCw, FileText, FileCode,
    PlugZap, CheckCircle2, XCircle, RotateCw,
} from "lucide-react";

type FiscalConfig = {
    mode: "CO_LOCAL" | "US_REMOTE";
    coIvaTreatment: "excluido" | "gravado_19";
    fiscalGateEnabled: boolean;
    factusEnvironment: string;
    factusNumberingRangeId: string | null;
    factusCreditNumberingRangeId: string | null;
    defaultUnitMeasureId: string;
    defaultStandardCodeId: string;
    defaultProductTributeId: string;
    defaultMunicipalityId: string | null;
    itemDescription: string;
    itemCodeReference: string;
    usIssuer: { legalName?: string; taxId?: string; address?: string; email?: string };
    coIssuer: {
        legalName?: string; nit?: string; address?: string; email?: string; phone?: string;
        regime?: string; dianResolution?: string; authRange?: string; resolutionValidUntil?: string;
    };
};

type AdminInvoice = {
    id: string; tenantId: string; tenantName?: string; type: string; status: string; provider?: string;
    invoiceNumber?: string | null; cufe?: string | null; amountCents: number; currency: string;
    failureReason?: string | null; issuedAt?: string | null; createdAt: string;
};

export default function FiscalAdminPage() {
    const t = useTranslations("fiscalAdmin");
    const tc = useTranslations("common");
    const { user } = useAuth();
    const router = useRouter();

    const [tab, setTab] = useState<"config" | "invoices" | "factus">("config");
    const [config, setConfig] = useState<FiscalConfig | null>(null);
    const [invoices, setInvoices] = useState<AdminInvoice[]>([]);
    const [statusFilter, setStatusFilter] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    const [confirmUsRemote, setConfirmUsRemote] = useState(false);
    const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
    const [ranges, setRanges] = useState<any[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [testResult, setTestResult] = useState<any>(null);

    useEffect(() => {
        if (user && user.role !== "super_admin") {
            router.push("/admin");
        }
    }, [user, router]);

    const loadConfig = useCallback(async () => {
        const res = await api.getFiscalConfig();
        if (res.success) setConfig(res.data as FiscalConfig);
    }, []);

    const loadInvoices = useCallback(async () => {
        const res = await api.getFiscalAdminInvoices(statusFilter ? { status: statusFilter } : undefined);
        if (res.success) setInvoices((res.data as AdminInvoice[]) || []);
    }, [statusFilter]);

    useEffect(() => { loadConfig(); }, [loadConfig]);
    useEffect(() => { if (tab === "invoices") loadInvoices(); }, [tab, loadInvoices]);

    const doSave = async (cfg: FiscalConfig) => {
        setSaving(true); setError("");
        try {
            const res = await api.updateFiscalConfig(cfg as any);
            if (res.success) { setConfig(res.data as FiscalConfig); setSaved(true); setTimeout(() => setSaved(false), 3000); }
            else setError(res.error || tc("errorSaving"));
        } catch { setError(tc("connectionError")); }
        setSaving(false); setConfirmUsRemote(false);
    };

    const saveConfig = async () => {
        if (!config) return;
        if (config.mode === "US_REMOTE") { setConfirmUsRemote(true); return; }
        await doSave(config);
    };

    const retry = async (id: string) => {
        setBusy(true);
        const res = await api.retryFiscalInvoice(id);
        if (!res.success) setError(res.error || tc("errorSaving"));
        await loadInvoices();
        setBusy(false);
    };

    const reissue = async (inv: AdminInvoice) => {
        if (!window.confirm(t("reissueConfirm"))) return;
        setBusy(true); setError("");
        const res = await api.reissueFiscalInvoice(inv.id);
        if (!res.success) setError((res as any).error || tc("errorSaving"));
        await loadInvoices();
        setBusy(false);
    };

    const testFactus = async () => {
        setBusy(true); setHealth(null);
        const res = await api.getFactusHealth();
        if (res.success) setHealth(res.data as any);
        else setHealth({ ok: false, message: res.error || "error" });
        setBusy(false);
    };

    const loadRanges = async () => {
        setBusy(true);
        const res = await api.getFactusNumberingRanges();
        setRanges(res.success ? ((res.data as any[]) || []) : []);
        if (!res.success) setError(res.error || tc("errorSaving"));
        setBusy(false);
    };

    const useRange = async (id: number | string) => {
        if (!config) return;
        await doSave({ ...config, factusNumberingRangeId: String(id) });
    };

    const money = (cents: number, currency: string) =>
        new Intl.NumberFormat("es-CO", { style: "currency", currency: currency || "COP", maximumFractionDigits: 0 }).format(cents / 100);

    const statusBadge = (s: string) => ({
        issued: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        failed: "bg-red-500/10 text-red-600 dark:text-red-400",
        cancelled: "bg-neutral-500/10 text-neutral-500",
    } as Record<string, string>)[s] || "bg-neutral-500/10 text-neutral-500";

    const sel = "h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 cursor-pointer";
    const inp = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500";
    const lbl = "mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300";

    if (user && user.role !== "super_admin") return null;

    return (
        <div className="max-w-5xl space-y-6">
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

            {/* Tabs */}
            <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
                {(["config", "invoices", "factus"] as const).map((k) => (
                    <button key={k} onClick={() => setTab(k)}
                        className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                            tab === k ? "border-teal-500 text-teal-600 dark:text-teal-400" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}>
                        {t(`tabs.${k}`)}
                    </button>
                ))}
            </div>

            {/* ── Config ── */}
            {tab === "config" && config && (
                <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={lbl}>{t("mode")}</label>
                            <select value={config.mode} onChange={(e) => setConfig({ ...config, mode: e.target.value as FiscalConfig["mode"] })} className={cn(sel, "w-full")}>
                                <option value="CO_LOCAL">{t("modeCoLocal")}</option>
                                <option value="US_REMOTE">{t("modeUsRemote")}</option>
                            </select>
                        </div>
                        <div>
                            <label className={lbl}>{t("ivaTreatment")}</label>
                            <select value={config.coIvaTreatment} onChange={(e) => setConfig({ ...config, coIvaTreatment: e.target.value as FiscalConfig["coIvaTreatment"] })} className={cn(sel, "w-full")}>
                                <option value="excluido">{t("ivaExcluido")}</option>
                                <option value="gravado_19">{t("ivaGravado")}</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
                        <div>
                            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("gateEnabled")}</p>
                            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{t("gateEnabledHint")}</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={config.fiscalGateEnabled}
                            onClick={() => setConfig({ ...config, fiscalGateEnabled: !config.fiscalGateEnabled })}
                            className={cn(
                                "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
                                config.fiscalGateEnabled ? "bg-teal-600" : "bg-neutral-300 dark:bg-neutral-600",
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                                    config.fiscalGateEnabled ? "translate-x-[22px]" : "translate-x-0.5",
                                )}
                            />
                        </button>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={lbl}>{t("factusEnvironment")}</label>
                            <select value={config.factusEnvironment} onChange={(e) => setConfig({ ...config, factusEnvironment: e.target.value })} className={cn(sel, "w-full")}>
                                <option value="sandbox">{t("sandbox")}</option>
                                <option value="production">{t("production")}</option>
                            </select>
                        </div>
                        <div><label className={lbl}>{t("numberingRangeId")}</label><input value={config.factusNumberingRangeId || ""} onChange={(e) => setConfig({ ...config, factusNumberingRangeId: e.target.value })} className={inp} placeholder="8" /></div>
                        <div><label className={lbl}>{t("creditNumberingRangeId")}</label><input value={config.factusCreditNumberingRangeId || ""} onChange={(e) => setConfig({ ...config, factusCreditNumberingRangeId: e.target.value })} className={inp} placeholder="5" /></div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div><label className={lbl}>{t("itemDescription")}</label><input value={config.itemDescription} onChange={(e) => setConfig({ ...config, itemDescription: e.target.value })} className={inp} /></div>
                        <div><label className={lbl}>{t("itemCodeReference")}</label><input value={config.itemCodeReference} onChange={(e) => setConfig({ ...config, itemCodeReference: e.target.value })} className={inp} /></div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        <div><label className={lbl}>{t("unitMeasureId")}</label><input value={config.defaultUnitMeasureId} onChange={(e) => setConfig({ ...config, defaultUnitMeasureId: e.target.value })} className={inp} /></div>
                        <div><label className={lbl}>{t("standardCodeId")}</label><input value={config.defaultStandardCodeId} onChange={(e) => setConfig({ ...config, defaultStandardCodeId: e.target.value })} className={inp} /></div>
                        <div><label className={lbl}>{t("productTributeId")}</label><input value={config.defaultProductTributeId} onChange={(e) => setConfig({ ...config, defaultProductTributeId: e.target.value })} className={inp} /></div>
                        <div><label className={lbl}>{t("defaultMunicipalityId")}</label><input value={config.defaultMunicipalityId || ""} onChange={(e) => setConfig({ ...config, defaultMunicipalityId: e.target.value })} className={inp} /></div>
                    </div>

                    <div className="rounded-lg border border-teal-200 p-4 dark:border-teal-500/20">
                        <p className="mb-3 text-xs font-medium text-neutral-500">{t("coIssuerTitle")}</p>
                        <div className="grid grid-cols-2 gap-4">
                            <input value={config.coIssuer?.legalName || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, legalName: e.target.value } })} className={inp} placeholder={t("coLegalName")} />
                            <input value={config.coIssuer?.nit || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, nit: e.target.value } })} className={inp} placeholder={t("coNit")} />
                            <input value={config.coIssuer?.address || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, address: e.target.value } })} className={inp} placeholder={t("coAddress")} />
                            <input value={config.coIssuer?.email || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, email: e.target.value } })} className={inp} placeholder={t("coEmail")} />
                            <input value={config.coIssuer?.phone || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, phone: e.target.value } })} className={inp} placeholder={t("coPhone")} />
                            <select value={config.coIssuer?.regime || "Responsable de IVA"} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, regime: e.target.value } })} className={cn(sel, "w-full")}>
                                <option value="Responsable de IVA">{t("regimeResponsable")}</option>
                                <option value="No responsable de IVA">{t("regimeNoResponsable")}</option>
                            </select>
                            <input value={config.coIssuer?.dianResolution || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, dianResolution: e.target.value } })} className={inp} placeholder={t("coDianResolution")} />
                            <input value={config.coIssuer?.authRange || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, authRange: e.target.value } })} className={inp} placeholder={t("coAuthRange")} />
                            <input value={config.coIssuer?.resolutionValidUntil || ""} onChange={(e) => setConfig({ ...config, coIssuer: { ...config.coIssuer, resolutionValidUntil: e.target.value } })} className={inp} placeholder={t("coValidUntil")} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                        <p className="mb-3 text-xs font-medium text-neutral-500">{t("usIssuerTitle")}</p>
                        <div className="grid grid-cols-2 gap-4">
                            <input value={config.usIssuer?.legalName || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, legalName: e.target.value } })} className={inp} placeholder={t("usLegalName")} />
                            <input value={config.usIssuer?.taxId || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, taxId: e.target.value } })} className={inp} placeholder={t("usTaxId")} />
                            <input value={config.usIssuer?.address || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, address: e.target.value } })} className={inp} placeholder={t("usAddress")} />
                            <input value={config.usIssuer?.email || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, email: e.target.value } })} className={inp} placeholder={t("usEmail")} />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button onClick={saveConfig} disabled={saving}
                            className={cn("flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all", saved ? "bg-emerald-500" : "bg-teal-600 hover:bg-teal-700", saving && "opacity-70 cursor-wait")}>
                            {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                            {saving ? tc("saving") : saved ? tc("saved") : tc("saveChanges")}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Invoices ── */}
            {tab === "invoices" && (
                <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="flex items-center justify-between gap-3">
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={sel}>
                            <option value="">{t("allStatuses")}</option>
                            <option value="issued">{t("status.issued")}</option>
                            <option value="pending">{t("status.pending")}</option>
                            <option value="failed">{t("status.failed")}</option>
                            <option value="cancelled">{t("status.cancelled")}</option>
                        </select>
                        <button onClick={loadInvoices} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"><RefreshCw size={14} /> {t("refresh")}</button>
                    </div>
                    {invoices.length === 0 ? (
                        <p className="text-sm text-neutral-500">{t("noInvoices")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                                        <th className="py-2 pr-3 font-medium">{t("colTenant")}</th>
                                        <th className="py-2 pr-3 font-medium">{t("colNumber")}</th>
                                        <th className="py-2 pr-3 font-medium">{t("colStatus")}</th>
                                        <th className="py-2 pr-3 font-medium">{t("colAmount")}</th>
                                        <th className="py-2 pr-3 font-medium">{t("colDate")}</th>
                                        <th className="py-2 font-medium">{t("colActions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.map((inv) => (
                                        <tr key={inv.id} className={cn("border-b border-neutral-100 dark:border-neutral-800/60", inv.status === "failed" && "bg-red-500/[0.03]")}>
                                            <td className="py-2.5 pr-3 text-neutral-700 dark:text-neutral-300">{inv.tenantName}</td>
                                            <td className="py-2.5 pr-3 font-mono text-xs">{inv.invoiceNumber || "—"}</td>
                                            <td className="py-2.5 pr-3">
                                                <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", statusBadge(inv.status))}>{t(`status.${inv.status}`)}</span>
                                                {inv.status === "failed" && inv.failureReason && <span className="ml-1 block max-w-[220px] truncate text-[11px] text-red-500" title={inv.failureReason}>{inv.failureReason}</span>}
                                            </td>
                                            <td className="py-2.5 pr-3">{money(inv.amountCents, inv.currency)}</td>
                                            <td className="py-2.5 pr-3 text-neutral-500">{new Date(inv.issuedAt || inv.createdAt).toLocaleDateString("es-CO")}</td>
                                            <td className="py-2.5">
                                                <div className="flex items-center gap-2">
                                                    {inv.status === "issued" && (
                                                        <>
                                                            <button title={t("pdfOfficial")} onClick={() => api.downloadFiscalInvoice(inv.tenantId, inv.id, "pdf", "official")} className="text-indigo-500 hover:text-indigo-700"><FileText size={15} /></button>
                                                            <button title={t("pdfBranded")} onClick={() => api.downloadFiscalInvoice(inv.tenantId, inv.id, "pdf", "branded")} className="text-teal-500 hover:text-teal-700"><Receipt size={15} /></button>
                                                            <button title={t("xml")} onClick={() => api.downloadFiscalInvoice(inv.tenantId, inv.id, "xml")} className="text-neutral-400 hover:text-neutral-700"><FileCode size={15} /></button>
                                                        </>
                                                    )}
                                                    {(inv.status === "failed" || inv.status === "pending") && (
                                                        <button title={t("retry")} disabled={busy} onClick={() => retry(inv.id)} className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 disabled:opacity-50"><RotateCw size={14} /> {t("retry")}</button>
                                                    )}
                                                    {inv.provider === "factus" && !inv.cufe && (
                                                        <button title={t("reissueHint")} disabled={busy} onClick={() => reissue(inv)} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"><RefreshCw size={14} /> {t("reissue")}</button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Factus ── */}
            {tab === "factus" && (
                <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="flex items-center gap-3">
                        <button onClick={testFactus} disabled={busy} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"><PlugZap size={16} /> {t("testConnection")}</button>
                        {health && (
                            <span className={cn("flex items-center gap-1 text-sm", health.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                                {health.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {health.message}
                            </span>
                        )}
                    </div>

                    {/* Validación: preview de generación + emisión de prueba */}
                    <div className="rounded-lg border border-teal-200 p-4 dark:border-teal-500/20">
                        <p className="mb-3 text-xs font-medium text-neutral-500">{t("validateTitle")}</p>
                        <div className="flex flex-wrap items-center gap-3">
                            <button onClick={() => api.previewFiscalInvoice()} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                                <FileText size={15} /> {t("previewInvoice")}
                            </button>
                            <button onClick={async () => { setBusy(true); setTestResult(null); const r = await api.testFiscalInvoice(); setTestResult(r); setBusy(false); }} disabled={busy} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                                <Receipt size={15} /> {t("testInvoice")}
                            </button>
                        </div>
                        {testResult && (() => {
                            const d = testResult.data || {};
                            if (testResult.success && d.status === "issued") {
                                return (
                                    <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                                        <div className="font-medium">{t("testOk")} — {d.invoiceNumber} · CUFE {String(d.cufe || "").slice(0, 18)}…</div>
                                        <div className="mt-3 flex flex-wrap items-start gap-3">
                                            {d.qrPng && <img src={d.qrPng} alt="QR DIAN" width={120} height={120} className="rounded-md border border-emerald-500/20 bg-white p-1" />}
                                            <div className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                                                {d.qrPng && <p>{t("qrScanHint")}</p>}
                                                {d.qrUrl && <a href={d.qrUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-teal-600 underline dark:text-teal-400">{t("qrOpenDian")}</a>}
                                                {d.pdfUrl && <a href={d.pdfUrl} target="_blank" rel="noopener noreferrer" className="block text-indigo-600 underline dark:text-indigo-400">{t("openOfficial")}</a>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            if (d.status === "pending") {
                                return (
                                    <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                                        {t("testPending")}: {d.failureReason || t("testPendingHint")}
                                    </div>
                                );
                            }
                            return (
                                <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                                    {t("testFail")}: {d.failureReason || testResult.message || testResult.error}
                                </div>
                            );
                        })()}
                        <p className="mt-2 text-[11px] text-neutral-400">{t("validateHint")}</p>
                    </div>

                    <div>
                        <button onClick={loadRanges} disabled={busy} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 disabled:opacity-60"><RefreshCw size={15} /> {t("loadRanges")}</button>
                        {ranges && (
                            ranges.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{t("noRanges")}</p> : (
                                <div className="mt-4 overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead><tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                                            <th className="py-2 pr-3 font-medium">ID</th><th className="py-2 pr-3 font-medium">{t("rangeDocument")}</th><th className="py-2 pr-3 font-medium">{t("rangePrefix")}</th><th className="py-2 pr-3 font-medium">{t("rangeRange")}</th><th className="py-2 pr-3 font-medium">{t("rangeActive")}</th><th className="py-2 font-medium"></th>
                                        </tr></thead>
                                        <tbody>
                                            {ranges.map((r: any) => (
                                                <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                                                    <td className="py-2.5 pr-3 font-mono">{r.id}</td>
                                                    <td className="py-2.5 pr-3">{r.document}</td>
                                                    <td className="py-2.5 pr-3">{r.prefix}</td>
                                                    <td className="py-2.5 pr-3 text-neutral-500">{r.from}–{r.to}</td>
                                                    <td className="py-2.5 pr-3">{r.is_active ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-neutral-400" />}</td>
                                                    <td className="py-2.5"><button onClick={() => useRange(r.id)} className="text-xs text-teal-600 hover:underline">{t("useThis")}</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                    </div>
                </div>
            )}

            {/* Confirm US_REMOTE */}
            {confirmUsRemote && config && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmUsRemote(false)}>
                    <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-3 flex items-center gap-2 text-amber-600 dark:text-amber-400"><AlertTriangle size={20} /><h3 className="text-base font-semibold">{t("switchWarningTitle")}</h3></div>
                        <p className="mb-5 text-sm text-neutral-600 dark:text-neutral-300">{t("switchWarningBody")}</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setConfirmUsRemote(false)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">{tc("cancel")}</button>
                            <button onClick={() => doSave(config)} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">{t("switchConfirm")}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
