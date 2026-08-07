"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { Tag, Plus, Loader2, X, Power, Percent, DollarSign, Gift, Pencil, Users, AlertTriangle, RotateCcw } from "lucide-react";
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

interface Redemption {
    id: string;
    tenantId: string;
    redeemedAt: string;
    metadata: { source?: string; freeMonths?: number; newTrialEndsAt?: string } | null;
    tenant: { id: string; name: string; slug: string; subscriptionStatus: string | null; trialEndsAt: string | null } | null;
}

const TYPE_META: Record<Coupon["type"], { icon: any; bg: string; text: string }> = {
    percent_off: { icon: Percent, bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300" },
    amount_off: { icon: DollarSign, bg: "bg-blue-500/10", text: "text-blue-700 dark:text-blue-300" },
    free_months: { icon: Gift, bg: "bg-purple-500/10", text: "text-purple-700 dark:text-purple-300" },
};

const inputClasses =
    "w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2";

/** Claves i18n que sí existen: next-intl lanza si se le pide una inexistente. */
const KNOWN_SOURCES = ["onboarding", "billing_settings", "admin"];
const KNOWN_CREATE_ERRORS = ["invalid_code", "invalid_months", "code_already_exists", "type_not_supported"];

/**
 * Convierte la fecha del `<input type=date>` en el ÚLTIMO instante de ese día.
 * Antes se mandaba medianoche UTC y la comparación del backend es estricta, así
 * que un cupón "vence el 31/08" no funcionaba en ningún momento del 31/08.
 */
function endOfDayIso(yyyyMmDd: string): string {
    return new Date(`${yyyyMmDd}T23:59:59.999`).toISOString();
}

/** ISO → `yyyy-MM-dd` local, para rellenar el input al editar. */
function isoToDateInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CouponsPage() {
    const t = useTranslations("couponsPage");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { user } = useAuth();
    const router = useRouter();

    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [editing, setEditing] = useState<Coupon | null>(null);
    const [viewingRedemptions, setViewingRedemptions] = useState<Coupon | null>(null);

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

    async function handleReactivate(id: string) {
        const res = await api.updateCoupon(id, { isActive: true });
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
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm min-w-[840px]">
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
                                const meta = TYPE_META[c.type] ?? TYPE_META.free_months;
                                const Icon = meta.icon;
                                const redeemable = c.type === "free_months";
                                const value = c.type === "percent_off"
                                    ? `${c.percentDiscount}%`
                                    : c.type === "amount_off"
                                        ? `$${((c.amountOffCents ?? 0) / 100).toFixed(2)}`
                                        : `${c.freeMonths} ${t("months")}`;
                                const exhausted = c.maxRedemptions != null && c.redemptionCount >= c.maxRedemptions;
                                const expired = !!c.expiresAt && new Date(c.expiresAt) < new Date();
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
                                            {!redeemable && (
                                                <span
                                                    className="ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                                    title={t("legacyHint")}
                                                >
                                                    <AlertTriangle className="w-3 h-3" />
                                                    {t("legacyBadge")}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">{value}</td>
                                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 text-xs">
                                            <button
                                                onClick={() => setViewingRedemptions(c)}
                                                className="inline-flex items-center gap-1 hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                                title={t("viewRedemptions")}
                                            >
                                                <Users className="w-3 h-3" />
                                                {c.redemptionCount}
                                                {c.maxRedemptions != null && ` / ${c.maxRedemptions}`}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 text-xs">
                                            {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                                        </td>
                                        <td className="px-4 py-3">
                                            {!c.isActive ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-neutral-500/10 text-neutral-500">
                                                    {tc("inactive")}
                                                </span>
                                            ) : expired ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                    {t("statusExpired")}
                                                </span>
                                            ) : exhausted ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                    {t("statusExhausted")}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                                    {tc("active")}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-3">
                                                <button
                                                    onClick={() => setEditing(c)}
                                                    className="text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                                                    title={t("editTitle")}
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                {c.isActive ? (
                                                    <button
                                                        onClick={() => handleDeactivate(c.id)}
                                                        className="text-red-600 dark:text-red-400 hover:opacity-70"
                                                        title={t("deactivate")}
                                                    >
                                                        <Power className="w-4 h-4" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleReactivate(c.id)}
                                                        className="text-emerald-600 dark:text-emerald-400 hover:opacity-70"
                                                        title={t("reactivate")}
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
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

            {editing && (
                <EditCouponModal
                    coupon={editing}
                    onClose={() => setEditing(null)}
                    onSuccess={() => {
                        setEditing(null);
                        load();
                    }}
                />
            )}

            {viewingRedemptions && (
                <RedemptionsModal
                    coupon={viewingRedemptions}
                    onClose={() => setViewingRedemptions(null)}
                />
            )}
        </div>
    );
}

function ModalShell({
    title,
    onClose,
    children,
    footer,
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                    <h3 className="text-base font-semibold">{title}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">{children}</div>
                {footer && (
                    <div className="flex justify-end gap-2 p-4 border-t border-neutral-200 dark:border-neutral-800">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Solo emite cupones de meses gratis. Los tipos "% descuento" y "monto fijo"
 * salieron del formulario: nunca descontaron nada del cobro — el tenant veía
 * "cupón aplicado" y se le cobraba el 100%. El backend también los rechaza.
 */
function CreateCouponModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const t = useTranslations("couponsPage");
    const tc = useTranslations("common");
    const [code, setCode] = useState("");
    const [description, setDescription] = useState("");
    const [freeMonths, setFreeMonths] = useState(1);
    const [maxRedemptions, setMaxRedemptions] = useState<number | "">("");
    const [expiresAt, setExpiresAt] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        setBusy(true);
        setError(null);
        try {
            const body: any = {
                code,
                type: "free_months",
                freeMonths,
                description: description || undefined,
            };
            if (maxRedemptions !== "") body.maxRedemptions = Number(maxRedemptions);
            if (expiresAt) body.expiresAt = endOfDayIso(expiresAt);

            const res = await api.createCoupon(body);
            if (res.success) onSuccess();
            else {
                const errCode = (res as any).errorCode;
                setError(
                    errCode && KNOWN_CREATE_ERRORS.includes(errCode)
                        ? t(`errors.${errCode}`)
                        : ((res as any).error || tc("connectionError")),
                );
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ModalShell
            title={t("createTitle")}
            onClose={onClose}
            footer={
                <>
                    <button onClick={onClose} disabled={busy} className="px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-sm">{tc("cancel")}</button>
                    <button
                        onClick={handleSubmit}
                        disabled={busy || !code}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {t("create")}
                    </button>
                </>
            }
        >
            <div className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400 bg-purple-500/5 border border-purple-500/20 rounded-lg p-3">
                <Gift className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                <p>{t("createHint")}</p>
            </div>

            <div>
                <label className="block text-sm font-medium mb-1">{t("col.code")}</label>
                <input
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    placeholder="LANZAMIENTO1MES"
                    className={`${inputClasses} font-mono`}
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
                    className={inputClasses}
                />
            </div>

            <div>
                <label className="block text-sm font-medium mb-1">{t("monthsLabel")}</label>
                <input
                    type="number"
                    min={1}
                    max={24}
                    value={freeMonths}
                    onChange={e => setFreeMonths(parseInt(e.target.value || "1", 10))}
                    className={inputClasses}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-sm font-medium mb-1">{t("maxRedemptions")}</label>
                    <input
                        type="number"
                        min={1}
                        value={maxRedemptions}
                        onChange={e => setMaxRedemptions(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                        placeholder={t("unlimited")}
                        className={inputClasses}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">{t("expiresAt")}</label>
                    <input
                        type="date"
                        value={expiresAt}
                        onChange={e => setExpiresAt(e.target.value)}
                        className={inputClasses}
                    />
                </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>}
        </ModalShell>
    );
}

/**
 * El backend siempre tuvo PUT admin/:id y la UI nunca lo llamaba: desactivar era
 * un viaje sin vuelta desde el panel. Acá se editan los campos que el endpoint
 * acepta (el código y los meses son inmutables por diseño: cambiarlos redefiniría
 * un cupón que ya se canjeó).
 */
function EditCouponModal({ coupon, onClose, onSuccess }: { coupon: Coupon; onClose: () => void; onSuccess: () => void }) {
    const t = useTranslations("couponsPage");
    const tc = useTranslations("common");
    const [description, setDescription] = useState(coupon.description ?? "");
    const [maxRedemptions, setMaxRedemptions] = useState<number | "">(coupon.maxRedemptions ?? "");
    const [expiresAt, setExpiresAt] = useState(isoToDateInput(coupon.expiresAt));
    const [isActive, setIsActive] = useState(coupon.isActive);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit() {
        setBusy(true);
        setError(null);
        try {
            const res = await api.updateCoupon(coupon.id, {
                description,
                isActive,
                maxRedemptions: maxRedemptions === "" ? null : Number(maxRedemptions),
                expiresAt: expiresAt ? endOfDayIso(expiresAt) : null,
            });
            if (res.success) onSuccess();
            else setError((res as any).error || tc("connectionError"));
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ModalShell
            title={`${t("editTitle")} · ${coupon.code}`}
            onClose={onClose}
            footer={
                <>
                    <button onClick={onClose} disabled={busy} className="px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-sm">{tc("cancel")}</button>
                    <button
                        onClick={handleSubmit}
                        disabled={busy}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {tc("save")}
                    </button>
                </>
            }
        >
            <div className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg p-3">
                {t("editLocked", {
                    months: coupon.freeMonths ?? 0,
                    redemptions: coupon.redemptionCount,
                })}
            </div>

            <div>
                <label className="block text-sm font-medium mb-1">{t("description")}</label>
                <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                    className={inputClasses}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-sm font-medium mb-1">{t("maxRedemptions")}</label>
                    <input
                        type="number"
                        min={1}
                        value={maxRedemptions}
                        onChange={e => setMaxRedemptions(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                        placeholder={t("unlimited")}
                        className={inputClasses}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">{t("expiresAt")}</label>
                    <input
                        type="date"
                        value={expiresAt}
                        onChange={e => setExpiresAt(e.target.value)}
                        className={inputClasses}
                    />
                </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                    className="rounded border-neutral-300 dark:border-neutral-600"
                />
                {t("activeToggle")}
            </label>

            {error && <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>}
        </ModalShell>
    );
}

/** Quién canjeó el cupón: el endpoint existía desde el día 1 y nadie lo llamaba. */
function RedemptionsModal({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
    const t = useTranslations("couponsPage");
    const [rows, setRows] = useState<Redemption[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            const res = await api.listCouponRedemptions(coupon.id);
            if (!alive) return;
            if (res.success && Array.isArray(res.data)) setRows(res.data as Redemption[]);
            setLoading(false);
        })();
        return () => { alive = false; };
    }, [coupon.id]);

    return (
        <ModalShell title={`${t("redemptionsTitle")} · ${coupon.code}`} onClose={onClose}>
            {loading && <SkeletonTable rows={3} cols={3} />}

            {!loading && rows.length === 0 && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400 py-6 text-center">
                    {t("redemptionsEmpty")}
                </p>
            )}

            {!loading && rows.length > 0 && (
                <table className="w-full text-sm">
                    <thead className="text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                        <tr>
                            <th className="py-2 text-left font-medium">{t("col.tenant")}</th>
                            <th className="py-2 text-left font-medium">{t("col.source")}</th>
                            <th className="py-2 text-left font-medium">{t("col.redeemedAt")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                                <td className="py-2.5">
                                    {r.tenant ? (
                                        <>
                                            <div className="font-medium text-neutral-800 dark:text-neutral-200">{r.tenant.name}</div>
                                            <div className="text-xs text-neutral-500 font-mono">{r.tenant.slug}</div>
                                        </>
                                    ) : (
                                        <span className="text-xs text-neutral-500 italic">{t("tenantDeleted")}</span>
                                    )}
                                </td>
                                <td className="py-2.5 text-xs text-neutral-600 dark:text-neutral-400">
                                    {/* Clave dinámica acotada: next-intl lanza si la clave no existe. */}
                                    {r.metadata?.source && KNOWN_SOURCES.includes(r.metadata.source)
                                        ? t(`source.${r.metadata.source}`)
                                        : "—"}
                                </td>
                                <td className="py-2.5 text-xs text-neutral-600 dark:text-neutral-400">
                                    {new Date(r.redeemedAt).toLocaleString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </ModalShell>
    );
}
