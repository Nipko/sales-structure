"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "next-intl";

export function useVerticalTerms() {
    const { verticalConfig } = useAuth();
    const locale = useLocale();
    const t = verticalConfig?.terminology;

    return {
        customerNoun: t?.customerNoun?.[locale] ?? t?.customerNoun?.es ?? 'contacto',
        customerNounPlural: t?.customerNounPlural?.[locale] ?? t?.customerNounPlural?.es ?? 'contactos',
        transactionNoun: t?.transactionNoun?.[locale] ?? t?.transactionNoun?.es ?? 'venta',
        serviceNoun: t?.serviceNoun?.[locale] ?? t?.serviceNoun?.es ?? 'servicio',
        pipelineNoun: t?.pipelineNoun?.[locale] ?? t?.pipelineNoun?.es ?? 'pipeline',
        industry: verticalConfig?.industry ?? 'otro',
    };
}
