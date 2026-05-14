"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { CreditCard, AlertTriangle, Loader2 } from "lucide-react";
import {
    initMercadoPago,
    CardNumber,
    SecurityCode,
    ExpirationDate,
    createCardToken,
    getIdentificationTypes,
} from "@mercadopago/sdk-react";
import { cn } from "@/lib/utils";

interface MpCardFormProps {
    onToken: (cardTokenId: string) => void;
    submitting?: boolean;
    submitLabel?: string;
    externalSubmit?: boolean;
}

const MP_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
let mpInitDone = false;

function ensureInit() {
    if (!mpInitDone && MP_KEY) {
        initMercadoPago(MP_KEY, { locale: "es-CO" });
        mpInitDone = true;
    }
}

export default function MpCardForm({ onToken, submitting = false, submitLabel, externalSubmit = false }: MpCardFormProps) {
    const t = useTranslations("mpCardForm");
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    const [cardholderName, setCardholderName] = useState("");
    const [identificationType, setIdentificationType] = useState("");
    const [identificationNumber, setIdentificationNumber] = useState("");
    const [idTypes, setIdTypes] = useState<{ id: string; name: string }[]>([]);
    const [tokenizing, setTokenizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    const fieldStyle = useMemo(() => ({
        height: "100%",
        "font-size": "14px",
        "font-family": "Inter, system-ui, sans-serif",
        padding: "0 12px",
        color: isDark ? "#f5f5f5" : "#171717",
        "placeholder-color": isDark ? "#737373" : "#a3a3a3",
    }), [isDark]);

    useEffect(() => {
        if (!MP_KEY) {
            setError("mp_public_key_missing");
            return;
        }
        ensureInit();
        setReady(true);

        getIdentificationTypes().then((types: any) => {
            if (types?.length) {
                setIdTypes(types);
                setIdentificationType(types[0].id);
            }
        }).catch(() => {});
    }, []);

    const handleTokenize = async () => {
        if (tokenizing || submitting) return;
        setError(null);

        if (!cardholderName.trim()) {
            setError(t("fillNameAndDoc"));
            return;
        }

        setTokenizing(true);
        try {
            const token = await createCardToken({
                cardholderName: cardholderName.trim(),
                ...(identificationType && identificationNumber.trim()
                    ? { identificationType, identificationNumber: identificationNumber.trim() }
                    : {}),
            });
            if (token?.id) {
                onToken(token.id);
            } else {
                setError(t("tokenizeError"));
            }
        } catch (e: any) {
            console.error("[MpCardForm] tokenize error:", e);
            setError(e?.message || e?.[0]?.message || t("tokenizeError"));
        } finally {
            setTokenizing(false);
        }
    };

    useEffect(() => {
        if (externalSubmit) handleTokenize();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalSubmit]);

    if (!MP_KEY) {
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

    const inputCls = "w-full h-11 px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100";
    const iframeCls = "h-11 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-hidden [&_div]:!h-full [&_iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!border-none";

    return (
        <div className="space-y-3">
            {error && error !== "mp_public_key_missing" && (
                <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle size={12} className="inline mr-1" />
                    {error}
                </div>
            )}

            <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    {t("cardNumber")}
                </label>
                <div className={iframeCls}>
                    <CardNumber placeholder="1234 5678 9012 3456" style={fieldStyle} />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                        {t("expiry")}
                    </label>
                    <div className={iframeCls}>
                        <ExpirationDate placeholder="MM/YY" style={fieldStyle} />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                        {t("cvv")}
                    </label>
                    <div className={iframeCls}>
                        <SecurityCode placeholder="CVV" style={fieldStyle} />
                    </div>
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
                    className={inputCls}
                />
            </div>

            {idTypes.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                            {t("docType")}
                        </label>
                        <select
                            value={identificationType}
                            onChange={(e) => setIdentificationType(e.target.value)}
                            className={inputCls}
                        >
                            {idTypes.map((type) => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </select>
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
                            className={inputCls}
                        />
                    </div>
                </div>
            )}

            {!externalSubmit && (
                <button
                    type="button"
                    onClick={handleTokenize}
                    disabled={submitting || tokenizing}
                    className={cn(
                        "w-full h-11 rounded-lg text-sm font-semibold text-white transition-all flex items-center justify-center gap-2",
                        !submitting && !tokenizing
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
