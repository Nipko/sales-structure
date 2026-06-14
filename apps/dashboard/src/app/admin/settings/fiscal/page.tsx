"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Receipt, Save, CheckCircle, AlertCircle, AlertTriangle, FileText, ExternalLink, ShieldAlert,
} from "lucide-react";

type FiscalData = {
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
    email?: string;
    phone?: string;
};

type FiscalInvoice = {
    id: string;
    type: string;
    status: string;
    invoiceNumber?: string | null;
    cufe?: string | null;
    qrUrl?: string | null;
    pdfUrl?: string | null;
    amountCents: number;
    currency: string;
    taxCents: number;
    failureReason?: string | null;
    issuedAt?: string | null;
    createdAt: string;
};

type FiscalConfig = {
    mode: "CO_LOCAL" | "US_REMOTE";
    coIvaTreatment: "excluido" | "gravado_19";
    factusEnvironment: string;
    factusNumberingRangeId: string | null;
    factusCreditNumberingRangeId: string | null;
    defaultUnitMeasureId: string;
    defaultStandardCodeId: string;
    defaultProductTributeId: string;
    defaultMunicipalityId: string | null;
    usIssuer: { legalName?: string; taxId?: string; address?: string; email?: string };
};

const DOC_TYPES = ["6", "3", "5", "7"]; // NIT, CC, CE, Pasaporte (Factus identification_document_id)

