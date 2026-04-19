"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SetupBannerProps {
  show: boolean;
  onAction: () => void;
}

export function SetupBanner({ show, onAction }: SetupBannerProps) {
  const t = useTranslations("agent");

  if (!show) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-300 dark:border-amber-500/30",
        "bg-amber-50 dark:bg-amber-500/10 p-4 mb-6"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {t("setupBannerTitle")}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-0.5">
            {t("setupBannerDesc")}
          </p>
        </div>
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "shrink-0 px-4 py-2 rounded-lg text-sm font-semibold",
            "bg-amber-600 hover:bg-amber-700 text-white",
            "dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-neutral-900",
            "transition-colors cursor-pointer flex items-center gap-1.5"
          )}
        >
          {t("configureNow")} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
