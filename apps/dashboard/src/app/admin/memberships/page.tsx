"use client";

/**
 * Membership management for gym tenants. Two tabs: Plans (catalog
 * editor) and Members (active member roster with freeze/unfreeze
 * actions). Aimed at the operator who needs to bring a member back
 * from a vacation freeze, change a plan, or handle renewals.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Dumbbell, Users, Plus, Trash2, Edit2, X, Loader2, Save, Pause, Play,
    AlertTriangle, CheckCircle, Calendar, CalendarDays, Search, Snowflake, Repeat,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface Plan {
    id: string;
    name: string;
    description?: string;
    duration_days: number;
    price: number;
    currency: string;
    class_credits_per_period?: number;
    personal_training_credits: number;
    guest_passes: number;
    freeze_allowance_days: number;
    perks: string[];
    is_active: boolean;
}

interface Member {
    id: string;
    contact_id: string;
    contact_name?: string;
    contact_phone?: string;
    plan_id?: string;
    plan_name?: string;
    member_number?: string;
    joined_at?: string;
    current_period_start?: string;
    current_period_end?: string;
    frozen_from?: string;
    frozen_until?: string;
    class_credits_remaining?: number;
    status: string;
}

type TabId = "plans" | "members" | "classes";

export default function MembershipsPage() {
    const t = useTranslations("memberships");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [tab, setTab] = useState<TabId>("plans");
    const [plans, setPlans] = useState<Plan[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showPlanForm, setShowPlanForm] = useState<Plan | "new" | null>(null);
    const [showFreeze, setShowFreeze] = useState<Member | null>(null);
    // Clases. `createGymClass` existía en el cliente HTTP con 0 llamadores: el
    // dueño no podía crear NI UNA clase, así que get_class_schedule devolvía
    // vacío y book_class no tenía nada que reservar. Mismo patrón que el alta de
    // miembros.
    const [classes, setClasses] = useState<any[]>([]);
    const [showClassForm, setShowClassForm] = useState(false);
    // Alta de miembro. Sin esto el módulo entero era inalcanzable: book_class y
    // get_my_membership respondían "no es miembro" al 100% de los clientes
    // porque no existía ninguna forma de crear el primero.
    const [showNewMember, setShowNewMember] = useState(false);
    const [contacts, setContacts] = useState<any[]>([]);
    const [newMember, setNewMember] = useState<{ contactId: string; planId: string; memberNumber: string }>({ contactId: "", planId: "", memberNumber: "" });
    const [savingMember, setSavingMember] = useState(false);
    const [memberError, setMemberError] = useState("");

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const [plansRes, membersRes, classesRes] = await Promise.all([
                api.listMembershipPlans(activeTenantId),
                api.listGymMembers(activeTenantId, { search }),
                api.listFitnessClasses(activeTenantId, { from: new Date().toISOString().slice(0, 10) }).catch(() => null),
            ]);
            if (plansRes.success) setPlans(plansRes.data || []);
            if (membersRes.success) setMembers(membersRes.data || []);
            if (classesRes?.success) setClasses(classesRes.data || []);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, [activeTenantId, search]);

    async function handleDeletePlan(id: string) {
        if (!activeTenantId) return;
        if (!confirm(t("deletePlanConfirm"))) return;
        await api.deleteMembershipPlan(activeTenantId, id);
        load();
    }

    async function openNewMember() {
        setMemberError("");
        setNewMember({ contactId: "", planId: "", memberNumber: "" });
        setShowNewMember(true);
        if (!activeTenantId || contacts.length) return;
        const res = await api.getOrderContacts(activeTenantId).catch(() => null);
        if (res?.success && Array.isArray(res.data)) setContacts(res.data);
    }

    async function handleCreateMember() {
        if (!activeTenantId || !newMember.contactId) return;
        setSavingMember(true);
        setMemberError("");
        const res = await api.createGymMember(activeTenantId, {
            contactId: newMember.contactId,
            planId: newMember.planId || undefined,
            memberNumber: newMember.memberNumber || undefined,
        }).catch(() => ({ success: false, error: tc("connectionError") } as any));
        setSavingMember(false);
        if (!res?.success) {
            setMemberError((res as any)?.error || tc("errorSaving"));
            return;
        }
        setShowNewMember(false);
        load();
    }

    async function handleCancelClass(klass: any) {
        if (!activeTenantId) return;
        // Cancelar una clase deja sin lugar a quienes ya reservaron, así que se
        // confirma diciendo cuántos son.
        if (!confirm(t("cancelClassConfirm", { booked: klass.max_capacity - klass.available_spots }))) return;
        await api.cancelFitnessClass(activeTenantId, klass.id, "").catch(() => null);
        load();
    }

    async function handleUnfreeze(member: Member) {
        if (!activeTenantId) return;
        await api.unfreezeGymMember(activeTenantId, member.id);
        load();
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Dumbbell className="h-6 w-6 text-emerald-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                {tab === "plans" && (
                    <button
                        onClick={() => setShowPlanForm("new")}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" /> {t("addPlan")}
                    </button>
                )}
                {tab === "classes" && (
                    <button
                        onClick={() => setShowClassForm(true)}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" /> {t("addClass")}
                    </button>
                )}
            </div>

            <HelpPanel
                title={tHelp("memberships.title")}
                description={tHelp("memberships.description")}
                tips={tHelp.raw("memberships.tips") as string[]}
                mediaKey="memberships"
            />

            <div className="flex bg-card border border-border rounded-lg p-0.5 w-fit">
                {([
                    { id: "plans" as const, label: t("plansTab"), icon: Dumbbell, count: plans.length },
                    { id: "members" as const, label: t("membersTab"), icon: Users, count: members.length },
                    { id: "classes" as const, label: t("classesTab"), icon: CalendarDays, count: classes.length },
                ]).map(tabDef => {
                    const Icon = tabDef.icon;
                    return (
                        <button
                            key={tabDef.id}
                            onClick={() => setTab(tabDef.id)}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded transition inline-flex items-center gap-1.5",
                                tab === tabDef.id ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            {tabDef.label}
                            <span className="text-xs opacity-70">({tabDef.count})</span>
                        </button>
                    );
                })}
            </div>

            {tab === "plans" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {loading ? (
                        <>
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="skeleton h-32 w-full rounded-xl" />
                            ))}
                        </>
                    ) : plans.length === 0 ? (
                        <div className="col-span-full text-center text-muted-foreground py-12 text-sm">
                            {t("noPlans")}
                        </div>
                    ) : plans.map(plan => (
                        <div key={plan.id} className="bg-card border border-border rounded-xl p-4">
                            <div className="flex items-start justify-between gap-2 mb-3">
                                <div>
                                    <h3 className="font-semibold">{plan.name}</h3>
                                    <p className="text-xs text-muted-foreground">{plan.duration_days} {t("days")}</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-xl font-bold font-mono">{Number(plan.price).toLocaleString()}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{plan.currency}</div>
                                </div>
                            </div>
                            {plan.description && <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>}
                            <div className="space-y-1 text-xs border-t border-border pt-3 mb-3">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("classCredits")}</span>
                                    <span className="font-mono">{plan.class_credits_per_period ?? "∞"}</span>
                                </div>
                                {plan.personal_training_credits > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("ptCredits")}</span>
                                        <span className="font-mono">{plan.personal_training_credits}</span>
                                    </div>
                                )}
                                {plan.guest_passes > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{t("guestPasses")}</span>
                                        <span className="font-mono">{plan.guest_passes}</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("freezeAllowance")}</span>
                                    <span className="font-mono">{plan.freeze_allowance_days}d</span>
                                </div>
                            </div>
                            <div className="flex gap-1 justify-end">
                                <button onClick={() => setShowPlanForm(plan)} className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors">
                                    <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => handleDeletePlan(plan.id)} className="p-1.5 hover:bg-red-500/10 rounded">
                                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === "members" && (
                <>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative max-w-sm flex-1 min-w-[200px]">
                            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder={t("searchMembers")}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm"
                            />
                        </div>
                        <button
                            onClick={openNewMember}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
                        >
                            <Plus className="h-4 w-4" /> {t("newMember")}
                        </button>
                    </div>
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                                <tr className="text-left">
                                    <th className="px-4 py-2 font-semibold">{t("memberName")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("plan")}</th>
                                    <th className="px-4 py-2 font-semibold">{t("status")}</th>
                                    <th className="px-4 py-2 font-semibold text-right">{t("expires")}</th>
                                    <th className="px-4 py-2 font-semibold text-right">{t("credits")}</th>
                                    <th className="px-4 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading && members.length === 0 ? (
                                    <>
                                        {Array.from({ length: 4 }).map((_, i) => (
                                            <tr key={i}>
                                                <td colSpan={6} className="px-4 py-2">
                                                    <div className="skeleton h-10 w-full rounded-md" />
                                                </td>
                                            </tr>
                                        ))}
                                    </>
                                ) : members.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">{t("noMembers")}</td></tr>
                                ) : members.map(m => {
                                    const expiringSoon = m.current_period_end
                                        ? new Date(m.current_period_end).getTime() - Date.now() < 7 * 86400000
                                        : false;
                                    return (
                                        <tr key={m.id} className="hover:bg-muted/20">
                                            <td className="px-4 py-2">
                                                <div className="font-medium">
                                                    <Link href={`/admin/contacts/${m.contact_id}`} className="hover:text-emerald-600">
                                                        {m.contact_name || "—"}
                                                    </Link>
                                                </div>
                                                <div className="text-xs text-muted-foreground font-mono">{m.member_number || m.contact_phone}</div>
                                            </td>
                                            <td className="px-4 py-2 text-sm">{m.plan_name || "—"}</td>
                                            <td className="px-4 py-2">
                                                <span className={cn(
                                                    "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                                                    m.status === "active" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                                    m.status === "frozen" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                                                    m.status === "expired" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                                    m.status === "cancelled" && "bg-red-500/10 text-red-700 dark:text-red-300",
                                                )}>
                                                    {t(`statusLabel.${m.status}` as any)}
                                                </span>
                                            </td>
                                            <td className={cn("px-4 py-2 text-right text-xs font-mono", expiringSoon && m.status === "active" ? "text-amber-600 font-semibold" : "text-muted-foreground")}>
                                                {m.current_period_end ? new Date(m.current_period_end).toLocaleDateString() : "—"}
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-sm">
                                                {m.class_credits_remaining ?? "∞"}
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                {m.status === "active" && (
                                                    <button
                                                        onClick={() => setShowFreeze(m)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded text-xs"
                                                    >
                                                        <Snowflake className="h-3 w-3" /> {t("freeze")}
                                                    </button>
                                                )}
                                                {m.status === "frozen" && (
                                                    <button
                                                        onClick={() => handleUnfreeze(m)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded text-xs"
                                                    >
                                                        <Play className="h-3 w-3" /> {t("unfreeze")}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}


            {tab === "classes" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("className")}</th>
                                <th className="px-4 py-2 font-semibold">{t("classWhen")}</th>
                                <th className="px-4 py-2 font-semibold">{t("instructor")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("spots")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("actions")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {classes.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">{t("noClasses")}</td></tr>
                            ) : classes.map((c: any) => (
                                <tr key={c.id} className={cn("hover:bg-muted/20", c.is_cancelled && "opacity-50")}>
                                    <td className="px-4 py-2">
                                        <div className="font-medium">{c.name}</div>
                                        {c.class_type && <div className="text-xs text-muted-foreground">{c.class_type}</div>}
                                    </td>
                                    <td className="px-4 py-2 text-xs font-mono text-muted-foreground">
                                        {new Date(c.scheduled_at).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-xs">{c.instructor_name || "—"}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">
                                        {/* Cupos libres sobre capacidad: es el dato con el que el
                                            dueño decide abrir otra clase. */}
                                        <span className={cn(c.available_spots === 0 && "text-amber-600 font-semibold")}>
                                            {c.available_spots}
                                        </span>
                                        <span className="text-muted-foreground">/{c.max_capacity}</span>
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        {!c.is_cancelled && (
                                            <button
                                                onClick={() => handleCancelClass(c)}
                                                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                                                title={tc("cancel")}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showPlanForm && (
                <PlanFormModal
                    plan={showPlanForm === "new" ? null : showPlanForm}
                    onClose={() => setShowPlanForm(null)}
                    onSaved={() => { setShowPlanForm(null); load(); }}
                />
            )}

            {showFreeze && (
                <FreezeModal
                    member={showFreeze}
                    onClose={() => setShowFreeze(null)}
                    onFrozen={() => { setShowFreeze(null); load(); }}
                />
            )}

            {showClassForm && (
                <ClassFormModal
                    onClose={() => setShowClassForm(false)}
                    onSaved={() => { setShowClassForm(false); setTab("classes"); load(); }}
                />
            )}

            {showNewMember && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !savingMember && setShowNewMember(false)}>
                    <div className="w-full max-w-md rounded-xl bg-card border border-border p-6 shadow-xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold">{t("newMember")}</h3>
                            <button onClick={() => setShowNewMember(false)} className="p-1 text-muted-foreground hover:text-foreground cursor-pointer">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {memberError && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                                <AlertTriangle className="h-4 w-4 shrink-0" /> {memberError}
                            </div>
                        )}

                        <div className="space-y-3">
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("memberName")}</label>
                                <select
                                    value={newMember.contactId}
                                    onChange={e => setNewMember({ ...newMember, contactId: e.target.value })}
                                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm cursor-pointer"
                                >
                                    <option value="">{tc("select")}</option>
                                    {contacts.map((c: any) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name || c.phone || c.id}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("plan")}</label>
                                <select
                                    value={newMember.planId}
                                    onChange={e => setNewMember({ ...newMember, planId: e.target.value })}
                                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm cursor-pointer"
                                >
                                    {/* Sin plan es válido: el backend crea el miembro y el
                                        dueño le asigna plan después. */}
                                    <option value="">{t("noPlanYet")}</option>
                                    {plans.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("memberNumber")}</label>
                                <input
                                    type="text"
                                    value={newMember.memberNumber}
                                    onChange={e => setNewMember({ ...newMember, memberNumber: e.target.value })}
                                    placeholder={t("memberNumberOptional")}
                                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={() => setShowNewMember(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                                {tc("cancel")}
                            </button>
                            <button
                                onClick={handleCreateMember}
                                disabled={!newMember.contactId || savingMember}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors cursor-pointer"
                            >
                                {savingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {tc("save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function PlanFormModal({
    plan, onClose, onSaved,
}: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
    const t = useTranslations("memberships");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState({
        name: plan?.name || "",
        description: plan?.description || "",
        durationDays: plan?.duration_days?.toString() || "30",
        price: plan?.price?.toString() || "",
        currency: plan?.currency || "COP",
        classCreditsPerPeriod: plan?.class_credits_per_period?.toString() || "",
        personalTrainingCredits: plan?.personal_training_credits?.toString() || "0",
        guestPasses: plan?.guest_passes?.toString() || "0",
        freezeAllowanceDays: plan?.freeze_allowance_days?.toString() || "0",
    });
    const [busy, setBusy] = useState(false);

    async function handleSubmit() {
        if (!activeTenantId || !form.name || !form.durationDays || !form.price) return;
        setBusy(true);
        const payload = {
            name: form.name,
            description: form.description || undefined,
            durationDays: parseInt(form.durationDays, 10),
            price: parseFloat(form.price),
            currency: form.currency,
            classCreditsPerPeriod: form.classCreditsPerPeriod ? parseInt(form.classCreditsPerPeriod, 10) : null,
            personalTrainingCredits: parseInt(form.personalTrainingCredits, 10),
            guestPasses: parseInt(form.guestPasses, 10),
            freezeAllowanceDays: parseInt(form.freezeAllowanceDays, 10),
        };
        try {
            if (plan) await api.updateMembershipPlan(activeTenantId, plan.id, payload);
            else await api.createMembershipPlan(activeTenantId, payload);
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
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("planName")}</label>
                        <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("planDescription")}</label>
                        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("durationDays")}</label>
                            <input type="number" value={form.durationDays} onChange={e => setForm({ ...form, durationDays: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div className="col-span-2">
                            <label className="block text-xs font-medium mb-1">{t("price")}</label>
                            <div className="flex gap-1">
                                <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="flex-1 bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                                <input type="text" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="w-20 bg-card border border-border rounded-lg px-2 py-1.5 text-sm font-mono" />
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("classCreditsPlaceholder")}</label>
                            <input type="number" placeholder={t("emptyForUnlimited")} value={form.classCreditsPerPeriod} onChange={e => setForm({ ...form, classCreditsPerPeriod: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("ptCreditsLabel")}</label>
                            <input type="number" value={form.personalTrainingCredits} onChange={e => setForm({ ...form, personalTrainingCredits: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("guestPassesLabel")}</label>
                            <input type="number" value={form.guestPasses} onChange={e => setForm({ ...form, guestPasses: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium mb-1">{t("freezeAllowanceLabel")}</label>
                            <input type="number" value={form.freezeAllowanceDays} onChange={e => setForm({ ...form, freezeAllowanceDays: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy || !form.name || !form.price || !form.durationDays} className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function FreezeModal({
    member, onClose, onFrozen,
}: { member: Member; onClose: () => void; onFrozen: () => void }) {
    const t = useTranslations("memberships");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [days, setDays] = useState(7);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleFreeze() {
        if (!activeTenantId) return;
        setBusy(true);
        setError(null);
        try {
            const res = await api.freezeGymMember(activeTenantId, member.id, days);
            if (res.success) onFrozen();
            else setError(res.error || tc("connectionError"));
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h3 className="text-base font-semibold flex items-center gap-2">
                            <Snowflake className="h-5 w-5 text-blue-500" />
                            {t("freezeMembership")}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{member.contact_name}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("freezeDays")}</label>
                        <input type="number" min={1} max={180} value={days} onChange={e => setDays(parseInt(e.target.value || "0", 10))} className="w-full bg-card border border-border rounded-lg px-3 py-2" />
                        <p className="text-xs text-muted-foreground mt-1">{t("freezeDaysHelp")}</p>
                    </div>
                    {error && <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleFreeze} disabled={busy || days < 1} className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}
                        {t("freezeNow")}
                    </button>
                </div>
            </div>
        </div>
    );
}


/**
 * Alta de clase con repetición semanal.
 *
 * Una grilla de gimnasio es la MISMA clase todas las semanas. Cargar
 * "Spinning, martes 19:00" una vez por semana y para siempre, por cada clase
 * de la grilla, es la fatiga de carga que mata la adopción del módulo antes de
 * que llegue a servir para algo. Con "repetir N semanas" el dueño arma su
 * grilla una vez por trimestre.
 */
function ClassFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: (count: number) => void }) {
    const t = useTranslations("memberships");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [form, setForm] = useState({
        name: "",
        classType: "",
        instructorName: "",
        date: "",
        time: "",
        durationMinutes: 60,
        maxCapacity: 20,
        room: "",
        creditsRequired: 1,
        repeatWeeks: 8,
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function handleSave() {
        if (!activeTenantId) return;
        if (!form.name.trim() || !form.date || !form.time || !form.maxCapacity) {
            setError(t("classMissingFields"));
            return;
        }
        setBusy(true);
        setError("");
        const res = await api.createFitnessClass(activeTenantId, {
            name: form.name.trim(),
            classType: form.classType.trim() || undefined,
            instructorName: form.instructorName.trim() || undefined,
            scheduledAt: `${form.date}T${form.time}:00`,
            durationMinutes: Number(form.durationMinutes) || 60,
            maxCapacity: Number(form.maxCapacity),
            room: form.room.trim() || undefined,
            creditsRequired: Number(form.creditsRequired) || 1,
            repeatWeeks: Number(form.repeatWeeks) || 1,
        }).catch(() => ({ success: false, error: tc("connectionError") } as any));

        setBusy(false);
        if (!res?.success) {
            setError((res as any)?.error || tc("errorSaving"));
            return;
        }
        onSaved(res.data?.createdCount || 1);
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()}>
            <div className="w-full max-w-md rounded-xl bg-card border border-border p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-emerald-500" />
                        {t("addClass")}
                    </h3>
                    <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground cursor-pointer">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {error && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                        <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                    </div>
                )}

                <div className="space-y-3">
                    <div>
                        <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("className")}</label>
                        <input
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder={t("classNamePlaceholder")}
                            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("classDate")}</label>
                            <input
                                type="date"
                                value={form.date}
                                onChange={e => setForm({ ...form, date: e.target.value })}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("classTime")}</label>
                            <input
                                type="time"
                                value={form.time}
                                onChange={e => setForm({ ...form, time: e.target.value })}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("durationMinutes")}</label>
                            <input
                                type="number" min={5} max={480}
                                value={form.durationMinutes}
                                onChange={e => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("maxCapacity")}</label>
                            <input
                                type="number" min={1} max={500}
                                value={form.maxCapacity}
                                onChange={e => setForm({ ...form, maxCapacity: Number(e.target.value) })}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("instructor")}</label>
                            <input
                                value={form.instructorName}
                                onChange={e => setForm({ ...form, instructorName: e.target.value })}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("creditsRequired")}</label>
                            <input
                                type="number" min={0} max={20}
                                value={form.creditsRequired}
                                onChange={e => setForm({ ...form, creditsRequired: Number(e.target.value) })}
                                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                            />
                        </div>
                    </div>

                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                        <label className="flex items-center gap-2 text-[13px] font-medium mb-1.5">
                            <Repeat className="h-3.5 w-3.5 text-emerald-500" />
                            {t("repeatWeeks")}
                        </label>
                        <input
                            type="number" min={1} max={52}
                            value={form.repeatWeeks}
                            onChange={e => setForm({ ...form, repeatWeeks: Math.min(52, Math.max(1, Number(e.target.value))) })}
                            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">{t("repeatWeeksHint")}</p>
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white transition-colors cursor-pointer"
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
