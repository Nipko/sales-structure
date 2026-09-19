"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, Check, Loader2, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { isKnownWhatsAppWarning } from "./WhatsAppEmbeddedSignup";
import WhatsAppBillingTimeZone, { type BillingZoneSaved } from "./WhatsAppBillingTimeZone";
import WhatsAppPaymentMethodNotice from "./WhatsAppPaymentMethodNotice";
import { numberSignupWarnings } from "./signup-warnings";
import {
    BILLING_READINESS_ENDPOINT,
    billingTimeZoneOptions,
    billingZoneNumberLabel,
    billingZoneStateFor,
    readBillingZoneReadiness,
    type BillingZoneAccess,
    type BillingZoneReadiness,
    type BillingZoneState,
} from "./billing-time-zone";
import {
    connectedNumberId,
    connectedReadiness,
    isSignupPending,
    paymentVerdict,
    preselectBusinessZone,
    readFundingFor,
    readTenantTimeZone,
    withSavedZone,
    type ConnectedReadiness,
    type FundingReading,
    type WhatsAppConnectedPayload,
} from "./connected-readiness";

/**
 * A number whose signup just finished is listed by the readiness read a moment
 * later on a slow write. One quiet second look, instead of greeting a brand-new
 * connection with "we could not check".
 */
const NOT_LISTED_RETRY_MS = 2000;

/** Carries, per connected number, what its signup left open (`signupWarnings`). */
const WHATSAPP_STATUS_ENDPOINT = "/channels/whatsapp/status";

/**
 * What the day-0 wizard shows once WhatsApp is connected.
 *
 * "¡Conectado! Tu agente ya responde ahí" is said only when it is true: the
 * number holds a billing time zone, the signup left nothing open that stops
 * messages, and nothing known stops Meta from delivering (`connectedReadiness`).
 * Otherwise the owner reads what is left —
 * the zone, preselected with her business's own so it is one tap; the payment
 * method on her WhatsApp account, which Meta charges and we do not — and can
 * still continue: nothing here blocks the wizard.
 */
