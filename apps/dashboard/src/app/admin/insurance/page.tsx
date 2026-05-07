"use client";

/**
 * Insurance dashboard for seguros tenants. 4 tabs: Plans (catalog),
 * Quotes (active sales pipeline), Policies (sold contracts), Claims
 * (post-sale incidents).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ShieldCheck, Plus, Trash2, X, Loader2, Save, FileSignature,
    AlertTriangle, FileText, CheckCircle, Edit2,
} from "lucide-react";

interface Plan {
    id: string;
    name: string;
    description?: string;
    insurance_type: string;
    coverage_level?: string;
    monthly_premium_min?: number;
    monthly_premium_max?: number;
    deductible?: number;
    max_coverage?: number;
    currency: string;
    covers: string[];
    excludes: string[];
    min_age?: number;
    max_age?: number;
    is_active: boolean;
}

interface Quote {
    id: string;
    plan_name?: string;
    insurance_type?: string;
    applicant_name?: string;
    applicant_age?: number;
    monthly_premium?: number;
    annual_premium?: number;
    currency: string;
    valid_until?: string;
    status: string;
    created_at: string;
}

interface Policy {
    id: string;
    policy_number: string;
    policyholder_name: string;
    monthly_premium: number;
    currency: string;
    starts_at: string;
    ends_at?: string;
    next_payment_at?: string;
    status: string;
}

interface Claim {
    id: string;
    claim_number: string;
    policy_id: string;
    incident_type?: string;
    incident_at?: string;
    description?: string;
    claimed_amount?: number;
    approved_amount?: number;
    status: string;
    created_at: string;
}

const INSURANCE_TYPES = ["vida", "salud", "auto", "hogar", "empresarial", "viaje"];
const COVERAGE_LEVELS = ["basico", "medio", "premium"];

type TabId = "plans" | "quotes" | "policies" | "claims";

export default function InsurancePage() {
    const t = useTranslations("insurance");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [tab, setTab] = useState<TabId>("plans");
    const [plans, setPlans] = useState<Plan[]>([]);
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [claims, setClaims] = useState<Claim[]>([]);
    const [loading, setLoading] = useState(true);
    const [showPlanForm, setShowPlanForm] = useState<Plan | "new" | null>(null);

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const [p, q, po, cl] = await Promise.all([
                api.listInsurancePlans(activeTenantId),
                api.listInsuranceQuotes(activeTenantId),
                api.listInsurancePolicies(activeTenantId),
                api.listInsuranceClaims(activeTenantId),
            ]);
            if (p.success) setPlans(p.data || []);
            if (q.success) setQuotes(q.data || []);
            if (po.success) setPolicies(po.data || []);
            if (cl.success) setClaims(cl.data || []);
        } finally { setLoading(false); }
    }

    useEffect(() => { load(); }, [activeTenantId]);

    async function handleDeletePlan(id: string) {
        if (!activeTenantId || !confirm(t("deletePlanConfirm"))) return;
        await api.deleteInsurancePlan(activeTenantId, id);
        load();
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <ShieldCheck className="h-6 w-6 text-blue-600" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                {tab === "plans" && (
                    <button onClick={() => setShowPlanForm("new")} className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                        <Plus className="h-4 w-4" /> {t("addPlan")}
                    </button>
                )}
            </div>

            <div className="flex bg-card border border-border rounded-lg p-0.5 w-fit">
                {([
                    { id: "plans" as const, label: t("plansTab"), icon: ShieldCheck, count: plans.length },
                    { id: "quotes" as const, label: t("quotesTab"), icon: FileSignature, count: quotes.length },
                    { id: "policies" as const, label: t("policiesTab"), icon: FileText, count: policies.length },
                    { id: "claims" as const, label: t("claimsTab"), icon: AlertTriangle, count: claims.length },
                ]).map(tabDef => {
                    const Icon = tabDef.icon;
                    return (
                        <button key={tabDef.id} onClick={() => setTab(tabDef.id)} className={cn(
                            "px-3 py-1.5 text-sm font-medium rounded transition inline-flex items-center gap-1.5",
                            tab === tabDef.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground",
                        )}>
                            <Icon className="h-3.5 w-3.5" />
                            {tabDef.label}
                            <span className="text-xs opacity-70">({tabDef.count})</span>
                        </button>
                    );
                })}
            </div>

            {tab === "plans" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {loading ? (
                        <div className="col-span-full text-center py-12"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
                    ) : plans.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-sm text-muted-foreground">{t("noPlans")}</div>
                    ) : plans.map(plan => (
                        <div key={plan.id} className="bg-card border border-border rounded-xl p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="min-w-0">
                                    <h3 className="font-semibold truncate">{plan.name}</h3>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 font-mono uppercase">{plan.insurance_type}</span>
                                        {plan.coverage_level && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{plan.coverage_level}</span>}
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => setShowPlanForm(plan)} className="p-1.5 hover:bg-muted rounded">
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => handleDeletePlan(plan.id)} className="p-1.5 hover:bg-red-500/10 rounded">
                                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                    </button>
                                </div>
                            </div>
                            {plan.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{plan.description}</p>}
                            <div className="space-y-1 text-xs border-t border-border pt-2">
                                {plan.monthly_premium_min !== null && plan.monthly_premium_max !== null && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("premiumRange")}</span>
                                        <span className="font-mono font-semibold">
                                            {Number(plan.monthly_premium_min).toLocaleString()} - {Number(plan.monthly_premium_max).toLocaleString()}
                                        </span>
                                    </div>
                                )}
                                {plan.max_coverage && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("maxCoverage")}</span>
                                        <span className="font-mono">{Number(plan.max_coverage).toLocaleString()}</span>
                                    </div>
                                )}
                                {plan.deductible !== null && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("deductible")}</span>
                                        <span className="font-mono">{Number(plan.deductible).toLocaleString()}</span>
                                    </div>
                                )}
                                {(plan.min_age || plan.max_age) && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("ageRange")}</span>
                                        <span className="font-mono">{plan.min_age || "—"}-{plan.max_age || "—"}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === "quotes" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("applicant")}</th>
                                <th className="px-4 py-2 font-semibold">{t("plan")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("monthlyPremium")}</th>
                                <th className="px-4 py-2 font-semibold">{t("validUntil")}</th>
                                <th className="px-4 py-2 font-semibold">{t("status")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {quotes.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">{t("noQuotes")}</td></tr>
                            ) : quotes.map(q => (
                                <tr key={q.id} className="hover:bg-muted/20">
                                    <td className="px-4 py-2">
                                        <div className="font-medium">{q.applicant_name || "—"}</div>
                                        {q.applicant_age && <div className="text-xs text-muted-foreground">{q.applicant_age} {t("yearsOld")}</div>}
                                    </td>
                                    <td className="px-4 py-2 text-xs">{q.plan_name}</td>
                                    <td className="px-4 py-2 text-right font-mono">
                                        {q.monthly_premium ? Number(q.monthly_premium).toLocaleString() : "—"} {q.currency}
                                    </td>
                                    <td className="px-4 py-2 text-xs font-mono text-muted-foreground">
                                        {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "—"}
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                                            q.status === "accepted" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                            q.status === "sent" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                                            q.status === "rejected" && "bg-red-500/10 text-red-700 dark:text-red-300",
                                            q.status === "expired" && "bg-neutral-500/10 text-neutral-600",
                                        )}>
                                            {q.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {tab === "policies" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("policyNumber")}</th>
                                <th className="px-4 py-2 font-semibold">{t("policyholder")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("monthlyPremium")}</th>
                                <th className="px-4 py-2 font-semibold">{t("nextPayment")}</th>
                                <th className="px-4 py-2 font-semibold">{t("status")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {policies.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">{t("noPolicies")}</td></tr>
                            ) : policies.map(p => {
                                const overdue = p.next_payment_at && new Date(p.next_payment_at) < new Date();
                                return (
                                    <tr key={p.id} className="hover:bg-muted/20">
                                        <td className="px-4 py-2 font-mono text-xs">{p.policy_number}</td>
                                        <td className="px-4 py-2">{p.policyholder_name}</td>
                                        <td className="px-4 py-2 text-right font-mono">{Number(p.monthly_premium).toLocaleString()} {p.currency}</td>
                                        <td className={cn("px-4 py-2 text-xs font-mono", overdue ? "text-red-600 font-semibold" : "text-muted-foreground")}>
                                            {p.next_payment_at ? new Date(p.next_payment_at).toLocaleDateString() : "—"}
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                                                p.status === "active" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                                p.status === "suspended" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                                p.status === "expired" && "bg-neutral-500/10 text-neutral-600",
                                                p.status === "cancelled" && "bg-red-500/10 text-red-700 dark:text-red-300",
                                            )}>
                                                {p.status}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {tab === "claims" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("claimNumber")}</th>
                                <th className="px-4 py-2 font-semibold">{t("incidentType")}</th>
                                <th className="px-4 py-2 font-semibold">{t("filedAt")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("claimed")}</th>
                                <th className="px-4 py-2 font-semibold">{t("status")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {claims.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">{t("noClaims")}</td></tr>
                            ) : claims.map(c => (
                                <tr key={c.id} className="hover:bg-muted/20">
                                    <td className="px-4 py-2 font-mono text-xs">{c.claim_number}</td>
                                    <td className="px-4 py-2 text-xs">{c.incident_type || "—"}</td>
                                    <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                                    <td className="px-4 py-2 text-right font-mono">{c.claimed_amount ? Number(c.claimed_amount).toLocaleString() : "—"}</td>
                                    <td className="px-4 py-2">
                                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                                            c.status === "approved" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                            c.status === "paid" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                            c.status === "submitted" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                                            c.status === "reviewing" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                            c.status === "rejected" && "bg-red-500/10 text-red-700 dark:text-red-300",
                                        )}>
                                            {c.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showPlanForm && (
                <PlanFormModal plan={showPlanForm === "new" ? null : showPlanForm} onClose={() => setShowPlanForm(null)} onSaved={() => { setShowPlanForm(null); load(); }} />
            )}
        </div>
    );
}

function PlanFormModal({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
    const t = useTranslations("insurance");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState({
        name: plan?.name || "",
        description: plan?.description || "",
        insuranceType: plan?.insurance_type || "vida",
        coverageLevel: plan?.coverage_level || "medio",
        monthlyPremiumMin: plan?.monthly_premium_min?.toString() || "",
        monthlyPremiumMax: plan?.monthly_premium_max?.toString() || "",
        deductible: plan?.deductible?.toString() || "",
        maxCoverage: plan?.max_coverage?.toString() || "",
        currency: plan?.currency || "COP",
        minAge: plan?.min_age?.toString() || "",
        maxAge: plan?.max_age?.toString() || "",
    });
    const [busy, setBusy] = useState(false);

    async function handleSubmit() {
        if (!activeTenantId || !form.name || !form.insuranceType) return;
        setBusy(true);
        const payload = {
            name: form.name,
            description: form.description || undefined,
            insuranceType: form.insuranceType,
            coverageLevel: form.coverageLevel || undefined,
            monthlyPremiumMin: form.monthlyPremiumMin ? parseFloat(form.monthlyPremiumMin) : undefined,
            monthlyPremiumMax: form.monthlyPremiumMax ? parseFloat(form.monthlyPremiumMax) : undefined,
            deductible: form.deductible ? parseFloat(form.deductible) : undefined,
            maxCoverage: form.maxCoverage ? parseFloat(form.maxCoverage) : undefined,
            currency: form.currency,
            minAge: form.minAge ? parseInt(form.minAge, 10) : undefined,
            maxAge: form.maxAge ? parseInt(form.maxAge, 10) : undefined,
        };
        try {
            if (plan) await api.updateInsurancePlan(activeTenantId, plan.id, payload);
            else await api.createInsurancePlan(activeTenantId, payload);
            onSaved();
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 className="text-base font-semibold">{plan ? t("editPlan") : t("newPlan")}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                    <input type="text" placeholder={t("planName")} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <textarea placeholder={t("description")} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                        <select value={form.insuranceType} onChange={e => setForm({ ...form, insuranceType: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                            {INSURANCE_TYPES.map(it => <option key={it} value={it}>{it}</option>)}
                        </select>
                        <select value={form.coverageLevel} onChange={e => setForm({ ...form, coverageLevel: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                            {COVERAGE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs mb-1">{t("premiumMin")}</label>
                            <input type="number" value={form.monthlyPremiumMin} onChange={e => setForm({ ...form, monthlyPremiumMin: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("premiumMax")}</label>
                            <input type="number" value={form.monthlyPremiumMax} onChange={e => setForm({ ...form, monthlyPremiumMax: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("deductible")}</label>
                            <input type="number" value={form.deductible} onChange={e => setForm({ ...form, deductible: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("maxCoverage")}</label>
                            <input type="number" value={form.maxCoverage} onChange={e => setForm({ ...form, maxCoverage: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("minAge")}</label>
                            <input type="number" value={form.minAge} onChange={e => setForm({ ...form, minAge: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("maxAge")}</label>
                            <input type="number" value={form.maxAge} onChange={e => setForm({ ...form, maxAge: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded-lg text-sm">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy || !form.name} className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
