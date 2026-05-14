"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CreditCard, AlertTriangle, Loader2 } from "lucide-react";
import { useMercadoPago } from "@/hooks/useMercadoPago";
import { cn } from "@/lib/utils";

interface MpCardFormProps {
    onToken: (cardTokenId: string) => void;
    submitting?: boolean;
    submitLabel?: string;
    externalSubmit?: boolean;
}

export default function MpCardForm({ onToken, submitting = false, submitLabel, externalSubmit = false }: MpCardFormProps) {
    const t = useTranslations("mpCardForm");
    const { mp, ready, error: sdkError } = useMercadoPago();
    const [fieldsReady, setFieldsReady] = useState(false);
    const [fieldsError, setFieldsError] = useState<string | null>(null);
    const [tokenizing, setTokenizing] = useState(false);
    const cardFormRef = useRef<any>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useEffect(() => {
        if (!ready || !mp || cardFormRef.current) return;
        let disposed = false;

        const timerId = setTimeout(() => {
            if (disposed) return;
            try {
                const cf = mp.cardForm({
                    amount: "100",
                    iframe: true,
                    form: {
                        id: "mp-card-form",
                        cardNumber: {
                            id: "mp-card-number",
                            placeholder: "1234 5678 9012 3456",
                        },
                        expirationDate: {
                            id: "mp-card-expiry",
                            placeholder: "MM/YY",
                        },
                        securityCode: {
                            id: "mp-card-cvv",
                            placeholder: "CVV",
                        },
                        cardholderName: {
                            id: "mp-cardholder-name",
                        },
                        identificationType: {
                            id: "mp-id-type",
                        },
                        identificationNumber: {
                            id: "mp-id-number",
                        },
                    },
                    callbacks: {
                        onFormMounted: (error: any) => {
                            if (disposed) return;
                            if (error) {
                                console.warn("[MpCardForm] mount error:", error);
                                setFieldsError(typeof error === "string" ? error : error?.message || "mount_error");
                            } else {
                                setFieldsReady(true);
                            }
                        },
                        onSubmit: (event: Event) => {
                            event.preventDefault();
                            if (disposed || !cardFormRef.current) return;
                            setTokenizing(true);
                            setFieldsError(null);
                            try {
                                const data = cardFormRef.current.getCardFormData();
                                if (data?.token) {
                                    onTokenRef.current(data.token);
                                } else {
                                    setFieldsError("No se pudo generar el token de la tarjeta.");
                                }
                            } catch (e: any) {
                                setFieldsError(e?.message || "tokenize_error");
                            } finally {
                                setTokenizing(false);
                            }
                        },
                        onFetching: (resource: string) => {
                            if (!disposed) setTokenizing(true);
                            return () => { if (!disposed) setTokenizing(false); };
                        },
                    },
                });
                cardFormRef.current = cf;
            } catch (e: any) {
                console.error("[MpCardForm] cardForm init error:", e);
                if (!disposed) setFieldsError(e?.message || "mp_cardform_init_failed");
            }
        }, 200);

        return () => {
            disposed = true;
            clearTimeout(timerId);
            try { cardFormRef.current?.unmount?.(); } catch { /* noop */ }
            cardFormRef.current = null;
            setFieldsReady(false);
        };
    }, [ready, mp]);

    useEffect(() => {
        if (externalSubmit && formRef.current && fieldsReady) {
            formRef.current.requestSubmit();
        }
    }, [externalSubmit, fieldsReady]);

    if (sdkError) {
        return (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-sm text-red-800 dark:text-red-300">
                <AlertTriangle size={16} className="inline mr-2" />
                {sdkError === "mp_public_key_missing" ? t("publicKeyMissing") : `SDK error: ${sdkError}`}
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

    return (
        <form id="mp-card-form" ref={formRef} className="space-y-3">
            {fieldsError && (
                <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle size={12} className="inline mr-1" />
                    {fieldsError}
                </div>
            )}

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
                    id="mp-cardholder-name"
                    type="text"
                    placeholder={t("cardholderPlaceholder")}
                    className={inputCls}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                        {t("docType")}
                    </label>
                    <select id="mp-id-type" className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                        {t("docNumber")}
                    </label>
                    <input
                        id="mp-id-number"
                        type="text"
                        placeholder={t("docPlaceholder")}
                        className={inputCls}
                    />
                </div>
            </div>

            {!externalSubmit && (
                <button
                    type="submit"
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
        </form>
    );
}
