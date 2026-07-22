"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Receipt, X } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

/**
 * Proactive reminder for tenants in a DIAN country (Colombia) whose tax profile
 * is incomplete. Closes the "existing tenants never load their NIT" gap: the
 * billing gate only fires when the tenant initiates a charge, so this nudges
 * them to complete it before their next renewal (whose DIAN invoice would fail).
 * `required`/`complete` come from the backend (GET /fiscal/:id/data), so the
 * banner agrees with the gate. Dismissible for the session.
 */
export function FiscalBanner() {
    const t = useTranslations("fiscalGate");
    const { activeTenantId } = useTenant();
    const { user } = useAuth();
    const tenantId = activeTenantId || user?.tenantId;
    const [show, setShow] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!tenantId) return;
        if (typeof window !== "undefined" && sessionStorage.getItem(`fiscalBannerDismissed:${tenantId}`) === "1") {
            setDismissed(true);
            return;
        }
        let active = true;
        api.getFiscalData(tenantId)
            .then((r) => {
                if (!active || !r?.success) return;
                const d = r.data as any;
                setShow(!!d?.required && !d?.complete && !d?.fiscalData?.consumidorFinal);
            })
            .catch(() => {});
        return () => { active = false; };
    }, [tenantId]);

    if (!show || dismissed) return null;

    return (
        <div className="flex items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <Receipt size={16} className="shrink-0" />
            <span className="flex-1">{t("bannerText")}</span>
            <Link
                href="/admin/settings/fiscal"
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
            >
                {t("bannerCta")}
            </Link>
            <button
                onClick={() => {
                    setDismissed(true);
                    if (tenantId) sessionStorage.setItem(`fiscalBannerDismissed:${tenantId}`, "1");
                }}
                className="shrink-0 text-amber-600 transition-colors hover:text-amber-800 dark:hover:text-amber-200"
                aria-label={t("bannerDismiss")}
            >
                <X size={16} />
            </button>
        </div>
    );
}
