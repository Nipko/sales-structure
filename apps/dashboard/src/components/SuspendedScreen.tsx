"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldOff, LogOut, CreditCard, Shield, MessageSquare, Database } from "lucide-react";
import type { RestrictionInfo } from "@/app/admin/layout";

interface Props {
    restriction?: RestrictionInfo;
}

export default function SuspendedScreen({ restriction }: Props) {
    const t = useTranslations("suspendedScreen");
    const { logout } = useAuth();
    const router = useRouter();

    return (
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950 px-4">
            <div className="text-center max-w-lg">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center mx-auto mb-6">
                    <ShieldOff className="w-8 h-8 text-red-500" />
                </div>
                <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
                    {t("title")}
                </h1>
                <p className="text-neutral-500 dark:text-neutral-400 mb-6 leading-relaxed">
                    {t("description")}
                </p>

                {/* What's preserved */}
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 mb-6 text-left">
                    <p className="text-xs uppercase tracking-wider text-neutral-500 mb-3 font-medium">{t("dataStatus")}</p>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                            <Database size={14} className="text-emerald-500 shrink-0" />
                            <span>{t("dataPreserved")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                            <MessageSquare size={14} className="text-emerald-500 shrink-0" />
                            <span>{t("conversationsPreserved")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                            <Shield size={14} className="text-emerald-500 shrink-0" />
                            <span>{t("retentionNotice")}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button
                        onClick={() => router.push("/admin/settings/billing")}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors text-sm font-medium"
                    >
                        <CreditCard className="w-4 h-4" />
                        {t("reactivate")}
                    </button>
                    <button
                        onClick={logout}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors text-sm font-medium"
                    >
                        <LogOut className="w-4 h-4" />
                        {t("logout")}
                    </button>
                </div>
            </div>
        </div>
    );
}
