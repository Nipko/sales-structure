"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
    AlertCircle, Info, Loader2, Plus, Save, ToggleLeft, ToggleRight, Trash2,
} from "lucide-react";
import {
    api,
    type PaymentProviderName,
    type PaymentProviderStatusEntry,
    type ProviderRoutingConfig,
    type WompiMethodFlags,
} from "@/lib/api";
import { SkeletonTable } from "@/components/ui/skeleton-loader";

/** Editable slice of the routing config. `available` is server-owned metadata. */
type RoutingDraft = {
    providersEnabled: Record<PaymentProviderName, boolean>;
    defaultByCountry: Record<string, PaymentProviderName>;
    wompiMethods: WompiMethodFlags;
};

const WOMPI_METHOD_KEYS = ["card", "nequi", "bancolombiaTransfer"] as const;

/** Stable backend error codes → i18n keys, so the UI never shows the raw English message alone. */
const ERROR_KEY_BY_CODE: Record<string, string> = {
    catch_all_required: "errors.catchAllRequired",
    invalid_country: "errors.invalidCountry",
    unknown_payment_provider: "errors.unknownProvider",
    provider_country_unsupported: "errors.countryUnsupported",
    provider_disabled: "errors.providerDisabled",
    provider_not_registered: "errors.providerNotRegistered",
    no_payment_provider_available: "errors.noProviderAvailable",
};

const ISO2 = /^[A-Za-z]{2}$/;

function countryDisplayName(country: string, locale: string): string {
    try {
        return new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
    } catch {
        return country;
    }
}

function toDraft(config: ProviderRoutingConfig): RoutingDraft {
    return {
        providersEnabled: { ...config.providersEnabled },
        defaultByCountry: { ...config.defaultByCountry },
        wompiMethods: { ...config.wompiMethods },
    };
}

/**
 * Runtime operator switch: which provider bills which country, without a deploy.
 *
 * Scope is deliberately narrow and stated in the UI: this only governs NEW
 * acquisitions. A live subscription keeps billing through the provider it was
 * born with (its ids, its stored card and its webhooks only mean something
 * there), so flipping a country never migrates anyone.
 */
