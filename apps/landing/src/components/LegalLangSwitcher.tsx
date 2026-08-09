"use client";

import { useLang } from "./LangProvider";

export default function LegalLangSwitcher() {
    const { locale, setLocale, localeNames } = useLang();
    const label = locale === "es" ? "Idioma" :
        locale === "en" ? "Language" :
        locale === "pt" ? "Idioma" :
        "Langue";

    return (
        <div className="flex items-center gap-2 mb-8">
            <label htmlFor="legal-language" className="text-xs text-text-muted uppercase tracking-wide">
                {label}
            </label>
            <select
                id="legal-language"
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
