"use client";

import { useTranslations } from "next-intl";
import { useState, FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Lock, Eye, EyeOff, Check, X, AlertCircle, Shield, CheckCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export default function SecurityPage() {
    const t = useTranslations("settings.securityPage");
    const tc = useTranslations("common");
    const { user } = useAuth();
    const isGoogleOnly = !(user as any)?.hasPassword;

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    const validations = [
        { label: t("val8chars"), valid: newPassword.length >= 8 },
        { label: t("valUppercase"), valid: /[A-Z]/.test(newPassword) },
        { label: t("valLowercase"), valid: /[a-z]/.test(newPassword) },
        { label: t("valNumber"), valid: /[0-9]/.test(newPassword) },
        { label: t("valSpecial"), valid: /[!@#$%^&*]/.test(newPassword) },
    ];

    const allValid = validations.every((v) => v.valid);
    const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
    const canSubmit = allValid && passwordsMatch && (isGoogleOnly || currentPassword.length > 0) && !saving;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSaving(true);
        setError("");

        try {
            const result = isGoogleOnly
                ? await api.setupPassword(newPassword)
                : await api.changePassword(currentPassword, newPassword);

            if (result.success) {
                setSaved(true);
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(result.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("connectionError"));
        }
        setSaving(false);
    };

    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 pl-10 pr-10 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Shield} />

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                    {isGoogleOnly ? t("setupPassword") : t("changePassword")}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5">
                    {isGoogleOnly ? t("setupPasswordDesc") : t("changePasswordDesc")}
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {!isGoogleOnly && (
                        <div>
                            <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                {t("currentPassword")}
                            </label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                                <input type={showCurrent ? "text" : "password"} value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)} className={inputClasses} />
                                <button type="button" onClick={() => setShowCurrent(!showCurrent)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 bg-transparent border-none p-0 cursor-pointer">
                                    {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            {t("newPassword")}
                        </label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input type={showNew ? "text" : "password"} value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)} className={inputClasses} />
                            <button type="button" onClick={() => setShowNew(!showNew)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 bg-transparent border-none p-0 cursor-pointer">
                                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            {t("confirmPassword")}
                        </label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input type="password" value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)} className={inputClasses} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        {validations.map((v, i) => (
                            <div key={i} className={cn("flex items-center gap-2 text-[13px]", v.valid ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
                                {v.valid ? <Check size={14} /> : <X size={14} />} {v.label}
                            </div>
                        ))}
                        <div className={cn("flex items-center gap-2 text-[13px]", passwordsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
                            {passwordsMatch ? <Check size={14} /> : <X size={14} />} {t("passwordsMatch")}
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button type="submit" disabled={!canSubmit}
                            className={cn(
                                "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-all press-effect",
                                saved ? "bg-emerald-500" : "bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90",
                                !canSubmit && !saved && "opacity-50 cursor-not-allowed"
                            )}>
                            {saved ? <><CheckCircle size={16} /> {t("passwordUpdated")}</> : t("updatePassword")}
                        </button>
                    </div>
                </form>
            </div>

            {/* 2FA Section */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                    {t("twoFactor")}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {t("twoFactorDesc")}
                </p>
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-500">
                    <Shield size={14} /> {t("comingSoon")}
                </div>
            </div>
        </div>
    );
}
