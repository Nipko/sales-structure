"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar, ChevronDown } from "lucide-react";

interface DateRangePickerProps {
    start: string;
    end: string;
    onChange: (start: string, end: string) => void;
}

function formatDate(d: Date): string {
    return d.toISOString().split("T")[0];
}

function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return formatDate(d);
}

const PRESETS = [
    { key: "7d", days: 7 },
    { key: "30d", days: 30 },
    { key: "90d", days: 90 },
] as const;

export default function DateRangePicker({ start, end, onChange }: DateRangePickerProps) {
    const t = useTranslations("analyticsV2");
    const [showCustom, setShowCustom] = useState(false);

    const activePreset = PRESETS.find(p => start === daysAgo(p.days) && end === formatDate(new Date()));

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {PRESETS.map(p => (
                <button
                    key={p.key}
                    onClick={() => { onChange(daysAgo(p.days), formatDate(new Date())); setShowCustom(false); }}
                    className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors border ${
                        activePreset?.key === p.key && !showCustom
                            ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-500"
                            : "bg-white dark:bg-white/[0.04] border-neutral-200 dark:border-white/10 text-muted-foreground hover:text-foreground"
                    }`}
                >
                    {t(p.key)}
                </button>
            ))}

            <button
                onClick={() => setShowCustom(!showCustom)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors border inline-flex items-center gap-1.5 ${
                    showCustom
                        ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-500"
                        : "bg-white dark:bg-white/[0.04] border-neutral-200 dark:border-white/10 text-muted-foreground hover:text-foreground"
                }`}
            >
                <Calendar size={14} /> {t("custom")} <ChevronDown size={12} />
            </button>

            {showCustom && (
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={start}
                        onChange={e => onChange(e.target.value, end)}
                        className="px-2.5 py-1.5 rounded-lg text-[13px] border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-foreground outline-none"
                    />
                    <span className="text-muted-foreground text-[13px]">—</span>
                    <input
                        type="date"
                        value={end}
                        onChange={e => onChange(start, e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg text-[13px] border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-foreground outline-none"
                    />
                </div>
            )}
        </div>
    );
}
