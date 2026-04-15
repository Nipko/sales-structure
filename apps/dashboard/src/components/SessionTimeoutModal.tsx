"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Clock, LogOut } from "lucide-react";

interface SessionTimeoutModalProps {
    open: boolean;
    /** Seconds until auto-logout */
    secondsLeft: number;
    onStayLoggedIn: () => void;
    onLogout: () => void;
}

export default function SessionTimeoutModal({
    open,
    secondsLeft: initialSeconds,
    onStayLoggedIn,
    onLogout,
}: SessionTimeoutModalProps) {
    const t = useTranslations("auth");
    const [seconds, setSeconds] = useState(initialSeconds);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Reset countdown when modal opens
    useEffect(() => {
        if (open) {
            setSeconds(initialSeconds);
            intervalRef.current = setInterval(() => {
                setSeconds((prev) => {
                    if (prev <= 1) {
                        if (intervalRef.current) clearInterval(intervalRef.current);
                        onLogout();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [open, initialSeconds, onLogout]);

    if (!open) return null;

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-sm mx-4 p-6 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-gray-200 dark:border-white/10 shadow-2xl">
                {/* Icon */}
                <div className="flex justify-center mb-4">
                    <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
                        <Clock size={28} className="text-amber-600 dark:text-amber-400" />
                    </div>
                </div>

                {/* Title */}
                <h2 className="text-lg font-bold text-center text-foreground mb-2">
                    {t("sessionWarningTitle")}
                </h2>

                {/* Message + countdown */}
                <p className="text-sm text-muted-foreground text-center mb-1">
                    {t("sessionWarningMessage")}
                </p>
                <p className="text-3xl font-mono font-bold text-center text-amber-600 dark:text-amber-400 mb-6">
                    {timeStr}
                </p>

                {/* Actions */}
                <div className="flex flex-col gap-2.5">
                    <button
                        onClick={onStayLoggedIn}
                        className="w-full py-3 rounded-xl border-none text-white text-sm font-semibold bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:brightness-110 transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)]"
                    >
                        {t("stayLoggedIn")}
                    </button>
                    <button
                        onClick={onLogout}
                        className="w-full py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-transparent text-muted-foreground text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors inline-flex items-center justify-center gap-2"
                    >
                        <LogOut size={16} /> {t("logout")}
                    </button>
                </div>
            </div>
        </div>
    );
}