export default function WhatsAppConnectedState({
    connected,
    access,
    canCheckFunding,
    onAcknowledged,
    now,
}: {
    connected: WhatsAppConnectedPayload;
    access: BillingZoneAccess;
    /** Whether this person may ask Meta about the payment method (admins only). */
    canCheckFunding: boolean;
    /** Continue. Carries what is still pending so the next screen does not overclaim. */
    onAcknowledged?: (readiness: ConnectedReadiness) => void;
    /** The clock, for the 1-October copy. Tests pin it. */
    now?: number;
}) {
    const tw = useTranslations("channels.whatsapp");
    const twn = useTranslations("channels.whatsapp.warnings");
    const ta = useTranslations("channels.whatsapp.afterConnect");
    const t = useTranslations("setupWizard.connect");

    // `undefined` = the first read is still out. `null` = we could not ask.
    const [zones, setZones] = useState<BillingZoneReadiness | null | undefined>(undefined);
    const [businessZone, setBusinessZone] = useState<string | null>(null);
    const [funding, setFunding] = useState<FundingReading | undefined>(undefined);
    const [firstCheck, setFirstCheck] = useState(false);
    const [rechecking, setRechecking] = useState(false);
    const [savedNotice, setSavedNotice] = useState<string | null>(null);
    // What the number's signup left open, as the server persisted it — read
    // only when the caller did not bring the warnings (a number connected
    // before this page, a payload rebuilt after a reload). `undefined` = not
    // known, which claims nothing either way.
    const [persistedWarnings, setPersistedWarnings] = useState<string[] | undefined>(undefined);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const numberId = useMemo(() => connectedNumberId(connected, zones), [connected, zones]);
    const options = useMemo(() => billingTimeZoneOptions(), []);
    const clock = now ?? Date.now();

    const readZones = useCallback(async () => (
        readBillingZoneReadiness(await api.fetch(BILLING_READINESS_ENDPOINT).catch(() => null))
    ), []);

    const readFunding = useCallback(async (id: string | null) => (
        readFundingFor(await api.getWhatsappFundingReadiness().catch(() => null), id)
    ), []);

    /** Ask Meta, then read what it said. A failed ask is "not established", never "no card". */
    const askMeta = useCallback(async (id: string) => {
        await api.checkWhatsappFunding(id).catch(() => null);
        return readFunding(id);
    }, [readFunding]);

    useEffect(() => {
        let cancelled = false;
        let retry: ReturnType<typeof setTimeout> | undefined;

        (async () => {
            // Read together and set together: the zone picker takes its
            // preselection when it mounts, so the business zone must be known
            // in the same render that first shows a missing zone.
            const [readiness, tenantZone, fundingRes, statusRes] = await Promise.all([
                readZones(),
                api.getTenantTimezone().then(readTenantTimeZone).catch(() => null),
                api.getWhatsappFundingReadiness().catch(() => null),
                connected.warnings === undefined
                    ? api.fetch(WHATSAPP_STATUS_ENDPOINT).catch(() => null)
                    : Promise.resolve(null),
            ]);
            if (cancelled) return;
            const id = connectedNumberId(connected, readiness);
            if (connected.warnings === undefined) setPersistedWarnings(numberSignupWarnings(statusRes, id));
            const reading = readFundingFor(fundingRes, id);
            // Nobody has asked Meta about a number connected a minute ago. Ask
            // once, for an admin: the answer is what this screen is for.
            const ask = Boolean(id) && canCheckFunding && reading.kind === "read" && reading.state === "not_checked";
            setZones(readiness);
            setBusinessZone(tenantZone);
            setFunding(reading);
            setFirstCheck(ask);

            if (readiness && id && !readiness.numbers.some((number) => number.phoneNumberId === id)) {
                retry = setTimeout(() => {
                    void Promise.all([readZones(), readFunding(id)]).then(([again, fundingAgain]) => {
                        if (cancelled) return;
                        if (again) setZones(again);
                        setFunding((current) => (current?.kind === "unreadable" ? fundingAgain : current));
                    });
                }, NOT_LISTED_RETRY_MS);
            }

            if (ask && id) {
                const checked = await askMeta(id);
                if (cancelled) return;
                setFunding(checked);
                setFirstCheck(false);
            }
        })();

        return () => {
            cancelled = true;
            if (retry) clearTimeout(retry);
        };
        // One reading per connection. `connected` is the payload of THIS
        // signup; re-reading on every parent render would re-ask Meta.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const retryZones = useCallback(() => {
        void readZones().then((readiness) => { if (mounted.current) setZones(readiness); });
    }, [readZones]);

    const recheck = useCallback(async () => {
        if (!numberId) return;
        setRechecking(true);
        try {
            const checked = await askMeta(numberId);
            if (mounted.current) setFunding(checked);
        } finally {
            if (mounted.current) setRechecking(false);
        }
    }, [askMeta, numberId]);

    const numberLabel = connected.displayPhoneNumber
        || (numberId ? billingZoneNumberLabel(numberId, [], zones ?? null) : "");

    const handleZoneSaved = useCallback(async (saved: BillingZoneSaved) => {
        setSavedNotice(tw("billingZone.saved", { number: numberLabel || saved.phoneNumberId, zone: saved.timeZone }));
        setZones((current) => withSavedZone(current, saved));
        const fresh = await readZones();
        if (mounted.current && fresh) setZones(fresh);
    }, [numberLabel, readZones, tw]);

    const rawZone: BillingZoneState | undefined = zones === undefined ? undefined : billingZoneStateFor(numberId ?? "", zones);
    const preselected = rawZone ? preselectBusinessZone(rawZone, businessZone, options) : null;
    const zoneState = preselected?.state;
    const verdict = firstCheck ? "checking" : paymentVerdict(funding);
    // The signup's own warnings count too: a webhook subscription Meta did not
    // confirm, or a number it has not registered, stops every reply however
    // the zone and the card read. The ones this page's signup answered, else
    // the ones the server kept for this number.
    const signupWarnings = connected.warnings ?? persistedWarnings;
    const readiness = connectedReadiness({ zone: zoneState, payment: verdict, now: clock, warnings: signupWarnings });
    const signupBlocksReplies = readiness.pending.some(isSignupPending);

    const warnings = signupWarnings ?? [];
    const digits = (connected.displayPhoneNumber || "").replace(/[^0-9]/g, "");
    const phone = connected.displayPhoneNumber || "";
    const zoneMissing = zoneState?.kind === "missing";

    return (
        <div className="space-y-3">
            {warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-5">
                    <div className="flex items-start gap-2.5">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{twn("title")}</p>
                            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{twn("subtitle")}</p>
                            <ul className="mt-3 space-y-2">
                                {warnings.map((warning) => (
                                    <li key={warning} className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                                        • {isKnownWhatsAppWarning(warning) ? twn(`codes.${warning}`) : warning}
                                    </li>
                                ))}
                            </ul>
                            {signupBlocksReplies && (
                                <p className="mt-3 text-xs font-semibold text-amber-900 dark:text-amber-200">{ta("signupBlocksReplies")}</p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div role="status" data-headline={readiness.headline}>
                    {readiness.headline === "ready" ? (
                        <div className="rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-5 text-center">
                            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center mb-3">
                                <Check size={24} aria-hidden="true" />
                            </div>
                            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t("connected")}</p>
                            <p className="text-xs text-emerald-700 dark:text-emerald-400/80 mt-1">
                                {t("connectedDesc", { phone })}
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-5">
                            <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                                    {readiness.headline === "checking"
                                        ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                                        : <Check size={18} aria-hidden="true" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-foreground">
                                        {readiness.headline === "checking"
                                            ? ta("checkingTitle", { phone })
                                            : readiness.headline === "zone_unknown"
                                                ? ta("zoneUnknownTitle", { phone })
                                                : ta("pendingTitle", { phone })}
                                    </p>
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                        {readiness.headline === "checking" && ta("checkingDesc")}
                                        {readiness.headline === "needs_zone" && ta("needsZoneDesc")}
                                        {readiness.headline === "zone_unknown" && ta("zoneUnknownDesc")}
                                        {readiness.headline === "needs_payment" && ta("needsPaymentDesc")}
                                        {readiness.headline === "payment_restricted" && ta("restrictedDesc")}
                                        {readiness.headline === "signup_pending" && ta("signupBlocksReplies")}
                                    </p>
                                    {readiness.headline === "needs_zone" && preselected?.fromBusiness && access === "form" && (
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                            {ta("needsZoneSuggested", { zone: preselected.fromBusiness })}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {zoneState && (
                <WhatsAppBillingTimeZone
                    // Remount when the starting value changes: the picker reads
                    // its preselection once, when it mounts.
                    key={`${numberId ?? "unknown"}:${zoneState.kind === "missing" ? zoneState.suggestion ?? "" : zoneState.kind}`}
                    phoneNumberId={numberId ?? ""}
                    numberLabel={numberLabel}
                    state={zoneState}
                    access={access}
                    onSaved={handleZoneSaved}
                    onRetry={retryZones}
                />
            )}
            {savedNotice && (
                <p role="status" className="m-0 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Check size={14} aria-hidden="true" /> {savedNotice}
                </p>
            )}

            <WhatsAppPaymentMethodNotice
                verdict={verdict}
                now={clock}
                rechecking={rechecking}
                onRecheck={canCheckFunding && numberId ? () => { void recheck(); } : undefined}
            />

            {/* El cierre del bucle: mandarse un mensaje y verlo responder. Con la
                zona sin confirmar esa prueba no puede salir bien, así que en su
                lugar se dice qué falta. */}
            <div
                id={guidedTourAnchorId("whatsapp-test")}
                className="rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-white dark:bg-white/[0.04] p-4 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
                <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <MessageSquare size={18} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{tw("testAgentTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{tw("testAgentDesc", { number: phone })}</p>
                    {zoneMissing && (
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mt-1">{ta("testAfterZone")}</p>
                    )}
                </div>
                {digits && !zoneMissing && (
                    <a
                        href={`https://wa.me/${digits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                    >
                        {tw("testAgentCta")} <ArrowRight size={14} aria-hidden="true" />
                        <span className="sr-only">({ta("opensInNewTab")})</span>
                    </a>
                )}
            </div>

            {onAcknowledged && (
                <div className="space-y-1.5">
                    <button
                        type="button"
                        onClick={() => onAcknowledged(readiness)}
                        className={cn(
                            "w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-6 py-2.5 text-sm font-semibold transition-colors cursor-pointer",
                            readiness.answering
                                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                                : "border border-neutral-300 text-foreground hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/5",
                        )}
                    >
                        {t("continue")} <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    {/* "Terminar esto después en Canales → WhatsApp" is for the zone
                        and the card. What the signup left open is fixed with
                        Meta or with us, as the card above says. */}
                    {!readiness.answering && readiness.headline !== "checking" && readiness.headline !== "signup_pending" && (
                        <p className="m-0 text-center text-[12px] text-muted-foreground">{ta("continueLater")}</p>
                    )}
                </div>
            )}
        </div>
    );
}