export default function FiscalPage() {
    const t = useTranslations("settings.fiscalPage");
    const tc = useTranslations("common");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const isSuperAdmin = user?.role === "super_admin";

    const [data, setData] = useState<FiscalData>({
        documentType: "6", documentId: "", dv: "", legalOrganizationId: "1",
        businessName: "", names: "", tributeId: "21", address: "",
        municipalityId: "", daneCode: "", email: "", phone: "",
    });
    const [invoices, setInvoices] = useState<FiscalInvoice[]>([]);
    const [config, setConfig] = useState<FiscalConfig | null>(null);
    const [savingData, setSavingData] = useState(false);
    const [savedData, setSavedData] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [savedConfig, setSavedConfig] = useState(false);
    const [error, setError] = useState("");
    const [confirmUsRemote, setConfirmUsRemote] = useState(false);

    const tenantId = activeTenantId || user?.tenantId;

    const load = useCallback(async () => {
        if (!tenantId) return;
        try {
            const [dRes, iRes] = await Promise.all([
                api.getFiscalData(tenantId),
                api.getFiscalInvoices(tenantId),
            ]);
            if (dRes.success && (dRes.data as any)?.fiscalData) {
                setData((prev) => ({ ...prev, ...(dRes.data as any).fiscalData }));
            }
            if (iRes.success) setInvoices((iRes.data as FiscalInvoice[]) || []);
            if (isSuperAdmin) {
                const cRes = await api.getFiscalConfig();
                if (cRes.success) setConfig(cRes.data as FiscalConfig);
            }
        } catch {
            setError(tc("connectionError"));
        }
    }, [tenantId, isSuperAdmin, tc]);

    useEffect(() => { load(); }, [load]);

    const saveData = async () => {
        if (!tenantId) return;
        setSavingData(true);
        setError("");
        try {
            const payload: Record<string, any> = { ...data };
            // drop empty optionals so backend validators are happy
            Object.keys(payload).forEach((k) => { if (payload[k] === "" || payload[k] == null) delete payload[k]; });
            const res = await api.updateFiscalData(tenantId, payload);
            if (res.success) {
                setSavedData(true);
                setTimeout(() => setSavedData(false), 3000);
            } else {
                setError(res.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("connectionError"));
        }
        setSavingData(false);
    };

    const doSaveConfig = async (cfg: FiscalConfig) => {
        setSavingConfig(true);
        setError("");
        try {
            const res = await api.updateFiscalConfig(cfg as any);
            if (res.success) {
                setConfig(res.data as FiscalConfig);
                setSavedConfig(true);
                setTimeout(() => setSavedConfig(false), 3000);
            } else {
                setError(res.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("connectionError"));
        }
        setSavingConfig(false);
        setConfirmUsRemote(false);
    };

    const saveConfig = async () => {
        if (!config) return;
        // Switching to US_REMOTE turns off DIAN FEV — confirm first.
        if (config.mode === "US_REMOTE") {
            setConfirmUsRemote(true);
            return;
        }
        await doSaveConfig(config);
    };

    const money = (cents: number, currency: string) =>
        new Intl.NumberFormat("es-CO", { style: "currency", currency: currency || "COP", maximumFractionDigits: 0 }).format(cents / 100);

    const statusBadge = (status: string) => {
        const map: Record<string, string> = {
            issued: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            failed: "bg-red-500/10 text-red-600 dark:text-red-400",
            cancelled: "bg-neutral-500/10 text-neutral-500",
        };
        return map[status] || map.cancelled;
    };

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

            {/* ── Acquirer fiscal data ─────────────────────────────── */}
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
                    <div>
                        <label className={labelClasses}>{t("municipalityId")}</label>
                        <input value={data.municipalityId || ""} onChange={(e) => setData({ ...data, municipalityId: e.target.value })} className={inputClasses} placeholder="980" />
                    </div>
                    <div>
                        <label className={labelClasses}>{t("daneCode")}</label>
                        <input value={data.daneCode || ""} onChange={(e) => setData({ ...data, daneCode: e.target.value })} className={inputClasses} placeholder="11001" />
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

            {/* ── Issued invoices ──────────────────────────────────── */}
            <section className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("invoicesTitle")}</h2>
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
                                            {inv.pdfUrl ? (
                                                <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-500 hover:underline">
                                                    <FileText size={14} /> {t("viewPdf")}
                                                </a>
                                            ) : "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ── Super admin: platform fiscal config ──────────────── */}
            {isSuperAdmin && config && (
                <section className="space-y-5 rounded-xl border border-teal-200 bg-teal-50/40 p-6 dark:border-teal-500/20 dark:bg-teal-500/5">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={16} className="text-teal-600 dark:text-teal-400" />
                        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("adminTitle")}</h2>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("adminSubtitle")}</p>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelClasses}>{t("mode")}</label>
                            <select value={config.mode} onChange={(e) => setConfig({ ...config, mode: e.target.value as FiscalConfig["mode"] })} className={selectClasses}>
                                <option value="CO_LOCAL">{t("modeCoLocal")}</option>
                                <option value="US_REMOTE">{t("modeUsRemote")}</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>{t("ivaTreatment")}</label>
                            <select value={config.coIvaTreatment} onChange={(e) => setConfig({ ...config, coIvaTreatment: e.target.value as FiscalConfig["coIvaTreatment"] })} className={selectClasses}>
                                <option value="excluido">{t("ivaExcluido")}</option>
                                <option value="gravado_19">{t("ivaGravado")}</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={labelClasses}>{t("factusEnvironment")}</label>
                            <select value={config.factusEnvironment} onChange={(e) => setConfig({ ...config, factusEnvironment: e.target.value })} className={selectClasses}>
                                <option value="sandbox">{t("sandbox")}</option>
                                <option value="production">{t("production")}</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>{t("numberingRangeId")}</label>
                            <input value={config.factusNumberingRangeId || ""} onChange={(e) => setConfig({ ...config, factusNumberingRangeId: e.target.value })} className={inputClasses} placeholder="8" />
                        </div>
                        <div>
                            <label className={labelClasses}>{t("creditNumberingRangeId")}</label>
                            <input value={config.factusCreditNumberingRangeId || ""} onChange={(e) => setConfig({ ...config, factusCreditNumberingRangeId: e.target.value })} className={inputClasses} placeholder="5" />
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        <div>
                            <label className={labelClasses}>{t("unitMeasureId")}</label>
                            <input value={config.defaultUnitMeasureId} onChange={(e) => setConfig({ ...config, defaultUnitMeasureId: e.target.value })} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>{t("standardCodeId")}</label>
                            <input value={config.defaultStandardCodeId} onChange={(e) => setConfig({ ...config, defaultStandardCodeId: e.target.value })} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>{t("productTributeId")}</label>
                            <input value={config.defaultProductTributeId} onChange={(e) => setConfig({ ...config, defaultProductTributeId: e.target.value })} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>{t("defaultMunicipalityId")}</label>
                            <input value={config.defaultMunicipalityId || ""} onChange={(e) => setConfig({ ...config, defaultMunicipalityId: e.target.value })} className={inputClasses} />
                        </div>
                    </div>

                    {/* US issuer (only relevant for US_REMOTE) */}
                    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                        <p className="mb-3 text-xs font-medium text-neutral-500">{t("usIssuerTitle")}</p>
                        <div className="grid grid-cols-2 gap-4">
                            <input value={config.usIssuer?.legalName || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, legalName: e.target.value } })} className={inputClasses} placeholder={t("usLegalName")} />
                            <input value={config.usIssuer?.taxId || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, taxId: e.target.value } })} className={inputClasses} placeholder={t("usTaxId")} />
                            <input value={config.usIssuer?.address || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, address: e.target.value } })} className={inputClasses} placeholder={t("usAddress")} />
                            <input value={config.usIssuer?.email || ""} onChange={(e) => setConfig({ ...config, usIssuer: { ...config.usIssuer, email: e.target.value } })} className={inputClasses} placeholder={t("usEmail")} />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button onClick={saveConfig} disabled={savingConfig}
                            className={cn("flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
                                savedConfig ? "bg-emerald-500" : "bg-teal-600 hover:bg-teal-700", savingConfig && "opacity-70 cursor-wait")}>
                            {savedConfig ? <CheckCircle size={16} /> : <Save size={16} />}
                            {savingConfig ? tc("saving") : savedConfig ? tc("saved") : t("saveConfig")}
                        </button>
                    </div>
                </section>
            )}

            {/* Confirmation modal: switching to US_REMOTE disables DIAN FEV */}
            {confirmUsRemote && config && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmUsRemote(false)}>
                    <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-3 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                            <AlertTriangle size={20} /> <h3 className="text-base font-semibold">{t("switchWarningTitle")}</h3>
                        </div>
                        <p className="mb-5 text-sm text-neutral-600 dark:text-neutral-300">{t("switchWarningBody")}</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setConfirmUsRemote(false)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                                {tc("cancel")}
                            </button>
                            <button onClick={() => doSaveConfig(config)} disabled={savingConfig} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">
                                {t("switchConfirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
