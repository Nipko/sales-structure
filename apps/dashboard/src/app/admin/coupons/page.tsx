"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { Tag, Plus, Loader2, X, Power, Percent, DollarSign, Gift } from "lucide-react";
import { SkeletonTable } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";

interface Coupon {
    id: string;
    code: string;
    description: string | null;
    type: "percent_off" | "amount_off" | "free_months";
    percentDiscount: number | null;
    amountOffCents: number | null;
    freeMonths: number | null;
    durationCycles: number | null;
    appliesToPlanIds: string[];
    maxRedemptions: number | null;
    redemptionCount: number;
    expiresAt: string | null;
    isActive: boolean;
    createdAt: string;
}

const TYPE_META: Record<Coupon["type"], { icon: any; bg: string; text: string }> = {
    percent_off: { icon: Percent, bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300" },
    amount_off: { icon: DollarSign, bg: "bg-blue-500/10", text: "text-blue-700 dark:text-blue-300" },
    free_months: { icon: Gift, bg: "bg-purple-500/10", text: "text-purple-700 dark:text-purple-300" },
};

export default function CouponsPage() {
    const t = useTranslations("couponsPage");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { user } = useAuth();
    const router = useRouter();

    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await api.listCoupons();
        if (res.success && Array.isArray(res.data)) setCoupons(res.data as Coupon[]);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (user && user.role !== "super_admin") {
            router.push("/admin");
            return;
        }
        load();
    }, [user, router, load]);

    async function handleDeactivate(id: string) {
        if (!window.confirm(t("confirmDeactivate"))) return;
        const res = await api.deactivateCoupon(id);
        if (res.success) load();
        else alert((res as any).error || tc("connectionError"));
    }

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Tag}
                action={
                    <button
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                    >
                        <Plus className="w-4 h-4" />
                        {t("create")}
                    </button>
                }
            />
            <HelpPanel
                title={tHelp("coupons.title")}
                description={tHelp("coupons.description")}
                tips={tHelp.raw("coupons.tips") as string[]}
                mediaKey="coupons"
            />

            {loading && <SkeletonTable rows={5} cols={6} />}

            {!loading && coupons.length === 0 && (
                <EmptyState
                    icon={Tag}
                    iconColor="text-emerald-400"
                    title={t("empty.title")}
                    description={t("empty.hint")}
                />
            )}

            {!loading && coupons.length > 0 && (
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                            <tr>
                                <th className="px-4 py-2.5 text-left font-medium">{t("col.code")}</th>
                                <th className="px-4 py-2.5 text-left font-medium">{t("col.type")}</th>
                                <th className="px-4 py-2.5 text-left font-medium">{t("col.value")}</th>
                                <th className="px-4 py-2.5 text-left font-medium">{t("col.redemptions")}</th>
                                <th className="px-4 py-2.5 text-left font-medium">{t("col.expires")}</th>
                                <th className="px-4 py-2.5 text-left font-medium">{t("col.status")}</th>
                                <th className="px-4 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {coupons.map((c) => {
                                const meta = TYPE_META[c.type];
                                const Icon = meta.icon;
                                const value = c.type === "percent_off"
                                    ? `${c.percentDiscount}%`
                                    : c.type === "amount_off"
                                        ? `$${(c.amountOffCents! / 100).toFixed(2)}`
                                        : `${c.freeMonths} ${t("months")}`;
                                const cycles = c.durationCycles
                                    ? ` · ${t("cyclesLabel", { n: c.durationCycles })}`
                                    : c.type !== "free_months" ? ` · ${t("forever")}` : "";
                                return (
                                    <tr key={c.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                                        <td className="px-4 py-3 font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                                            {c.code}
                                            {c.description && (
                                                <div className="text-xs text-neutral-500 dark:text-neutral-400 font-sans font-normal mt-0.5">
                                                    {c.description}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
                                                <Icon className="w-3 h-3" />
                                                {t(`type.${c.type}`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                                            {value}
                                            <span className="text-xs text-neutral-500">{cycles}</span>
                                        </td>
                                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 text-xs">
                                            {c.redemptionCount}
                                            {c.maxRedemptions != null && ` / ${c.maxRedemptions}`}
                                        </td>
                                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 text-xs">
                                            {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                                        </td>
                                        <td className="px-4 py-3">
                                            {c.isActive ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                                    {tc("active")}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-neutral-500/10 text-neutral-500">
                                                    {tc("inactive")}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {c.isActive && (
                                                <button
                                                    onClick={() => handleDeactivate(c.id)}
                                                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                                                    title={t("deactivate")}
                                                >
                                                    <Power className="w-4 h-4 inline" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {showCreate && (
                <CreateCouponModal
                    onClose={() => setShowCreate(false)}
                    onSuccess={() => {
                        setShowCreate(false);
                        load();
                    }}
                />
            )}
        </div>
    );
}

function CreateCouponModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const t = useTranslations("couponsPage");
    const tc = useTranslations("common");
    const [type, setType] = useState<"percent_off" | "amount_off" | "free_months">("percent_off");
    const [code, setCode] = useState("");
    const [description, setDescription] = useState("");
    const [percentDiscount, setPercentDiscount] = useState(20);
    const [amountOffCents, setAmountOffCents] = useState(1000);
    const [freeMonths, setFreeMonths] = useState(1);
    const [durationCycles, setDurationCycles] = useState<number | "">("");
    const [maxRedemptions, setMaxRedemptions] = useState<number | "">("");
    const [expiresAt, setExpiresAt] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        setBusy(true);
        setError(null);
        try {
            const body: any = { code, type, description: description || undefined };
            if (type === "percent_off") body.percentDiscount = percentDiscount;
            if (type === "amount_off") body.amountOffCents = amountOffCents;
            if (type === "free_months") body.freeMonths = freeMonths;
            if (type !== "free_months" && durationCycles !== "") body.durationCycles = Number(durationCycles);
            if (maxRedemptions !== "") body.maxRedemptions = Number(maxRedemptions);
            if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

            const res = await api.createCoupon(body);
            if (res.success) onSuccess();
            else setError((res as any).error || tc("connectionError"));
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{t("createTitle")}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("col.code")}</label>
                        <input
                            type="text"
                            value={code}
                            onChange={e => setCode(e.target.value.toUpperCase())}
                            placeholder="LAUNCH50"
                            className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 font-mono"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t("codeHint")}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("description")}</label>
                        <input
                            type="text"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder={t("descriptionPlaceholder")}
                            className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("col.type")}</label>
                        <select
                            value={type}
                            onChange={e => setType(e.target.value as any)}
                            className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                        >
                            <option value="percent_off">{t("type.percent_off")}</option>
                            <option value="amount_off">{t("type.amount_off")}</option>
                            <option value="free_months">{t("type.free_months")}</option>
                        </select>
                    </div>
                    {type === "percent_off" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("percentLabel")}</label>
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={percentDiscount}
                                onChange={e => setPercentDiscount(parseInt(e.target.value || "0", 10))}
                                className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                            />
                        </div>
                    )}
                    {type === "amount_off" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("amountLabel")}</label>
                            <input
                                type="number"
                                min={1}
                                value={amountOffCents}
                                onChange={e => setAmountOffCents(parseInt(e.target.value || "0", 10))}
                                className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                            />
                        </div>
                    )}
                    {type === "free_months" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("monthsLabel")}</label>
                            <input
                                type="number"
                                min={1}
                                max={24}
                                value={freeMonths}
                                onChange={e => setFreeMonths(parseInt(e.target.value || "0", 10))}
                                className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                            />
                        </div>
                    )}
                    {type !== "free_months" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("cyclesLabel2")}</label>
                            <input
                                type="number"
                                min={1}
                                value={durationCycles}
                                onChange={e => setDurationCycles(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                                placeholder={t("cyclesPlaceholder")}
                                className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("maxRedemptions")}</label>
                            <input
                                type="number"
                                min={1}
                                value={maxRedemptions}
                                onChange={e => setMaxRedemptions(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                                placeholder={t("unlimited")}
                                className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("expiresAt")}</label>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={e => setExpiresAt(e.target.value)}
                                className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2"
                            />
                        </div>
                    </div>
                    {error && <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-neutral-200 dark:border-neutral-800">
                    <button onClick={onClose} disabled={busy} className="px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-sm">{tc("cancel")}</button>
                    <button
                        onClick={handleSubmit}
                        disabled={busy || !code}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {t("create")}
                    </button>
                </div>
            </div>
        </div>
    );
}
