"use client";

import { useTranslations } from "next-intl";
import { Monitor, LogIn } from "lucide-react";

interface SessionConflictModalProps {
    open: boolean;
    onForceLogin: () => void;
    onCancel: () => void;
}

export default function SessionConflictModal({
    open,
    onForceLogin,
    onCancel,
}: SessionConflictModalProps) {
    const t = useTranslations("auth");

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-sm mx-4 p-6 rounded-xl bg-white dark:bg-[#1a1a2e] border border-neutral-200 dark:border-white/10 shadow-2xl">
                <div className="flex justify-center mb-4">
                    <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
                        <Monitor size={28} className="text-amber-600 dark:text-amber-400" />
                    </div>
                </div>

                <h2 className="text-lg font-semibold text-center text-foreground mb-2">
                    {t("sessionConflictTitle")}
                </h2>

                <p className="text-sm text-muted-foreground text-center mb-6">
                    {t("sessionConflictMessage")}
                </p>

                <div className="flex flex-col gap-2.5">
                    <button
                        onClick={onForceLogin}
                        className="w-full py-3 rounded-xl border-none text-white text-sm font-semibold bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:brightness-110 transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)] inline-flex items-center justify-center gap-2"
                    >
                        <LogIn size={16} /> {t("sessionConflictForce")}
                    </button>
                    <button
                        onClick={onCancel}
                        className="w-full py-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-transparent text-muted-foreground text-sm font-medium cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                    >
                        {t("sessionConflictCancel")}
                    </button>
                </div>
            </div>
        </div>
    );
}
