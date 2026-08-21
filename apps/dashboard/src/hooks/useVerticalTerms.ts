"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "next-intl";
import { localizedTerm, subtypeTerminologyFor } from "@parallext/shared";

/**
 * Cómo llama este negocio a las cosas con las que trabaja.
 *
 * La terminología era por **industria**: 18 juegos de sustantivos para 76
 * negocios. Un hotel y un alquiler vacacional comparten "Turismo" y no
 * comparten casi nada más, y a los dos la aplicación les decía lo mismo. Donde
 * el sub-tipo tiene palabra propia, gana; donde no, se usa la de su vertical,
 * y esa ausencia es una decisión, no un olvido.
 */
export function useVerticalTerms() {
    const { verticalConfig } = useAuth();
    const locale = useLocale();
    const t = verticalConfig?.terminology;
    const subtype = subtypeTerminologyFor(verticalConfig?.industry, verticalConfig?.subType);

    const industryTerm = (key: string, fallback: string) =>
        t?.[key]?.[locale] ?? t?.[key]?.es ?? fallback;

    return {
        customerNoun: localizedTerm(subtype?.customerNoun, locale)
            ?? industryTerm("customerNoun", "contacto"),
        customerNounPlural: localizedTerm(subtype?.customerNounPlural, locale)
            ?? industryTerm("customerNounPlural", "contactos"),
        transactionNoun: localizedTerm(subtype?.transactionNoun, locale)
            ?? industryTerm("transactionNoun", "venta"),
        serviceNoun: industryTerm("serviceNoun", "servicio"),
        pipelineNoun: industryTerm("pipelineNoun", "pipeline"),
        /** Lo que el negocio vende o gestiona. `null` cuando no tiene nombre propio. */
        primaryObjectNoun: localizedTerm(subtype?.primaryObject, locale),
        primaryObjectNounPlural: localizedTerm(subtype?.primaryObjectPlural, locale),
        industry: verticalConfig?.industry ?? "otro",
        subType: verticalConfig?.subType ?? null,
    };
}
