"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { api, type BillingPublicConfig, type PaymentProviderName, type PaymentSourceStatus } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton-loader";
import MpCardForm from "./MpCardForm";
import WompiPaymentForm from "./WompiPaymentForm";

/**
 * Operators whose checkout stores a reusable payment source through our API,
 * instead of handing the page a single-use token for the billing endpoints.
 *
 * The distinction is what the caller must do next — resume with the stored
 * method (no token) or pass the token along — so it belongs next to the
 * dispatcher that decides which form renders.
 */
export function usesStoredPaymentSources(provider: PaymentProviderName | undefined): boolean {
    return provider === "wompi";
}

interface PaymentFormProps {
    tenantId: string;
    /** Billing country of the tenant; the routing resolves the operator from it. */
    country?: string;
    /** Token path (MercadoPago): the billing endpoints consume this `cardTokenId`. */
    onToken: (cardTokenId: string) => void;
    /** Stored-source path (Wompi): the API already persisted the method. */
    onSourceSaved: (source: { id: string; status: PaymentSourceStatus }) => void;
    submitting?: boolean;
    submitLabel?: string;
    /** Config the page already resolved; avoids a second request. */
    config?: BillingPublicConfig | null;
}

/**
 * Renders the checkout form of whichever operator bills this tenant.
 *
 * The provider and its publishable key come from `GET /billing/public/config`
 * at request time — never from `NEXT_PUBLIC_*`, which is frozen into the bundle
 * at build time and could not follow a runtime operator switch.
 */
export default function PaymentForm({
    tenantId,
    country,
    onToken,
    onSourceSaved,
    submitting = false,
    submitLabel,
    config: providedConfig = null,
}: PaymentFormProps) {
    const t = useTranslations("paymentForm");
    const [config, setConfig] = useState<BillingPublicConfig | null>(providedConfig);
    const [loading, setLoading] = useState(!providedConfig);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (providedConfig) {
            setConfig(providedConfig);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        api.getBillingPublicConfig(country)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) setConfig(res.data);
                else setFailed(true);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [providedConfig, country]);

    if (loading) {
        return (
            <div className="space-y-3" aria-busy="true" aria-label={t("loading")}>
                <Skeleton className="h-11 w-full rounded-lg" />
                <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                </div>
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
            </div>
        );
    }

    if (failed || !config) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {t("configError")}
            </div>
        );
    }

    if (config.provider === "mercadopago") {
        return <MpCardForm onToken={onToken} submitting={submitting} submitLabel={submitLabel} />;
    }

    if (config.provider === "wompi") {
        return (
            <WompiPaymentForm
                tenantId={tenantId}
                config={config}
                onSaved={onSourceSaved}
                submitLabel={submitLabel}
                busy={submitting}
            />
        );
    }

    return (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {t("unsupportedProvider", { provider: config.provider })}
        </div>
    );
}
