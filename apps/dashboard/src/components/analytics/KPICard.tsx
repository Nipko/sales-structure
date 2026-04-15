"use client";

import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";

interface KPICardProps {
    label: string;
    value: string | number;
    unit?: string;
    changePercent: number;
    icon: LucideIcon;
    iconColor?: string;
    invertTrend?: boolean; // true = down is good (e.g., response time)
}

export default function KPICard({
    label, value, unit, changePercent, icon: Icon, iconColor = "text-indigo-400", invertTrend,
}: KPICardProps) {
    const isPositive = invertTrend ? changePercent < 0 : changePercent > 0;
    const isNeutral = changePercent === 0;
    const trendColor = isNeutral ? "text-muted-foreground" : isPositive ? "text-emerald-500" : "text-red-400";
    const TrendIcon = isNeutral ? Minus : changePercent > 0 ? TrendingUp : TrendingDown;

    return (
        <div className="p-5 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] text-muted-foreground font-medium">{label}</span>
                <div className={`w-9 h-9 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center ${iconColor}`}>
                    <Icon size={18} />
                </div>
            </div>
            <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-foreground">{value}{unit && <span className="text-base font-normal text-muted-foreground ml-1">{unit}</span>}</span>
            </div>
            <div className={`flex items-center gap-1 mt-2 text-[12px] ${trendColor}`}>
                <TrendIcon size={14} />
                <span>{Math.abs(changePercent)}%</span>
                <span className="text-muted-foreground ml-1">vs anterior</span>
            </div>
        </div>
    );
}
