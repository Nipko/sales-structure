"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Receipt } from "lucide-react";

/**
 * Shown when a charge-bearing billing action is blocked by the fiscal gate
 * (backend errorCode "fiscal_data_required"): the tenant must complete its DIAN
 * fiscal profile (NIT/cédula) before starting or changing to a paid plan.
 * Routes them to the fiscal-data form, then they retry.
 */
export function FiscalGateModal({
    open,
    onClose,
    plan,
    cycle,
}: {
    open: boolean;
    onClose: () => void;
    /** Plan/cycle the tenant was about to pay — carried through so billing can resume the checkout after the fiscal form is saved. */
    plan?: string;
    cycle?: string;
}) {
    const t = useTranslations("fiscalGate");
    if (!open) return null;
    const returnParams = new URLSearchParams({ returnTo: "billing" });
    if (plan) returnParams.set("plan", plan);
    if (cycle) returnParams.set("cycle", cycle);
    const completeHref = `/admin/settings/fiscal?${returnParams.toString()}`;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-3 flex items-center gap-2 text-teal-600 dark:text-teal-400">
                    <Receipt size={20} />
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h3>
                </div>
                <p className="mb-5 text-sm text-neutral-600 dark:text-neutral-300">{t("body")}</p>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                        {t("later")}
                    </button>
                    <Link
                        href={completeHref}
                        onClick={onClose}
                        className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
                    >
                        {t("complete")}
                    </Link>
                </div>
            </div>
        </div>
    );
}
