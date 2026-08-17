"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
    AlertTriangle, Check, CheckCircle2, Copy, CreditCard, ExternalLink,
    KeyRound, Loader2, Save, ShieldCheck, Unplug,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useTenant } from "@/contexts/TenantContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import {
    api,
    type TenantPaymentProvider,
    type TenantPaymentProviderConfig,
    type TenantPaymentsConfig,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const EMPTY_CONFIG: TenantPaymentsConfig = { connected: false, providers: {} };

function projectedProvider(
    config: TenantPaymentsConfig,
    provider: TenantPaymentProvider,
): TenantPaymentProviderConfig {
    const explicit = config.providers?.[provider];
    if (explicit) return explicit;

    // V1 only supported Mercado Pago and returned a flat projection. This
    // fallback lets API and dashboard roll out in either order.
    const projected = config.activeProvider || config.provider || "mercadopago";
    if (projected === provider && config.connected) {
        return {
            provider,
            connected: true,
            ready: config.ready ?? true,
            verified: config.verified ?? true,
            webhookConfigured: config.webhookConfigured === true,
            publicKey: config.publicKey,
            accountEmail: config.accountEmail,
            environment: config.environment,
            webhookUrl: config.webhookUrl,
        };
    }
    return { provider, connected: false, ready: false, verified: false, webhookConfigured: false };
}

