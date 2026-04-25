"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldOff, LogOut } from "lucide-react";

export default function SuspendedScreen() {
    const t = useTranslations("common");
    const { logout } = useAuth();

    return (
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950 px-4">
            <div className="text-center max-w-md">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center mx-auto mb-6">
                    <ShieldOff className="w-8 h-8 text-red-500" />
                </div>
                <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
                    {t("accountSuspended")}
                </h1>
                <p className="text-neutral-500 dark:text-neutral-400 mb-8 leading-relaxed">
                    {t("accountSuspendedDesc")}
                </p>
                <button
                    onClick={logout}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors text-sm font-medium"
                >
                    <LogOut className="w-4 h-4" />
                    {t("logout")}
                </button>
            </div>
        </div>
    );
}