export function ProvidersTab({
    onToast,
}: {
    onToast: (toast: { type: "success" | "error"; msg: string }) => void;
}) {
    const t = useTranslations("plansPage.providers");
    const tp = useTranslations("plansPage");
    const locale = useLocale();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<ProviderRoutingConfig | null>(null);
    const [draft, setDraft] = useState<RoutingDraft | null>(null);
    const [status, setStatus] = useState<Partial<Record<PaymentProviderName, PaymentProviderStatusEntry>>>({});
    // `key` is an i18n key resolved at render time so the loader never depends on
    // the translator: a changing `t` identity would re-trigger the fetch effect.
    const [error, setError] = useState<{ key: string; params?: Record<string, string>; detail?: string } | null>(null);
    const [newCountry, setNewCountry] = useState("");
    const [newProvider, setNewProvider] = useState<PaymentProviderName>("mercadopago");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [routingRes, statusRes] = await Promise.all([
                api.getProviderRouting(),
                api.getMpProviderStatus(),
            ]);
            if (routingRes.success && routingRes.data) {
                setConfig(routingRes.data);
                setDraft(toDraft(routingRes.data));
                const firstRegistered = routingRes.data.available.find(p => p.registered)?.name;
                if (firstRegistered) setNewProvider(firstRegistered);
            } else {
                setError({ key: "loadError", detail: routingRes.error });
            }
            if (statusRes.success && statusRes.data?.providers) setStatus(statusRes.data.providers);
        } catch {
            setError({ key: "loadError" });
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const providerNames: PaymentProviderName[] = useMemo(
        () => config?.available.map(p => p.name) ?? [],
        [config],
    );

    const dirty = useMemo(() => {
        if (!config || !draft) return false;
        return JSON.stringify(toDraft(config)) !== JSON.stringify(draft);
    }, [config, draft]);

    const countryRows = useMemo(() => {
        if (!draft) return [] as string[];
        const countries = Object.keys(draft.defaultByCountry).filter(c => c !== "*").sort();
        return ["*", ...countries];
    }, [draft]);

    const toggleProvider = (name: PaymentProviderName) => {
        setDraft(prev => prev && ({
            ...prev,
            providersEnabled: { ...prev.providersEnabled, [name]: !prev.providersEnabled[name] },
        }));
    };

    const setCountryProvider = (country: string, provider: PaymentProviderName) => {
        setDraft(prev => prev && ({
            ...prev,
            defaultByCountry: { ...prev.defaultByCountry, [country]: provider },
        }));
    };

    /** Drops the country rule locally; the save turns it into an explicit `null` (delete). */
    const removeCountry = (country: string) => {
        if (country === "*") return; // the catch-all is not deletable
        setDraft(prev => {
            if (!prev) return prev;
            const next = { ...prev.defaultByCountry };
            delete next[country];
            return { ...prev, defaultByCountry: next };
        });
    };

    const toggleWompiMethod = (key: keyof WompiMethodFlags) => {
        setDraft(prev => prev && ({
            ...prev,
            wompiMethods: { ...prev.wompiMethods, [key]: !prev.wompiMethods[key] },
        }));
    };

    const addCountry = () => {
        if (!draft) return;
        const code = newCountry.trim().toUpperCase();
        if (!ISO2.test(code)) {
            setError({ key: "addCountryInvalid" });
            return;
        }
        if (draft.defaultByCountry[code]) {
            setError({ key: "addCountryDuplicate", params: { country: code } });
            return;
        }
        setError(null);
        setCountryProvider(code, newProvider);
        setNewCountry("");
    };

    const handleSave = async () => {
        if (!draft || !config) return;
        setSaving(true);
        setError(null);
        try {
            // A country the admin removed has to travel as an explicit null:
            // omitting it would just leave the stored rule untouched.
            const defaultByCountry: Record<string, PaymentProviderName | null> = { ...draft.defaultByCountry };
            for (const country of Object.keys(config.defaultByCountry)) {
                if (!(country in draft.defaultByCountry)) defaultByCountry[country] = null;
            }

            const res = await api.updateProviderRouting({
                providersEnabled: draft.providersEnabled,
                defaultByCountry,
                wompiMethods: draft.wompiMethods,
            });
            if (res.success && res.data) {
                // The PUT answers with the same shape as the GET (settings +
                // `available`), and the server normalizes what it stored, so the
                // response is the authority — not the local draft.
                setConfig(res.data);
                setDraft(toDraft(res.data));
                onToast({ type: "success", msg: t("saved") });
            } else {
                const key = (res.errorCode && ERROR_KEY_BY_CODE[res.errorCode]) || "errors.generic";
                setError({ key, detail: res.error });
                onToast({ type: "error", msg: t(key) });
            }
        } catch {
            setError({ key: "errors.generic" });
        }
        setSaving(false);
    };

    const sectionCls = "rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900";
    const thCls = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400";
    const tdCls = "px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200";
    const selectCls = "h-8 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60";
    const chipCls = "inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300";

    if (loading) {
        return <div className={`${sectionCls} p-4`}><SkeletonTable rows={4} cols={3} /></div>;
    }

    const errorText = error ? t(error.key, error.params ?? {}) : null;

    if (!config || !draft) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                <AlertCircle size={16} /> {errorText ?? t("loadError")}
            </div>
        );
    }

    const refundsLabel =(value: PaymentProviderStatusEntry["refunds"]) =>
        value === "full" ? t("capabilities.refundsFull")
            : value === "void_only" ? t("capabilities.refundsVoidOnly")
                : t("capabilities.refundsNone");

    const providerOptionLabel = (name: PaymentProviderName) => {
        const registered = config.available.find(p => p.name === name)?.registered ?? false;
        return registered ? name : `${name} · ${t("notRegisteredShort")}`;
    };

    return (
        <div className="space-y-5">
            {/* The single most important thing to know before touching the switch. */}
            <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
                <Info size={16} className="mt-0.5 shrink-0" />
                <span>{t("scopeNote")}</span>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <span className="flex items-center gap-2"><AlertCircle size={16} /> {errorText}</span>
                    {error.detail && (
                        <span className="mt-1 block font-mono text-[11px] opacity-80">{error.detail}</span>
                    )}
                </div>
            )}

            {/* L0 — kill switch per provider */}
            <div className={`${sectionCls} p-4`}>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("enabledTitle")}</h3>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("enabledDesc")}</p>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {config.available.map(({ name, registered, capabilities }) => {
                        const enabled = draft.providersEnabled[name];
                        const detail = status[name];
                        return (
                            <div
                                key={name}
                                className={`rounded-lg border p-3 transition-colors ${
                                    registered
                                        ? "border-neutral-200 dark:border-neutral-700"
                                        : "border-dashed border-neutral-200 dark:border-neutral-700 opacity-70"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{name}</span>
                                        <span className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                            enabled
                                                ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
                                                : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                                        }`}>
                                            {enabled ? t("enabled") : t("disabled")}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        // An unregistered provider cannot be switched ON, but one that
                                        // is somehow ON must always be switchable OFF.
                                        disabled={!registered && !enabled}
                                        onClick={() => toggleProvider(name)}
                                        aria-label={name}
                                        aria-pressed={enabled}
                                        className="text-neutral-500 transition-colors hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {enabled ? <ToggleRight size={22} className="text-green-500" /> : <ToggleLeft size={22} />}
                                    </button>
                                </div>

                                {!registered && (
                                    <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">{t("notRegistered")}</p>
                                )}
                                {name === "mock" && (
                                    <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">{t("mockNote")}</p>
                                )}

                                <div className="mt-2 flex flex-wrap gap-1">
                                    <span className={chipCls}>
                                        {t("capabilities.countries")}: {capabilities.countries.length
                                            ? capabilities.countries.join(", ")
                                            : t("capabilities.countriesAll")}
                                    </span>
                                    <span className={chipCls}>
                                        {t("capabilities.currencies")}: {capabilities.currencies.length
                                            ? capabilities.currencies.join(", ")
                                            : t("capabilities.currenciesAll")}
                                    </span>
                                    <span className={chipCls}>
                                        {capabilities.nativeSubscriptions
                                            ? t("capabilities.nativeSubscriptions")
                                            : t("capabilities.ownEngine")}
                                    </span>
                                    <span className={chipCls}>
                                        {t("capabilities.refunds")}: {refundsLabel(capabilities.refunds)}
                                    </span>
                                </div>

                                {detail?.environment && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        <span className={chipCls}>
                                            {t("credentials")}: {tp(detail.environment)}
                                        </span>
                                        <span className={chipCls}>
                                            {detail.configured ? t("credentialsConfigured") : t("credentialsMissing")}
                                        </span>
                                        <span className={chipCls}>
                                            {detail.webhookConfigured ? t("webhookConfigured") : t("webhookMissing")}
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* L1 — default provider per country */}
            <div className={`${sectionCls} p-4`}>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("routingTitle")}</h3>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("routingDesc")}</p>

                <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px]">
                        <thead>
                            <tr className="border-b border-neutral-200 dark:border-neutral-700">
                                <th className={thCls}>{t("routingCountry")}</th>
                                <th className={thCls}>{t("routingProvider")}</th>
                                <th className={thCls} />
                            </tr>
                        </thead>
                        <tbody>
                            {countryRows.map(country => {
                                const isGlobal = country === "*";
                                const value = draft.defaultByCountry[country];
                                return (
                                    <tr key={country} className="border-b border-neutral-100 dark:border-neutral-800">
                                        <td className={tdCls}>
                                            {isGlobal ? (
                                                <span className="font-medium">{t("routingRestOfWorld")}</span>
                                            ) : (
                                                <span>
                                                    {countryDisplayName(country, locale)}
                                                    <span className="ml-1 font-mono text-[11px] text-neutral-400">({country})</span>
                                                </span>
                                            )}
                                        </td>
                                        <td className={tdCls}>
                                            <select
                                                value={value}
                                                onChange={e => setCountryProvider(country, e.target.value as PaymentProviderName)}
                                                className={selectCls}
                                                aria-label={isGlobal ? t("routingRestOfWorld") : country}
                                            >
                                                {providerNames.map(name => (
                                                    <option key={name} value={name}>{providerOptionLabel(name)}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className={tdCls}>
                                            {!isGlobal && (
                                                <button
                                                    type="button"
                                                    title={t("removeHint")}
                                                    onClick={() => removeCountry(country)}
                                                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                                                >
                                                    <Trash2 size={12} /> {t("remove")}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                    <input
                        value={newCountry}
                        onChange={e => setNewCountry(e.target.value.toUpperCase().slice(0, 2))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCountry(); } }}
                        maxLength={2}
                        placeholder={t("addCountryPlaceholder")}
                        aria-label={t("addCountry")}
                        className="h-8 w-24 rounded-md border border-neutral-300 bg-white px-2 font-mono text-sm uppercase text-neutral-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                    <select
                        value={newProvider}
                        onChange={e => setNewProvider(e.target.value as PaymentProviderName)}
                        aria-label={t("routingProvider")}
                        className={selectCls}
                    >
                        {providerNames.map(name => (
                            <option key={name} value={name}>{providerOptionLabel(name)}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={addCountry}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                        <Plus size={13} /> {t("addCountry")}
                    </button>
                </div>
            </div>

            {/* Wompi method flags — only meaningful while Wompi is switched on */}
            {draft.providersEnabled.wompi && (
                <div className={`${sectionCls} p-4`}>
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("wompiMethodsTitle")}</h3>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("wompiMethodsDesc")}</p>
                    <div className="mt-3 flex flex-wrap gap-4">
                        {WOMPI_METHOD_KEYS.map(key => (
                            <label key={key} className="inline-flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                                <input
                                    type="checkbox"
                                    checked={draft.wompiMethods[key]}
                                    onChange={() => toggleWompiMethod(key)}
                                    className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500/30 dark:border-neutral-600"
                                />
                                {t(`methods.${key}`)}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={() => setDraft(toDraft(config))}
                    className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                    {t("discard")}
                </button>
                <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={handleSave}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {t("save")}
                </button>
            </div>
        </div>
    );
}