export default function TenantPaymentsPage() {
    const t = useTranslations("tenantPayments");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const { features, loading: planLoading } = usePlanLimits();
    const initialProviderSelected = useRef(false);

    const [cfg, setCfg] = useState<TenantPaymentsConfig>(EMPTY_CONFIG);
    const [provider, setProvider] = useState<TenantPaymentProvider>("wompi");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activating, setActivating] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

    const [mpAccessToken, setMpAccessToken] = useState("");
    const [mpPublicKey, setMpPublicKey] = useState("");
    const [mpWebhookSecret, setMpWebhookSecret] = useState("");
    const [wompiEnvironment, setWompiEnvironment] = useState<"sandbox" | "production">("sandbox");
    const [wompiPublicKey, setWompiPublicKey] = useState("");
    const [wompiPrivateKey, setWompiPrivateKey] = useState("");
    const [wompiEventsSecret, setWompiEventsSecret] = useState("");

    const load = useCallback(async () => {
        if (!activeTenantId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const res = await api.getTenantPaymentsConfig(activeTenantId).catch(() => null);
        if (res?.success && res.data) {
            const next = res.data;
            setCfg(next);
            const mp = projectedProvider(next, "mercadopago");
            const wompi = projectedProvider(next, "wompi");
            setMpPublicKey(mp.publicKey || "");
            setWompiPublicKey(wompi.publicKey || "");
            setWompiEnvironment(wompi.environment || "sandbox");
            if (!initialProviderSelected.current) {
                setProvider(next.activeProvider || (wompi.connected ? "wompi" : (mp.connected ? "mercadopago" : "wompi")));
                initialProviderSelected.current = true;
            }
        } else {
            setCfg(EMPTY_CONFIG);
        }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { void load(); }, [load]);

    const state = projectedProvider(cfg, provider);
    const planAllowsPayments = features.customerPayments === true;
    const activeProvider = cfg.activeProvider || cfg.provider;
    const isActive = activeProvider === provider;

    async function handleSave() {
        if (!activeTenantId || !planAllowsPayments) return;
        setSaving(true);
        setFeedback(null);
        let res;

        if (provider === "wompi") {
            if (!state.connected && (!wompiPublicKey || !wompiPrivateKey || !wompiEventsSecret)) {
                setSaving(false);
                setFeedback({ ok: false, text: t("wompiCredentialsRequired") });
                return;
            }
            res = await api.setTenantPaymentsProviderConfig(activeTenantId, "wompi", {
                provider: "wompi",
                environment: wompiEnvironment,
                publicKey: wompiPublicKey || undefined,
                ...(wompiPrivateKey ? { privateKey: wompiPrivateKey } : {}),
                ...(wompiEventsSecret ? { eventsSecret: wompiEventsSecret } : {}),
            }).catch((error: any) => ({ success: false, error: error?.message }));
        } else {
            if (!state.connected && (!mpAccessToken || !mpWebhookSecret)) {
                setSaving(false);
                setFeedback({ ok: false, text: t("mercadoPagoCredentialsRequired") });
                return;
            }
            res = await api.setTenantPaymentsProviderConfig(activeTenantId, "mercadopago", {
                provider: "mercadopago",
                activate: isActive || !activeProvider,
                ...(mpAccessToken ? { accessToken: mpAccessToken } : {}),
                ...(mpWebhookSecret ? { webhookSecret: mpWebhookSecret } : {}),
                publicKey: mpPublicKey || undefined,
            }).catch((error: any) => ({ success: false, error: error?.message }));
        }

        setSaving(false);
        if (res?.success) {
            clearSecrets();
            setFeedback({ ok: true, text: t("savedProvider", { provider: t(`providers.${provider}.name`) }) });
            await load();
        } else {
            setFeedback({ ok: false, text: res?.error || t("invalidCredentials") });
        }
    }

    async function handleActivate() {
        const canActivate = state.activationReady ?? state.ready;
        if (!activeTenantId || !planAllowsPayments || !canActivate) return;
        if (provider === "wompi" && !window.confirm(t("wompiActivationConfirm"))) return;
        setActivating(true);
        setFeedback(null);
        const res = await api.activateTenantPaymentsProvider(activeTenantId, provider)
            .catch((error: any) => ({ success: false, error: error?.message }));
        setActivating(false);
        if (res?.success) {
            setFeedback({ ok: true, text: t("activatedProvider", { provider: t(`providers.${provider}.name`) }) });
            await load();
        } else {
            setFeedback({ ok: false, text: res?.error || t("activateFailed") });
        }
    }

    async function handleDisconnect() {
        if (!activeTenantId || !state.connected) return;
        if (!window.confirm(t("disconnectConfirm", { provider: t(`providers.${provider}.name`) }))) return;
        setDisconnecting(true);
        setFeedback(null);
        const res = await api.disconnectTenantPaymentsProvider(activeTenantId, provider)
            .catch((error: any) => ({ success: false, error: error?.message }));
        setDisconnecting(false);
        if (res?.success) {
            clearSecrets();
            setFeedback({ ok: true, text: t("disconnectedProvider", { provider: t(`providers.${provider}.name`) }) });
            await load();
        } else {
            setFeedback({ ok: false, text: res?.error || t("disconnectFailed") });
        }
    }

    function clearSecrets() {
        setMpAccessToken("");
        setMpWebhookSecret("");
        setWompiPrivateKey("");
        setWompiEventsSecret("");
    }

    async function copyWebhook() {
        if (!state.webhookUrl) return;
        await navigator.clipboard.writeText(state.webhookUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
    }

    if (loading) {
        return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="max-w-4xl space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={CreditCard} />

            <Notice icon={ShieldCheck} className="border-sky-500/20 bg-sky-500/10 text-sky-800 dark:text-sky-200">
                {t("directNotice")}
            </Notice>

            {!planLoading && !planAllowsPayments && (
                <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{t("planRequired")}</span>
                    </div>
                    <Link href="/admin/settings/billing" className="shrink-0 font-semibold underline underline-offset-2">{t("reviewPlans")}</Link>
                </div>
            )}

            {feedback && (
                <Notice
                    icon={feedback.ok ? CheckCircle2 : AlertTriangle}
                    className={feedback.ok
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"}
                >
                    {feedback.text}
                </Notice>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["wompi", "mercadopago"] as const).map((item) => {
                    const itemState = projectedProvider(cfg, item);
                    const itemActive = activeProvider === item;
                    return (
                        <button
                            key={item}
                            type="button"
                            onClick={() => { setProvider(item); setFeedback(null); }}
                            className={cn(
                                "rounded-xl border p-4 text-left transition-colors",
                                provider === item
                                    ? "border-indigo-400 bg-indigo-500/[0.04] dark:border-indigo-500/60"
                                    : "border-border bg-card hover:bg-muted/40"
                            )}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">{t(`providers.${item}.name`)}</span>
                                <span className="flex items-center gap-1.5">
                                    {itemActive && itemState.ready && <StatusPill tone="indigo" text={t("active")} />}
                                    {itemState.connected && <StatusPill tone={itemState.ready ? "green" : "amber"} text={itemState.ready ? t("ready") : t("setupIncomplete")} />}
                                </span>
                            </div>
                            <p className="mt-1.5 text-xs text-muted-foreground">{t(`providers.${item}.description`)}</p>
                        </button>
                    );
                })}
            </div>

            <section className="rounded-xl border border-border bg-card p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="font-semibold">{t(`providers.${provider}.name`)}</h2>
                            {state.verified && <StatusPill tone="green" text={t("accountVerified")} />}
                            {isActive && state.ready && <StatusPill tone="indigo" text={t("activeForAgent")} />}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {state.accountEmail || state.merchantName || t(`providers.${provider}.credentialsHint`)}
                        </p>
                    </div>
                    {(state.connected || state.activationReady === true) && (!isActive || !state.ready) && (
                        <button
                            type="button"
                            onClick={handleActivate}
                            disabled={activating || !(state.activationReady ?? state.ready) || !planAllowsPayments}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-indigo-400"
                        >
                            {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {t("useForAgent")}
                        </button>
                    )}
                </div>

                {provider === "wompi" ? (
                    <WompiForm
                        t={t}
                        state={state}
                        environment={wompiEnvironment}
                        setEnvironment={setWompiEnvironment}
                        publicKey={wompiPublicKey}
                        setPublicKey={setWompiPublicKey}
                        privateKey={wompiPrivateKey}
                        setPrivateKey={setWompiPrivateKey}
                        eventsSecret={wompiEventsSecret}
                        setEventsSecret={setWompiEventsSecret}
                        disabled={!planAllowsPayments}
                        copyWebhook={copyWebhook}
                        copied={copied}
                    />
                ) : (
                    <div className="space-y-4">
                        <SecretField label={t("mpAccessToken")} value={mpAccessToken} onChange={setMpAccessToken} placeholder={state.connected ? "••••••••••••" : "APP_USR-..."} disabled={!planAllowsPayments} hint={t("mpAccessTokenHint")} />
                        <SecretField label={t("mpWebhookSecret")} value={mpWebhookSecret} onChange={setMpWebhookSecret} placeholder={state.webhookConfigured ? "••••••••••••" : t("mpWebhookSecretPlaceholder")} disabled={!planAllowsPayments} hint={t("mpWebhookSecretHint")} />
                        <SecretField label={t("mpPublicKey")} value={mpPublicKey} onChange={setMpPublicKey} placeholder="APP_USR-..." secret={false} disabled={!planAllowsPayments} hint={t("mpPublicKeyHint")} />
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    {state.connected ? (
                        <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-red-600 transition-colors hover:bg-muted disabled:opacity-40 dark:text-red-400">
                            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                            {t("disconnect")}
                        </button>
                    ) : <span />}
                    <button type="button" onClick={handleSave} disabled={saving || !planAllowsPayments || planLoading} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-semibold">{t("agentIntegrationTitle")}</h2>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("agentIntegrationDescription")}</p>
                    </div>
                    <Link href="/admin/agent" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                        {t("configureAgent")} <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                </div>
            </section>

            <div className="space-y-1 text-xs text-muted-foreground">
                <p>{t("footnote")}</p>
                <p>{t("scopeNotice")}</p>
            </div>
        </div>
    );
}

function WompiForm({
    t, state, environment, setEnvironment, publicKey, setPublicKey,
    privateKey, setPrivateKey, eventsSecret, setEventsSecret,
    disabled, copyWebhook, copied,
}: {
    t: any;
    state: TenantPaymentProviderConfig;
    environment: "sandbox" | "production";
    setEnvironment: (value: "sandbox" | "production") => void;
    publicKey: string;
    setPublicKey: (value: string) => void;
    privateKey: string;
    setPrivateKey: (value: string) => void;
    eventsSecret: string;
    setEventsSecret: (value: string) => void;
    disabled: boolean;
    copyWebhook: () => Promise<void>;
    copied: boolean;
}) {
    return (
        <div className="space-y-4">
            <div>
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{t("environment")}</label>
                <select value={environment} onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")} disabled={disabled} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">
                    <option value="sandbox">{t("sandbox")}</option>
                    <option value="production">{t("production")}</option>
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("environmentHint")}</p>
            </div>
            <SecretField label={t("wompiPublicKey")} value={publicKey} onChange={setPublicKey} placeholder={environment === "production" ? "pub_prod_..." : "pub_test_..."} secret={false} disabled={disabled} hint={t("wompiPublicKeyHint")} />
            <SecretField label={t("wompiPrivateKey")} value={privateKey} onChange={setPrivateKey} placeholder={state.connected ? "••••••••••••" : (environment === "production" ? "prv_prod_..." : "prv_test_...")} disabled={disabled} hint={t("wompiPrivateKeyHint")} />
            <SecretField label={t("wompiEventsSecret")} value={eventsSecret} onChange={setEventsSecret} placeholder={state.webhookConfigured ? "••••••••••••" : (environment === "production" ? "prod_events_..." : "test_events_...")} disabled={disabled} hint={t("wompiEventsSecretHint")} />

            {state.webhookUrl && (
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-violet-500" />{t("wompiWebhookTitle")}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{t("wompiWebhookInstructions")}</p>
                    <div className="mt-3 flex items-center gap-2">
                        <input readOnly value={state.webhookUrl} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs" />
                        <button type="button" onClick={() => void copyWebhook()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted">
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copied ? t("copied") : t("copy")}
                        </button>
                    </div>
                    <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{t("wompiSingleWebhookWarning")}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

function SecretField({ label, value, onChange, placeholder, hint, disabled, secret = true }: {
    label: string; value: string; onChange: (value: string) => void; placeholder: string;
    hint: string; disabled: boolean; secret?: boolean;
}) {
    return (
        <div>
            <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">{label}</label>
            <input type={secret ? "password" : "text"} autoComplete={secret ? "new-password" : "off"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} className="h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm disabled:opacity-60" />
            <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
        </div>
    );
}

function Notice({ icon: Icon, className, children }: { icon: typeof AlertTriangle; className: string; children: React.ReactNode }) {
    return <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-[13px]", className)}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></div>;
}

function StatusPill({ tone, text }: { tone: "green" | "amber" | "indigo"; text: string }) {
    return (
        <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            tone === "green" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            tone === "amber" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
            tone === "indigo" && "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
        )}>{text}</span>
    );
}
