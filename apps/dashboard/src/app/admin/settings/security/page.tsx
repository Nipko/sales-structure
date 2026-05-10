"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Lock, Eye, EyeOff, Check, X, AlertCircle, Shield, CheckCircle, ShieldCheck, ShieldOff, Key, Copy, Loader2 } from "lucide-react";
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
            <TwoFactorSettings />
        </div>
    );
}

function TwoFactorSettings() {
    const t = useTranslations("settings.securityPage");
    const tc = useTranslations("common");

    const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'backup' | 'disable'>('idle');
    const [qrData, setQrData] = useState<{ qrCodeDataUrl: string; secret: string } | null>(null);
    const [verifyCode, setVerifyCode] = useState("");
    const [backupCodes, setBackupCodes] = useState<string[]>([]);
    const [disablePassword, setDisablePassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error2FA, setError2FA] = useState("");
    const [is2FAEnabled, setIs2FAEnabled] = useState(false);
    const [copied, setCopied] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(true);

    useEffect(() => {
        api.get2FAStatus().then((res: any) => {
            if (res.success && res.data) {
                setIs2FAEnabled(res.data.enabled);
            }
            setCheckingStatus(false);
        }).catch(() => setCheckingStatus(false));
    }, []);

    const handleSetup = async () => {
        setLoading(true);
        setError2FA("");
        const res = await api.setup2FA();
        setLoading(false);
        if (res.success && res.data) {
            setQrData({ qrCodeDataUrl: res.data.qrCodeDataUrl, secret: res.data.secret });
            setStep('verify');
        } else {
            setError2FA(res.error || tc("errorSaving"));
        }
    };

    const handleVerifySetup = async () => {
        if (verifyCode.length !== 6) return;
        setLoading(true);
        setError2FA("");
        const res = await api.verifySetup2FA(verifyCode);
        setLoading(false);
        if (res.success && res.data?.backupCodes) {
            setBackupCodes(res.data.backupCodes);
            setIs2FAEnabled(true);
            // Update localStorage
            try {
                const savedUser = localStorage.getItem("user");
                if (savedUser) {
                    const u = JSON.parse(savedUser);
                    u.twoFactorEnabled = true;
                    localStorage.setItem("user", JSON.stringify(u));
                }
            } catch { /* noop */ }
            setStep('backup');
        } else {
            setError2FA(res.error || t("invalidCode"));
            setVerifyCode("");
        }
    };

    const handleDisable = async () => {
        setLoading(true);
        setError2FA("");
        const res = await api.disable2FA(disablePassword);
        setLoading(false);
        if (res.success) {
            setIs2FAEnabled(false);
            setStep('idle');
            setDisablePassword("");
            try {
                const savedUser = localStorage.getItem("user");
                if (savedUser) {
                    const u = JSON.parse(savedUser);
                    u.twoFactorEnabled = false;
                    localStorage.setItem("user", JSON.stringify(u));
                }
            } catch { /* noop */ }
        } else {
            setError2FA(res.error || tc("errorSaving"));
        }
    };

    const handleRegenBackupCodes = async () => {
        setLoading(true);
        setError2FA("");
        const res = await api.regenerateBackupCodes(disablePassword);
        setLoading(false);
        if (res.success && res.data?.backupCodes) {
            setBackupCodes(res.data.backupCodes);
            setStep('backup');
            setDisablePassword("");
        } else {
            setError2FA(res.error || tc("errorSaving"));
        }
    };

    const copyBackupCodes = async () => {
        try {
            await navigator.clipboard.writeText(backupCodes.join("\n"));
        } catch {
            const ta = document.createElement("textarea");
            ta.value = backupCodes.join("\n");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                        {t("twoFactor")}
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t("twoFactorDesc")}
                    </p>
                </div>
                {is2FAEnabled && step === 'idle' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                        <ShieldCheck size={13} /> {t("twoFactorActive")}
                    </span>
                )}
            </div>

            {error2FA && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 mb-4">
                    <AlertCircle size={16} /> {error2FA}
                </div>
            )}

            {/* Idle — not enabled */}
            {step === 'idle' && !is2FAEnabled && (
                <button onClick={handleSetup} disabled={loading}
                    className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-all press-effect">
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    {t("enable2FA")}
                </button>
            )}

            {/* Idle — enabled */}
            {step === 'idle' && is2FAEnabled && (
                <div className="flex gap-3">
                    <button onClick={() => setStep('disable')}
                        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-red-600 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
                        <ShieldOff size={16} /> {t("disable2FA")}
                    </button>
                    <button onClick={() => { setStep('disable'); /* will prompt for password then regen */ }}
                        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                        <Key size={16} /> {t("regenBackupCodes")}
                    </button>
                </div>
            )}

            {/* Setup — QR code & verify */}
            {step === 'verify' && qrData && (
                <div className="space-y-4">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {t("scanQR")}
                    </p>
                    <div className="flex justify-center">
                        <img src={qrData.qrCodeDataUrl} alt="QR Code" className="w-48 h-48 rounded-lg border border-neutral-200 dark:border-neutral-700" />
                    </div>
                    <div className="text-center">
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{t("manualEntry")}</p>
                        <code className="text-sm font-mono bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg select-all">
                            {qrData.secret}
                        </code>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            {t("enterCode")}
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                            placeholder="000000"
                            className="w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 text-center text-lg font-mono tracking-widest text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                            onKeyDown={(e) => e.key === 'Enter' && handleVerifySetup()}
                        />
                    </div>
                    <div className="flex gap-3 justify-end">
                        <button onClick={() => { setStep('idle'); setQrData(null); setVerifyCode(""); }}
                            className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">
                            {tc("cancel")}
                        </button>
                        <button onClick={handleVerifySetup} disabled={verifyCode.length !== 6 || loading}
                            className={cn(
                                "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-all",
                                verifyCode.length === 6 && !loading ? "bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90" : "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                            )}>
                            {loading && <Loader2 size={16} className="animate-spin" />}
                            {t("activateButton")}
                        </button>
                    </div>
                </div>
            )}

            {/* Backup codes display */}
            {step === 'backup' && backupCodes.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-4 py-3">
                        <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-700 dark:text-amber-300">{t("backupWarning")}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                        {backupCodes.map((code, i) => (
                            <code key={i} className="text-sm font-mono text-center py-1.5 text-neutral-700 dark:text-neutral-300">
                                {code}
                            </code>
                        ))}
                    </div>
                    <div className="flex gap-3 justify-end">
                        <button onClick={copyBackupCodes}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                            <Copy size={14} /> {copied ? tc("copied") : tc("copy")}
                        </button>
                        <button onClick={() => { setStep('idle'); setBackupCodes([]); }}
                            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-all">
                            <Check size={16} /> {t("backupSaved")}
                        </button>
                    </div>
                </div>
            )}

            {/* Disable — password prompt */}
            {step === 'disable' && (
                <div className="space-y-4">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("disableConfirm")}</p>
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            {t("confirmWithPassword")}
                        </label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input type="password" value={disablePassword}
                                onChange={(e) => setDisablePassword(e.target.value)}
                                className="w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 pl-10 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors" />
                        </div>
                    </div>
                    <div className="flex gap-3 justify-end">
                        <button onClick={() => { setStep('idle'); setDisablePassword(""); setError2FA(""); }}
                            className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">
                            {tc("cancel")}
                        </button>
                        <button onClick={handleDisable} disabled={!disablePassword || loading}
                            className={cn(
                                "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-all",
                                disablePassword && !loading ? "bg-red-600 hover:bg-red-700" : "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                            )}>
                            {loading && <Loader2 size={16} className="animate-spin" />}
                            {t("disable2FA")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
