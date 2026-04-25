"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CreditCard, AlertTriangle, Loader2 } from "lucide-react";
import { useMercadoPago } from "@/hooks/useMercadoPago";
import { cn } from "@/lib/utils";

/**
 * PCI-compliant MP card form using mp.fields.create() iframe fields.
 *
 * The 4 sensitive fields (number, expiry, cvv, holder) are hosted by MP
 * inside sandboxed iframes. Parallly's JS never touches the raw card data,
 * which keeps us out of PCI scope. On submit, mp.createCardToken() exchanges
 * the fields for a short-lived card_token_id (~7 minute TTL) that the
 * backend uses to create the MP preapproval.
 *
 * Caller passes onToken — fired once a valid token is produced. Caller is
 * responsible for sending that token to POST /billing/... within 7 minutes.
 */
interface MpCardFormProps {
    onToken: (cardTokenId: string) => void;
    submitting?: boolean;
    submitLabel?: string;
    /** Optional — when provided we auto-call the createCardToken on this click-trigger */
    externalSubmit?: boolean;
}

const FIELD_STYLE = {
    "font-size": "14px",
    "font-family": "Inter, Arial, sans-serif",
    color: "#1f2937",
    placeholderColor: "#9ca3af",
};

export default function MpCardForm({ onToken, submitting = false, submitLabel, externalSubmit = false }: MpCardFormProps) {
    const t = useTranslations("mpCardForm");
    const { mp, ready, error: sdkError } = useMercadoPago();
    const [fieldsReady, setFieldsReady] = useState(false);
    const [fieldsError, setFieldsError] = useState<string | null>(null);
    const [tokenizing, setTokenizing] = useState(false);
    const [cardholderName, setCardholderName] = useState("");
    const [identificationNumber, setIdentificationNumber] = useState("");
    const fieldsRef = useRef<{ number?: any; expiry?: any; cvv?: any }>({});

    useEffect(() => {
        if (!ready || !mp || fieldsReady) return;
        let disposed = false;
        (async () => {
            try {
                const cardNumber = mp.fields.create("cardNumber", {
                    placeholder: "1234 5678 9012 3456",
                    style: FIELD_STYLE,
                });
                const expiry = mp.fields.create("expirationDate", {
                    placeholder: "MM/YY",
                    style: FIELD_STYLE,
                });
                const cvv = mp.fields.create("securityCode", {
                    placeholder: "CVV",
                    style: FIELD_STYLE,
                });
                if (disposed) return;
                await Promise.all([
                    cardNumber.mount("mp-card-number"),
                    expiry.mount("mp-card-expiry"),
                    cvv.mount("mp-card-cvv"),
                ]);
                fieldsRef.current = { number: cardNumber, expiry, cvv };
                setFieldsReady(true);
            } catch (e: any) {
                if (!disposed) setFieldsError(e?.message || "mp_fields_init_failed");
            }
        })();
        return () => {
            disposed = true;
            const f = fieldsRef.current;
            try { f.number?.unmount?.(); f.expiry?.unmount?.(); f.cvv?.unmount?.(); } catch { /* noop */ }
        };
    }, [ready, mp, fieldsReady]);

    const handleTokenize = async () => {
        if (!mp || !fieldsReady || tokenizing) return;
        setFieldsError(null);
        if (!cardholderName.trim() || !identificationNumber.trim()) {
            setFieldsError(t("fillNameAndDoc"));
            return;
        }
        setTokenizing(true);
        try {
            const res = await mp.fields.createCardToken({
                cardholderName: cardholderName.trim(),
                identificationType: "CC",
                identificationNumber: identificationNumber.trim(),
            });
            if (!res?.id) throw new Error("mp_no_token_returned");
            onToken(res.id);
        } catch (e: any) {
            setFieldsError(e?.message || t("tokenizeError"));
        } finally {
            setTokenizing(false);
        }
    };

    useEffect(() => {
        if (externalSubmit) handleTokenize();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalSubmit]);

    if (sdkError === "mp_public_key_missing") {
        return (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-sm text-red-800 dark:text-red-300">
                <AlertTriangle size={16} className="inline mr-2" />
                {t("publicKeyMissing")}
            </div>
        );
    }

    if (!ready) {
        return (
            <div className="flex items-center gap-2 p-4 text-sm text-neutral-500">
                <Loader2 className="animate-spin" size={16} />
                {t("loadingSdk")}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    {t("cardNumber")}
                </label>
                <div id="mp-card-number" className="h-11 px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900" />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                        {t("expiry")}
                    </label>
                    <div id="mp-card-expiry" className="h-11 px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                        {t("cvv")}
                    </label>
                    <div id="mp-card-cvv" className="h-11 px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900" />
                </div>
            </div>

            <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    {t("cardholder")}
                </label>
                <input
                    type="text"
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    placeholder={t("cardholderPlaceholder")}
                    className="w-full h-11 px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900 text-sm"
                />
            </div>

            <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    {t("docNumber")}
                </label>
                <input
                    type="text"
                    value={identificationNumber}
                    onChange={(e) => setIdentificationNumber(e.target.value)}
                    placeholder={t("docPlaceholder")}
                    className="w-full h-11 px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900 text-sm"
                />
            </div>

            {fieldsError && (
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-300">
                    <AlertTriangle size={12} className="inline mr-1" />
                    {fieldsError}
                </div>
            )}

            {!externalSubmit && (
                <button
                    type="button"
                    onClick={handleTokenize}
                    disabled={!fieldsReady || submitting || tokenizing}
                    className={cn(
                        "w-full h-11 rounded-lg text-sm font-semibold text-white transition-all flex items-center justify-center gap-2",
                        fieldsReady && !submitting && !tokenizing
                            ? "bg-indigo-500 hover:bg-indigo-600"
                            : "bg-indigo-300 cursor-not-allowed",
                    )}
                >
                    {tokenizing || submitting ? (
                        <><Loader2 className="animate-spin" size={16} /> {t("processing")}</>
                    ) : (
                        <><CreditCard size={16} /> {submitLabel || t("confirmAndPay")}</>
                    )}
                </button>
            )}

            <p className="text-[11px] text-neutral-500 text-center mt-2">
                <CreditCard size={10} className="inline mr-1" />
                {t("pciNote")}
            </p>
        </div>
    );
}
