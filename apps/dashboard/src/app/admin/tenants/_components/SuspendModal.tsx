"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, AlertTriangle } from "lucide-react";
import type { Tenant } from "./types";

interface Props {
  tenant: Tenant | null;
  onClose: () => void;
  onSuspend: (tenantId: string, reason: string) => void;
}

export default function SuspendModal({ tenant, onClose, onSuspend }: Props) {
  const t = useTranslations("tenants");
  const tc = useTranslations("common");
  const [reason, setReason] = useState("");

  if (!tenant) return null;

  const handleSubmit = () => {
    if (!reason.trim()) return;
    onSuspend(tenant.id, reason.trim());
    setReason("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="w-[460px] max-w-[90vw] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-500" />
            {t("modals.suspendTitle")}
          </h2>
          <button onClick={onClose} className="bg-transparent border-none text-neutral-500 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          {t("modals.suspendMessage")}
        </p>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-4">
          {t("tenantLabel")}: <strong>{tenant.name}</strong>
        </p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.suspendReason")}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("modals.suspendReason")}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm resize-none"
          />
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700">
            {tc("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!reason.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white cursor-pointer hover:bg-red-700 disabled:opacity-50 border-none"
          >
            {t("actions.suspend")}
          </button>
        </div>
      </div>
    </div>
  );
}
