"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, Loader2, Smartphone } from "lucide-react";
import {
    api,
    type BillingPublicConfig,
    type PaymentAcceptanceContracts,
    type PaymentSourceKind,
    type PaymentSourceStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface WompiPaymentFormProps {
    tenantId: string;
    /** Runtime checkout contract (provider, publishable key, enabled methods). */
    config: BillingPublicConfig;
    onSaved: (source: { id: string; status: PaymentSourceStatus }) => void;
    submitLabel?: string;
    /** The page is running the action the saved method unlocks. */
    busy?: boolean;
}

const API_BY_ENVIRONMENT: Record<string, string> = {
    sandbox: "https://sandbox.wompi.co/v1",
    production: "https://production.wompi.co/v1",
};

/** Method flags of the operator switch → the `kind` the API stores. */
const KIND_BY_METHOD_FLAG: Record<string, PaymentSourceKind> = {
    card: "card",
    nequi: "nequi",
    bancolombiaTransfer: "bancolombia_transfer",
};

/** Methods this form can tokenize from the browser. */
const TOKENIZABLE_KINDS: PaymentSourceKind[] = ["card", "nequi"];

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 40; // ~2 minutes

type Phase = "form" | "tokenizing" | "saving" | "awaiting_auth" | "timeout" | "saved";

function groupCardDigits(value: string): string {
    return value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Wompi checkout: turns the customer's instrument into a reusable payment source.
 *
 * The card is tokenized by the BROWSER against Wompi with the publishable key
 * and only the resulting token is posted to our API. Letting a PAN reach our
 * backend would drag the whole platform into PCI scope and Wompi forbids it
 * outright, so there is deliberately no code path that sends card fields home.
 */
export default function WompiPaymentForm({
    tenantId,
    config,
    onSaved,
    submitLabel,
    busy = false,
}: WompiPaymentFormProps) {
    const t = useTranslations("wompiForm");

    const availableKinds = useMemo(() => {
        const kinds = config.methods
            .map((flag) => KIND_BY_METHOD_FLAG[flag])
            .filter((kind): kind is PaymentSourceKind => !!kind);
        return kinds.length ? kinds : (["card"] as PaymentSourceKind[]);
    }, [config.methods]);

    const supportedKinds = useMemo(
        () => availableKinds.filter((kind) => TOKENIZABLE_KINDS.includes(kind)),
        [availableKinds],
    );
    const hasUnsupportedKinds = availableKinds.length > supportedKinds.length;

    const [kind, setKind] = useState<PaymentSourceKind>(supportedKinds[0] ?? "card");
    const [cardNumber, setCardNumber] = useState("");
    const [expiry, setExpiry] = useState("");
    const [cvc, setCvc] = useState("");
    const [holder, setHolder] = useState("");
    const [phone, setPhone] = useState("");

    const [acceptance, setAcceptance] = useState<PaymentAcceptanceContracts | null>(null);
    const [acceptanceLoading, setAcceptanceLoading] = useState(true);
    const [acceptedPolicy, setAcceptedPolicy] = useState(false);
    const [acceptedPersonalData, setAcceptedPersonalData] = useState(false);

    const [phase, setPhase] = useState<Phase>("form");
    const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
    // i18n key, resolved at render so the loader never depends on the translator.
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [errorDetail, setErrorDetail] = useState<string | null>(null);

    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (!supportedKinds.includes(kind)) setKind(supportedKinds[0] ?? "card");
    }, [supportedKinds, kind]);

    useEffect(() => {
        let cancelled = false;
        setAcceptanceLoading(true);
        api.getPaymentAcceptance(tenantId)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) setAcceptance(res.data);
                else setErrorKey("errors.acceptanceUnavailable");
            })
            .catch(() => { if (!cancelled) setErrorKey("errors.acceptanceUnavailable"); })
            .finally(() => { if (!cancelled) setAcceptanceLoading(false); });
        return () => { cancelled = true; };
    }, [tenantId]);

    const baseUrl = config.environment ? API_BY_ENVIRONMENT[config.environment] : undefined;

    // Both contracts are a legal requirement in Colombia (habeas data): storing a
    // payment method without explicit, separate consent to each one is not a UX
    // shortcut, it is an unlawful collection.
    const consentComplete = !!acceptance
        && acceptedPolicy
        && (!acceptance.personalDataAuth || acceptedPersonalData);

    const fail = useCallback((key: string, detail?: string) => {
        setErrorKey(key);
        setErrorDetail(detail ?? null);
        setPhase("form");
    }, []);

    /** Mints a single-use token with the publishable key — card data goes straight to Wompi. */
    const tokenize = useCallback(async (): Promise<string | null> => {
        if (!baseUrl || !config.publicKey) {
            fail("errors.publicKeyMissing");
            return null;
        }

        let path: string;
        let body: Record<string, string>;

        if (kind === "card") {
            const number = cardNumber.replace(/\D/g, "");
            if (number.length < 13 || number.length > 19) { fail("errors.invalidCard"); return null; }
            const match = expiry.replace(/\s/g, "").match(/^(\d{2})\/?(\d{2})$/);
            if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) { fail("errors.invalidExpiry"); return null; }
            if (!/^\d{3,4}$/.test(cvc)) { fail("errors.invalidCvv"); return null; }
            if (holder.trim().length < 3) { fail("errors.invalidHolder"); return null; }
            path = "/tokens/cards";
            body = {
                number,
                cvc,
                exp_month: match[1],
                exp_year: match[2],
                card_holder: holder.trim(),
            };
        } else {
            const digits = phone.replace(/\D/g, "");
            if (digits.length !== 10) { fail("errors.invalidPhone"); return null; }
            path = "/tokens/nequi";
            body = { phone_number: digits };
        }

        try {
            const res = await fetch(`${baseUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.publicKey}`,
                },
                body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => null);
            const token = json?.data?.id;
            if (!res.ok || !token) {
                // Never echo the request back into logs or the UI: it holds the PAN.
                fail("errors.tokenizeFailed", json?.error?.reason || json?.error?.type);
                return null;
            }
            return String(token);
        } catch {
            fail("errors.tokenizeFailed");
            return null;
        }
    }, [baseUrl, config.publicKey, kind, cardNumber, expiry, cvc, holder, phone, fail]);

    /** Wallets are approved in the customer's own app; nothing is chargeable until then. */
    const waitForAuthorization = useCallback(async (sourceId: string) => {
        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            if (!mounted.current) return;
            const res = await api.getPaymentSourceStatus(tenantId, sourceId);
            const status = res.data?.status;
            if (status === "available") {
                setPhase("saved");
                onSaved({ id: sourceId, status });
                return;
            }
            if (status === "declined" || status === "voided" || status === "error") {
                fail("errors.declined");
                return;
            }
        }
        if (mounted.current) setPhase("timeout");
    }, [tenantId, onSaved, fail]);

    const handleSubmit = async () => {
        if (phase !== "form" || busy || !consentComplete) return;
        setErrorKey(null);
        setErrorDetail(null);
        setPhase("tokenizing");

        const token = await tokenize();
        if (!token || !mounted.current) return;

        setPhase("saving");
        const res = await api.addPaymentSource(tenantId, { kind, token, makeDefault: true });
        if (!mounted.current) return;
        if (!res.success || !res.data) {
            fail("errors.saveFailed", res.error);
            return;
        }

        const { id, status, requiresAuthorization, authorizationUrl: url } = res.data;
        if (status === "declined" || status === "error") {
            fail("errors.declined");
            return;
        }
        if (requiresAuthorization) {
            setAuthorizationUrl(url ?? null);
            setPhase("awaiting_auth");
            void waitForAuthorization(id);
            return;
        }
        setPhase("saved");
        onSaved({ id, status });
    };

    const inputCls = "w-full h-11 px-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30";
    const labelCls = "block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1";
    const errorText = errorKey ? t(errorKey) : null;

    if (acceptanceLoading) {
        return (
            <div className="flex items-center gap-2 p-4 text-sm text-neutral-500 dark:text-neutral-400">
                <Loader2 className="animate-spin" size={16} /> {t("loading")}
            </div>
        );
    }

    // Every enabled method needs a flow the browser can complete; offering a form
    // for one we cannot tokenize would only produce a rejected save.
    if (!supportedKinds.length) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {t("methodUnsupportedNote")}
            </div>
        );
    }

    if (phase === "awaiting_auth" || phase === "timeout") {
        return (
            <div className="space-y-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    <p className="flex items-center gap-2 font-semibold">
                        {phase === "awaiting_auth"
                            ? <><Loader2 size={15} className="animate-spin" /> {t("pendingAuthTitle")}</>
                            : <><AlertTriangle size={15} /> {t("pendingTimeoutTitle")}</>}
                    </p>
                    <p className="mt-1">
                        {phase === "awaiting_auth" ? t("pendingAuthHint") : t("pendingTimeoutHint")}
                    </p>
                    {authorizationUrl && (
                        <a
                            href={authorizationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline"
                        >
                            <ExternalLink size={12} /> {t("pendingAuthLink")}
                        </a>
                    )}
                </div>
            </div>
        );
    }

    if (phase === "saved") {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 size={16} /> {t("saved")}
            </div>
        );
    }

    const working = phase === "tokenizing" || phase === "saving" || busy;

    return (
        <div className="space-y-3">
            {config.environment === "sandbox" && (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
                    {t("sandboxNotice")}
                </p>
            )}

            {errorText && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                    <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> {errorText}</span>
                    {errorDetail && <span className="mt-1 block font-mono text-[11px] opacity-80">{errorDetail}</span>}
                </div>
            )}

            {supportedKinds.length > 1 && (
                <div>
                    <span className={labelCls}>{t("methodLabel")}</span>
                    <div className="flex flex-wrap gap-2">
                        {supportedKinds.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setKind(option)}
                                aria-pressed={kind === option}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                                    kind === option
                                        ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
                                        : "border-neutral-200 text-neutral-600 hover:border-indigo-300 dark:border-neutral-700 dark:text-neutral-300",
                                )}
                            >
                                {option === "card" ? <CreditCard size={13} /> : <Smartphone size={13} />}
                                {t(`methods.${option}`)}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {hasUnsupportedKinds && (
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{t("methodUnsupportedNote")}</p>
            )}

            {kind === "card" ? (
                <>
                    <div>
                        <label className={labelCls} htmlFor="wompi-card-number">{t("cardNumber")}</label>
                        <input
                            id="wompi-card-number"
                            inputMode="numeric"
                            autoComplete="cc-number"
                            value={cardNumber}
                            onChange={(e) => setCardNumber(groupCardDigits(e.target.value))}
                            placeholder="4242 4242 4242 4242"
                            className={inputCls}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls} htmlFor="wompi-card-expiry">{t("expiry")}</label>
                            <input
                                id="wompi-card-expiry"
                                inputMode="numeric"
                                autoComplete="cc-exp"
                                value={expiry}
                                onChange={(e) => {
                                    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                                    setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
                                }}
                                placeholder={t("expiryPlaceholder")}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label className={labelCls} htmlFor="wompi-card-cvc">{t("cvv")}</label>
                            <input
                                id="wompi-card-cvc"
                                inputMode="numeric"
                                autoComplete="cc-csc"
                                value={cvc}
                                onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                placeholder="123"
                                className={inputCls}
                            />
                        </div>
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="wompi-card-holder">{t("cardholder")}</label>
                        <input
                            id="wompi-card-holder"
                            autoComplete="cc-name"
                            value={holder}
                            onChange={(e) => setHolder(e.target.value)}
                            placeholder={t("cardholderPlaceholder")}
                            className={inputCls}
                        />
                    </div>
                </>
            ) : (
                <div>
                    <label className={labelCls} htmlFor="wompi-nequi-phone">{t("nequiPhone")}</label>
                    <input
                        id="wompi-nequi-phone"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        placeholder="3001234567"
                        className={inputCls}
                    />
                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{t("nequiHint")}</p>
                </div>
            )}

            <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t("acceptTitle")}</p>
                {acceptance && (
                    <>
                        <label className="flex items-start gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                            <input
                                type="checkbox"
                                checked={acceptedPolicy}
                                onChange={(e) => setAcceptedPolicy(e.target.checked)}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500/30 dark:border-neutral-600"
                            />
                            <span>
                                {t("acceptEndUserPolicy")}{" "}
                                <a
                                    href={acceptance.endUserPolicy.permalink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline dark:text-indigo-400"
                                >
                                    {t("viewContract")} <ExternalLink size={10} />
                                </a>
                            </span>
                        </label>
                        {acceptance.personalDataAuth && (
                            <label className="flex items-start gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                                <input
                                    type="checkbox"
                                    checked={acceptedPersonalData}
                                    onChange={(e) => setAcceptedPersonalData(e.target.checked)}
                                    className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500/30 dark:border-neutral-600"
                                />
                                <span>
                                    {t("acceptPersonalData")}{" "}
                                    <a
                                        href={acceptance.personalDataAuth.permalink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-0.5 font-medium text-indigo-600 underline dark:text-indigo-400"
                                    >
                                        {t("viewContract")} <ExternalLink size={10} />
                                    </a>
                                </span>
                            </label>
                        )}
                    </>
                )}
            </div>

            <button
                type="button"
                onClick={handleSubmit}
                disabled={working || !consentComplete}
                className={cn(
                    "flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition-colors",
                    !working && consentComplete ? "bg-indigo-500 hover:bg-indigo-600" : "cursor-not-allowed bg-indigo-300 dark:bg-indigo-500/40",
                )}
            >
                {working
                    ? <><Loader2 className="animate-spin" size={16} /> {t("processing")}</>
                    : <><CreditCard size={16} /> {submitLabel || t("save")}</>}
            </button>

            {!consentComplete && (
                <p className="text-center text-[11px] text-neutral-500 dark:text-neutral-400">{t("acceptRequired")}</p>
            )}

            <p className="text-center text-[11px] text-neutral-500 dark:text-neutral-400">{t("pciNote")}</p>
        </div>
    );
}
