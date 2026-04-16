"use client";

import { useState, useEffect } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { locales, localeNames, type Locale } from "@/i18n/config";

export default function LocaleSwitcher() {
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
            <select
                value={current}
                onChange={(e) => handleChange(e.target.value)}
                className="bg-transparent text-[13px] text-muted-foreground outline-none cursor-pointer pl-0 pr-5 py-1 border border-gray-200 dark:border-white/15 rounded-lg appearance-none hover:text-foreground transition-colors"
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
