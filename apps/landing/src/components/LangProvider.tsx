"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";

import esMessages from "../../messages/es.json";
import esARMessages from "../../messages/es-AR.json";
import enMessages from "../../messages/en.json";
import ptMessages from "../../messages/pt.json";
import frMessages from "../../messages/fr.json";

/**
 * Deep-merge the es-AR voseo overrides onto the tuteo base, so the overlay only
 * needs to carry the strings that actually differ by dialect.
 */
function deepMerge(base: any, over: any): any {
    if (base && typeof base === "object" && !Array.isArray(base) &&
        over && typeof over === "object" && !Array.isArray(over)) {
        const out: any = { ...base };
        for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
        return out;
    }
    return over !== undefined ? over : base;
}

// Spanish base is tuteo neutral (Mexico, Colombia, Peru, Venezuela, most of LatAm).
// `esVoseo` is the same content with the voseo overrides merged in (Argentina,
// Uruguay, Paraguay). We keep the active locale as "es" either way, so nothing
// downstream that branches on locale === "es" has to change.
const esVoseo = deepMerge(esMessages, esARMessages);

const allMessages: Record<string, any> = {
    es: esMessages,
    en: enMessages,
    pt: ptMessages,
    fr: frMessages,
};

const localeNames: Record<string, string> = {
    es: "Español",
    en: "English",
    pt: "Português",
    fr: "Français",
};

/**
 * Best-effort, client-side detection of voseo countries (no network) — timezone
 * first (most reliable), then the browser language tags.
 */
function detectVoseo(): boolean {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (/Argentina|Buenos_Aires|Cordoba|Mendoza|Catamarca|Jujuy|Salta|Tucuman|Montevideo|Asuncion/i.test(tz)) {
            return true;
        }
        const langs = [navigator.language, ...(navigator.languages || [])]
            .map((l) => (l || "").toLowerCase());
        if (langs.some((l) => l.startsWith("es-ar") || l.startsWith("es-uy") || l.startsWith("es-py"))) {
            return true;
        }
    } catch {
        /* SSR / unsupported — fall back to neutral */
    }
    return false;
}

interface LangContextValue {
    locale: string;
    setLocale: (lang: string) => void;
    localeNames: Record<string, string>;
}

const LangContext = createContext<LangContextValue>({
    locale: "es",
    setLocale: () => {},
    localeNames,
});

export function useLang() {
    return useContext(LangContext);
}

export default function LangProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState("es");
    // Spanish dialect: neutral tuteo (false) or voseo (true). Only matters for "es".
    const [voseo, setVoseo] = useState(false);

    useEffect(() => {
        const saved = document.cookie.match(/locale=([\w-]+)/)?.[1];
        if (saved && allMessages[saved]) {
            setLocaleState(saved);
        } else {
            const browserLocale = [navigator.language, ...(navigator.languages || [])]
                .map((language) => language?.split("-")[0]?.toLowerCase())
                .find((language) => language && allMessages[language]);
            if (browserLocale) setLocaleState(browserLocale);
        }

        // An explicit dialect choice (cookie) wins; otherwise auto-detect by country.
        const savedDialect = document.cookie.match(/es_dialect=(\w+)/)?.[1];
        if (savedDialect === "voseo") setVoseo(true);
        else if (savedDialect === "tuteo") setVoseo(false);
        else setVoseo(detectVoseo());
    }, []);

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    const setLocale = (lang: string) => {
        if (!allMessages[lang]) return;
        document.cookie = `locale=${lang};path=/;max-age=31536000;SameSite=Lax`;
        setLocaleState(lang);
    };

    const messages = locale === "es" && voseo ? esVoseo : (allMessages[locale] || allMessages.es);

    return (
        <LangContext.Provider value={{ locale, setLocale, localeNames }}>
            <NextIntlClientProvider
                locale={locale}
                messages={messages}
                timeZone="America/Bogota"
            >
                {children}
            </NextIntlClientProvider>
        </LangContext.Provider>
    );
}
