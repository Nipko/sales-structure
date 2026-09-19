"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SetupBannerProps {
  show: boolean;
  onAction: () => void;
}

/**
 * The one nudge the agents list keeps during day 0: "your agent still speaks
 * like the template". It is unfinished setup, not something that broke — so it
 * reads as a guide (indigo, the setup card's colour) and not as a warning
 * (amber triangle), which is reserved for things that stopped working
 * (owner decision D3).
 */
export function SetupBanner({ show, onAction }: SetupBannerProps) {
  const t = useTranslations("agent");
  const titleId = useId();

  if (!show) return null;

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "rounded-xl border border-indigo-200 dark:border-indigo-500/20",
        "bg-indigo-50/60 dark:bg-indigo-500/[0.07] p-4 mb-6"
      )}
    >
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
          <Sparkles size={18} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id={titleId} className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {t("setupBannerTitle")}
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
            {t("setupBannerDesc")}
          </p>
        </div>
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "shrink-0 px-4 py-2 rounded-lg text-sm font-semibold",
            "bg-indigo-600 hover:bg-indigo-700 text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
            "flex w-full cursor-pointer items-center justify-center gap-1.5 transition-colors sm:w-auto"
          )}
        >
          {t("configureNow")} <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
