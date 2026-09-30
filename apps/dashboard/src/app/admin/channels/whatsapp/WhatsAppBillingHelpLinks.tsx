"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

/** Instructions shared by the setup brief and live funding checks. */
export default function WhatsAppBillingHelpLinks() {
    const t = useTranslations("channels.whatsapp.afterConnect.payment");
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                <a href="https://www.facebook.com/business/help/488291839463771" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-4">
                    {t("guide")} <ExternalLink size={12} aria-hidden="true" />
                </a>
                <a href="/help/meta-whatsapp-pagos-2026-10.pdf" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-4">
                    {t("pdfGuide")} <ExternalLink size={12} aria-hidden="true" />
                </a>
            </div>
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">{t("providerNote")}</p>
        </div>
    );
}
