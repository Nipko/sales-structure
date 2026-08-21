"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Globe2, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ONBOARDING_COUNTRIES } from "@parallext/shared";

/**
 * Qué sabe el sistema sobre dónde opera este negocio, y de dónde lo sacó.
 *
 * El backend resolvía la identidad regional con procedencia —`declared`,
 * `derived`, `inferred`, `fallback`— desde hacía un release, y detectaba los
 * conflictos entre señales. Nada de eso llegaba a una pantalla, y **no existía
 * forma de declarar un valor**: la rama `declared` era inalcanzable. El país
 * siempre venía inferido o de fallback, y un `fallback` es exactamente lo que
 * hace que un teléfono no se normalice y que el agente hable de precios en la
 * moneda equivocada.
 *
 * Mostrar la procedencia no es un detalle técnico: es la diferencia entre "el
 * negocio dijo que opera en México" y "nadie dijo nada y pusimos Colombia para
 * poder seguir". Con el mismo texto en pantalla, el dueño no puede saber cuál
 * de las dos está viendo.
 */

interface RegionalValue { value: string; source: string; from?: string }

interface RegionalProfile {
    operatingCountry: RegionalValue;
    operatingCurrency: RegionalValue;
    timezone: RegionalValue;
    locale: RegionalValue;
    phoneRegion: RegionalValue;
    addressForm: RegionalValue;
    countryPackId: string;
    countryPackStatus: string;
    conflicts: Array<{ field: string; candidates: Array<{ value: string; from: string }>; suggested?: string }>;
}

interface Review {
    id: string;
    field: string;
    candidates: Array<{ value: string; from: string }>;
    suggested?: string | null;
}

const SOURCE_STYLE: Record<string, string> = {
    declared: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    derived: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    inferred: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    fallback: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

export function RegionalIdentityCard({ tenantId }: { tenantId: string | null | undefined }) {
    const t = useTranslations("settings.regionalIdentity");
    const [profile, setProfile] = useState<RegionalProfile | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState("");
    const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

    const load = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [p, r]: any[] = await Promise.all([
                api.getRegionalProfile(tenantId),
                api.getRegionalReviews(tenantId),
            ]);
            if (p?.success) setProfile(p.data);
            if (r?.success) setReviews(r.data || []);
        } catch { /* noop */ }
        setLoading(false);
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const flash = (ok: boolean, msg: string) => {
        setNotice({ ok, msg });
        setTimeout(() => setNotice(null), 4000);
    };

    const declareCountry = async (value: string) => {
        if (!tenantId || !value) return;
        setBusy("country");
        try {
            const res: any = await api.declareRegionalValue(tenantId, "operating_country", value);
            if (res?.success) { flash(true, t("declared")); await load(); }
            else flash(false, res?.error || t("failed"));
        } catch (e: any) { flash(false, e?.message || t("failed")); }
        setBusy("");
    };

    const resolveReview = async (reviewId: string, value: string) => {
        if (!tenantId) return;
        setBusy(reviewId);
        try {
            const res: any = await api.resolveRegionalReview(tenantId, reviewId, value);
            if (res?.success) { flash(true, t("declared")); await load(); }
            else flash(false, res?.error || t("failed"));
        } catch (e: any) { flash(false, e?.message || t("failed")); }
        setBusy("");
    };

    const refresh = async () => {
        if (!tenantId) return;
        setBusy("refresh");
        try { await api.refreshRegionalReviews(tenantId); await load(); }
        catch { /* noop */ }
        setBusy("");
    };

    if (!tenantId) return null;

    const rows: Array<[string, RegionalValue | undefined]> = profile ? [
        [t("field_country"), profile.operatingCountry],
        [t("field_currency"), profile.operatingCurrency],
        [t("field_timezone"), profile.timezone],
        [t("field_locale"), profile.locale],
        [t("field_phoneRegion"), profile.phoneRegion],
        [t("field_addressForm"), profile.addressForm],
    ] : [];

    const countryUndeclared = profile?.operatingCountry?.source !== "declared";

    return (
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start gap-3">
                <Globe2 size={18} className="mt-0.5 text-neutral-400" />
                <div className="flex-1">
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h2>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                </div>
                <button
                    onClick={refresh}
                    disabled={busy === "refresh"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:text-neutral-100"
                >
                    {busy === "refresh" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {t("recheck")}
                </button>
            </div>

            {notice && (
                <div className={cn("text-xs font-medium", notice.ok ? "text-emerald-500" : "text-red-400")}>
                    {notice.msg}
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin text-neutral-400" /></div>
            ) : (
                <>
                    {/* Declarar el país es lo que apaga los fallbacks: sin él, el
                        teléfono no se normaliza y la moneda es una suposición. */}
                    {countryUndeclared && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[13px] text-amber-800 dark:text-amber-200">
                            <AlertTriangle size={15} className="shrink-0" />
                            <span className="flex-1 min-w-[16rem]">{t("declareCountryPrompt")}</span>
                            <select
                                defaultValue=""
                                disabled={busy === "country"}
                                onChange={(e) => declareCountry(e.target.value)}
                                className="h-8 rounded-lg border border-amber-500/30 bg-white px-2 text-xs text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                            >
                                <option value="" disabled>{t("chooseCountry")}</option>
                                {ONBOARDING_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    )}

                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {rows.map(([label, entry]) => (
                            <div key={label} className="flex items-center justify-between gap-3 py-2">
                                <span className="text-[13px] text-neutral-600 dark:text-neutral-400">{label}</span>
                                <span className="flex items-center gap-2">
                                    <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                                        {entry?.value || "—"}
                                    </span>
                                    <span
                                        title={entry?.from || ""}
                                        className={cn(
                                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                            SOURCE_STYLE[entry?.source || "fallback"],
                                        )}
                                    >
                                        {t(`source_${entry?.source || "fallback"}`)}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Un conflicto NO se resuelve solo. Elegir por el dueño le
                        cambiaría la moneda, la terminología y sus fuentes
                        regulatorias sin que se entere. */}
                    {reviews.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <p className="text-[13px] font-medium text-amber-800 dark:text-amber-200">
                                {t("conflictsTitle", { count: reviews.length })}
                            </p>
                            {reviews.map((review) => (
                                <div key={review.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                                    <span className="text-neutral-600 dark:text-neutral-400">
                                        {t(`field_${review.field}`, { fallback: review.field } as any)}
                                    </span>
                                    {review.candidates.map((candidate) => (
                                        <button
                                            key={`${review.id}-${candidate.value}`}
                                            onClick={() => resolveReview(review.id, candidate.value)}
                                            disabled={busy === review.id}
                                            title={t("candidateFrom", { from: candidate.from })}
                                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                                        >
                                            {busy === review.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                            {candidate.value}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
