"use client";

import { useTranslations } from "next-intl";

interface HeatmapProps {
    data: Array<{ day: number; hour: number; count: number }>;
}

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function Heatmap({ data }: HeatmapProps) {
    const t = useTranslations("analyticsV2");

    // Build 7x24 grid
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxCount = 1;
    for (const cell of data) {
        grid[cell.day][cell.hour] = cell.count;
        if (cell.count > maxCount) maxCount = cell.count;
    }

    const getColor = (count: number) => {
        if (count === 0) return "bg-gray-100 dark:bg-white/[0.03]";
        const intensity = count / maxCount;
        if (intensity < 0.25) return "bg-emerald-100 dark:bg-emerald-500/10";
        if (intensity < 0.5) return "bg-emerald-300 dark:bg-emerald-500/25";
        if (intensity < 0.75) return "bg-emerald-400 dark:bg-emerald-500/45";
        return "bg-emerald-500 dark:bg-emerald-500/70";
    };

    return (
        <div className="overflow-x-auto">
            <div className="min-w-[700px]">
                {/* Hour labels */}
                <div className="flex mb-1 ml-10">
                    {Array.from({ length: 24 }, (_, i) => (
                        <div key={i} className="flex-1 text-center text-[10px] text-muted-foreground">
                            {i % 3 === 0 ? `${i}h` : ""}
                        </div>
                    ))}
                </div>
                {/* Rows */}
                {grid.map((hours, dayIdx) => (
                    <div key={dayIdx} className="flex items-center gap-1 mb-1">
                        <span className="w-9 text-[11px] text-muted-foreground text-right shrink-0">
                            {DAY_LABELS[dayIdx]}
                        </span>
                        <div className="flex flex-1 gap-[2px]">
                            {hours.map((count, hourIdx) => (
                                <div
                                    key={hourIdx}
                                    className={`flex-1 h-5 rounded-[3px] ${getColor(count)} transition-colors`}
                                    title={`${DAY_LABELS[dayIdx]} ${hourIdx}:00 — ${count} ${t("messages")}`}
                                />
                            ))}
                        </div>
                    </div>
                ))}
                {/* Legend */}
                <div className="flex items-center gap-2 mt-3 ml-10">
                    <span className="text-[10px] text-muted-foreground">{t("less")}</span>
                    <div className="w-4 h-3 rounded-sm bg-gray-100 dark:bg-white/[0.03]" />
                    <div className="w-4 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-500/10" />
                    <div className="w-4 h-3 rounded-sm bg-emerald-300 dark:bg-emerald-500/25" />
                    <div className="w-4 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-500/45" />
                    <div className="w-4 h-3 rounded-sm bg-emerald-500 dark:bg-emerald-500/70" />
                    <span className="text-[10px] text-muted-foreground">{t("more")}</span>
                </div>
            </div>
        </div>
    );
}
