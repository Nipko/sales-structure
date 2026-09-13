"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Globe, ChevronDown } from "lucide-react";
import { locales, localeNames, type Locale } from "@/i18n/config";

export default function LocaleSwitcher() {
    const t = useTranslations("topbar");
    const [current, setCurrent] = useState<Locale>("es");

    // Read the actual cookie on mount (client-side only)
    useEffect(() => {
        const match = document.cookie.match(/locale=(\w+)/);
        if (match && locales.includes(match[1] as Locale)) {
            setCurrent(match[1] as Locale);
        }
    }, []);

    const handleChange = (locale: string) => {
        document.cookie = `locale=${locale};path=/;max-age=31536000`;
        window.location.reload();
    };

    return (
        <div className="relative inline-flex items-center gap-1.5">
            <Globe size={14} className="text-muted-foreground pointer-events-none" />
            {/* The globe icon is decorative and the chevron is decorative, so
                without this the control is announced as an unnamed combo box:
                the only thing a screen reader could say about it is what is
                currently selected, which sounds like a stray word. */}
            <select
                aria-label={t("language")}
                value={current}
                onChange={(e) => handleChange(e.target.value)}
                className="bg-white dark:bg-neutral-900 text-[13px] text-muted-foreground outline-none cursor-pointer pl-0 pr-5 py-1 border border-neutral-200 dark:border-white/15 rounded-lg appearance-none hover:text-foreground transition-colors"
                style={{ paddingLeft: '8px' }}
            >
                {locales.map(l => (
                    <option key={l} value={l} className="text-black dark:text-white">{localeNames[l]}</option>
                ))}
            </select>
            <ChevronDown size={12} className="absolute right-1.5 text-muted-foreground pointer-events-none" />
        </div>
    );
}
