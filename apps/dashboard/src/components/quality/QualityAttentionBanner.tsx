"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertOctagon, Clock3, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQualityHealth } from "@/contexts/QualityHealthContext";
import { useRole } from "@/hooks/useRole";
import {
  PRODUCT_TOUR_PENDING_KEY,
  PRODUCT_TOUR_CLOSED_EVENT,
  PRODUCT_TOUR_PREPARE_EVENT,
  canRunProductTourAtWidth,
} from "@/lib/product-tour-contract";
import { askAssistAboutQuality } from "@/lib/quality-health-events";
import { safeQualityHref, shouldShowQualityAttentionBanner } from "@/lib/quality-health";

export default function QualityAttentionBanner() {
  const t = useTranslations("qualityHealth");
  const pathname = usePathname();
  const { summary, snoozeSignal } = useQualityHealth();
  const { canAccess, canEditAgent, canManageChannels } = useRole();
  const canLaunchTour = canEditAgent && canManageChannels;
  const [tourSuppressedPath, setTourSuppressedPath] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);

  useEffect(() => {
    try {
      // A pending tour cannot run on mobile because its anchors live in the
      // desktop sidebar. Do not let that deferred flag hide critical health.
      if (canLaunchTour
        && canRunProductTourAtWidth(window.innerWidth)
        && localStorage.getItem(PRODUCT_TOUR_PENDING_KEY) === "true") {
        setTourSuppressedPath(pathname);
      }
    } catch { /* the tour is optional */ }
    const suppressForTour = () => setTourSuppressedPath(pathname);
    const restoreAfterTour = () => setTourSuppressedPath(null);
    window.addEventListener(PRODUCT_TOUR_PREPARE_EVENT, suppressForTour);
    window.addEventListener(PRODUCT_TOUR_CLOSED_EVENT, restoreAfterTour);
    return () => {
      window.removeEventListener(PRODUCT_TOUR_PREPARE_EVENT, suppressForTour);
      window.removeEventListener(PRODUCT_TOUR_CLOSED_EVENT, restoreAfterTour);
    };
  }, [canLaunchTour, pathname]);

  const topAction = summary?.topAction;
  if (!topAction || !shouldShowQualityAttentionBanner(summary)) return null;
  if (pathname === "/admin/setup-wizard" || pathname.startsWith("/admin/agent/quality")) return null;
  if (tourSuppressedPath === pathname) return null;

  const centerHref = safeQualityHref(null, topAction.agentId);
  const requestedHref = safeQualityHref(topAction.href, topAction.agentId);
  const reviewHref = canAccess(requestedHref) ? requestedHref : centerHref;

  const handleSnooze = async () => {
    setSnoozing(true);
    await snoozeSignal(topAction.signalId, 24);
    setSnoozing(false);
  };

  return (
    <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2.5 text-red-900 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-100" role="alert">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AlertOctagon size={17} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="min-w-0 text-sm">
            <span className="font-semibold">{t(summary?.worstStatus === "at_risk" ? "bannerAtRisk" : "bannerCritical")}</span>{" "}
            <span className="text-red-800/85 dark:text-red-200/85">{t("bannerAgent", { agent: topAction.agentName })}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6 lg:pl-0">
          <Link href={reviewHref} className="inline-flex min-h-8 items-center justify-center rounded-md bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-500 dark:text-neutral-950 dark:hover:bg-red-400">
            {t("review")}
          </Link>
          <button
            type="button"
            onClick={() => askAssistAboutQuality({
              signalId: topAction.signalId,
              agentId: topAction.agentId,
              agentName: topAction.agentName,
              code: topAction.code,
              severity: topAction.severity,
              href: reviewHref,
            })}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:hover:bg-red-900/50"
          >
            <MessageCircle size={13} aria-hidden="true" /> {t("askAssist")}
          </button>
          <button
            type="button"
            onClick={() => void handleSnooze()}
            disabled={snoozing}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-red-900/50"
          >
            <Clock3 size={13} aria-hidden="true" /> {t("snooze24h")}
          </button>
        </div>
      </div>
    </div>
  );
}
