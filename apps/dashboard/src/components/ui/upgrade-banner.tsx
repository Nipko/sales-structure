"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface UpgradeBannerProps {
  current: number;
  limit: number | null;
  resourceLabel: string;
}

export function UpgradeBanner({ current, limit, resourceLabel }: UpgradeBannerProps) {
  const t = useTranslations("billingPage");
  const router = useRouter();

  if (limit === null || current < limit) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-4">
      <AlertTriangle size={18} className="text-amber-500 shrink-0" />
      <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
        {t("limitReached", { current, limit, resource: resourceLabel })}
      </p>
      <button
        type="button"
        onClick={() => router.push("/admin/settings/billing")}
        className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold cursor-pointer transition-colors shrink-0"
      >
        {t("upgradePlan")}
      </button>
    </div>
  );
}

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
}

export function UpgradeModal({ open, onClose, title, description }: UpgradeModalProps) {
  const t = useTranslations("billingPage");
  const router = useRouter();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 max-w-sm w-full mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle size={24} className="text-amber-500" />
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            {title}
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
            {description}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => { onClose(); router.push("/admin/settings/billing"); }}
              className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {t("upgradePlan")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
