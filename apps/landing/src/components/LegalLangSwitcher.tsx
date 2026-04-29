"use client";

import { useLang } from "./LangProvider";

export default function LegalLangSwitcher() {
    const { locale, setLocale, localeNames } = useLang();
    return (
        <div className="flex items-center gap-2 mb-8">
            <span className="text-xs text-text-muted uppercase tracking-wide">
                {locale === "es" ? "Idioma" :
                 locale === "en" ? "Language" :
                 locale === "pt" ? "Idioma" :
                 "Langue"}
            </span>
            <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="bg-surface text-sm text-text-primary border border-border rounded-lg px-3 py-1.5 outline-none cursor-pointer hover:border-accent transition-colors"
            >
                {Object.entries(localeNames).map(([code, name]) => (
                    <option key={code} value={code}>
                        {name}
                    </option>
                ))}
            </select>
        </div>
    );
}
