"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";

import esMessages from "../../messages/es.json";
import enMessages from "../../messages/en.json";
import ptMessages from "../../messages/pt.json";
import frMessages from "../../messages/fr.json";

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

    useEffect(() => {
        const saved = document.cookie.match(/locale=(\w+)/)?.[1];
        if (saved && allMessages[saved]) setLocaleState(saved);
    }, []);

    const setLocale = (lang: string) => {
        if (!allMessages[lang]) return;
        document.cookie = `locale=${lang};path=/;max-age=31536000`;
        setLocaleState(lang);
    };

    const messages = allMessages[locale] || allMessages.es;

    return (
        <LangContext.Provider value={{ locale, setLocale, localeNames }}>
            <NextIntlClientProvider locale={locale} messages={messages}>
                {children}
            </NextIntlClientProvider>
        </LangContext.Provider>
    );
}
