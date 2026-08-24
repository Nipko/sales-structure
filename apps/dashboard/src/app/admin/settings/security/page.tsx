"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Lock, Eye, EyeOff, Check, X, AlertCircle, Shield, CheckCircle, ShieldCheck, ShieldOff, Key, Copy, Loader2, Globe, Download, ExternalLink, Monitor, Trash2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";

export default function SecurityPage() {
    const t = useTranslations("settings.securityPage");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
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

            <HelpPanel
                title={tHelp("settingsSecurity.title")}
                description={tHelp("settingsSecurity.description")}
                tips={tHelp.raw("settingsSecurity.tips") as string[]}
                mediaKey="settingsSecurity"
            />

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

            {/* Trusted Devices Section */}
            <TrustedDevicesSettings />

            {/* SSO Section */}
            <SsoSettings />
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
                        <img src={qrData.qrCodeDataUrl} alt={t("qrCodeAlt")} className="w-48 h-48 rounded-lg border border-neutral-200 dark:border-neutral-700" />
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

function TrustedDevicesSettings() {
    const t = useTranslations("settings.securityPage.trustedDevices");
    const tc = useTranslations("common");

    const [devices, setDevices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [revokingAll, setRevokingAll] = useState(false);
    const [showConfirmAll, setShowConfirmAll] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const loadDevices = async () => {
        setLoading(true);
        try {
            const res = await api.listTrustedDevices();
            if (res.success && res.data) {
                setDevices(res.data);
            }
        } catch { /* noop */ }
        setLoading(false);
    };

    useEffect(() => {
        loadDevices();
    }, []);

    const handleRevoke = async (deviceId: string) => {
        setRevoking(deviceId);
        try {
            const res = await api.revokeTrustedDevice(deviceId);
            if (res.success) {
                setDevices(prev => prev.filter(d => d.id !== deviceId));
                setToast(t("deviceRevoked"));
                setTimeout(() => setToast(null), 3000);
            }
        } catch { /* noop */ }
        setRevoking(null);
    };

    const handleRevokeAll = async () => {
        setRevokingAll(true);
        try {
            const res = await api.revokeAllTrustedDevices();
            if (res.success) {
                setDevices([]);
                try { localStorage.removeItem("deviceTrustToken"); } catch { /* noop */ }
                setToast(t("allDevicesRevoked"));
                setTimeout(() => setToast(null), 3000);
            }
        } catch { /* noop */ }
        setRevokingAll(false);
        setShowConfirmAll(false);
    };

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return dateStr; }
    };

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                        {t("title")}
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t("desc")}
                    </p>
                </div>
                {devices.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
                        <Monitor size={13} /> {devices.length}
                    </span>
                )}
            </div>

            {loading ? (
                <div className="flex items-center gap-3 py-4">
                    <Loader2 size={16} className="animate-spin text-neutral-400" />
                    <span className="text-sm text-neutral-500">{tc("loading")}</span>
                </div>
            ) : devices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <Monitor size={24} className="text-neutral-300 dark:text-neutral-600" />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noDevices")}</p>
                    <p className="text-xs text-neutral-400">{t("noDevicesHint")}</p>
                </div>
            ) : (
                <>
                    <div className="space-y-3 mb-4">
                        {devices.map((device) => (
                            <div key={device.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                                        <Monitor size={16} className="text-blue-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                            {device.deviceName}
                                        </p>
                                        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                                            {device.ipAddress && <span>{device.ipAddress}</span>}
                                            <span>·</span>
                                            <span>{t("lastUsed")} {formatDate(device.lastUsedAt)}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRevoke(device.id)}
                                    disabled={revoking === device.id}
                                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                >
                                    {revoking === device.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    {t("revoke")}
                                </button>
                            </div>
                        ))}
                    </div>

                    {showConfirmAll ? (
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10">
                            <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
                            <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">{t("revokeAllConfirm")}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowConfirmAll(false)}
                                    className="px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
                                >
                                    {tc("cancel")}
                                </button>
                                <button
                                    onClick={handleRevokeAll}
                                    disabled={revokingAll}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
                                >
                                    {revokingAll && <Loader2 size={12} className="animate-spin" />}
                                    {t("revokeAllConfirmButton")}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowConfirmAll(true)}
                            className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors bg-transparent border-none cursor-pointer"
                        >
                            <RefreshCw size={13} /> {t("revokeAll")}
                        </button>
                    )}
                </>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-lg animate-in bg-emerald-500">
                    {toast}
                </div>
            )}
        </div>
    );
}

function SsoSettings() {
    const t = useTranslations("settings.securityPage.sso");
    const tc = useTranslations("common");
    const { user } = useAuth();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    const [planAllows, setPlanAllows] = useState(false);

    const [enabled, setEnabled] = useState(false);
    const [idpEntityId, setIdpEntityId] = useState("");
    const [idpSsoUrl, setIdpSsoUrl] = useState("");
    const [idpCertificate, setIdpCertificate] = useState("");
    const [emailDomains, setEmailDomains] = useState("");
    const [forceSso, setForceSso] = useState(false);
    const [defaultRole, setDefaultRole] = useState("tenant_agent");

    const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
    const tenantId = (user as any)?.tenantId;

    const loadConfig = async () => {
        setLoading(true);
        try {
            const res = await api.getSsoConfig();
            if (res.success && res.data) {
                setPlanAllows(true);
                const c = res.data as any;
                setEnabled(c.enabled || false);
                setIdpEntityId(c.idpEntityId || "");
                setIdpSsoUrl(c.idpSsoUrl || "");
                setIdpCertificate(c.idpCertificate === "***CONFIGURED***" ? "" : (c.idpCertificate || ""));
                setEmailDomains((c.emailDomains || []).join(", "));
                setForceSso(c.forceSso || false);
                setDefaultRole(c.defaultRole || "tenant_agent");
            } else if (res.error?.includes("plan_limit")) {
                setPlanAllows(false);
            } else {
                setPlanAllows(true);
            }
        } catch {
            setPlanAllows(true);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadConfig();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            const domains = emailDomains.split(",").map(d => d.trim()).filter(Boolean);
            const body: Record<string, any> = {
                enabled,
                idpEntityId,
                idpSsoUrl,
                emailDomains: domains,
                forceSso,
                defaultRole,
            };
            if (idpCertificate) body.idpCertificate = idpCertificate;

            const res = await api.updateSsoConfig(body);
            if (res.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(res.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("connectionError"));
        }
        setSaving(false);
    };

    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";
    const labelClasses = "mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300";
    const spEntityId = `${API_URL}/auth/saml/metadata/${tenantId}`;
    const acsUrl = `${API_URL}/auth/saml/acs`;

    if (loading) {
        return (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                    <Loader2 size={16} className="animate-spin text-neutral-400" />
                    <span className="text-sm text-neutral-500">{tc("loading")}</span>
                </div>
            </div>
        );
    }

    if (!planAllows) {
        return (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-start gap-3">
                    <Globe size={20} className="text-neutral-400 mt-0.5" />
                    <div>
                        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{t("title")}</h2>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("enterpriseOnly")}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start justify-between mb-5">
                <div>
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{t("title")}</h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("desc")}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-neutral-600 peer-checked:bg-emerald-500"></div>
                    <span className="ml-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                        {enabled ? t("enabled") : t("disabled")}
                    </span>
                </label>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 mb-4">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="space-y-4">
                <div>
                    <label className={labelClasses}>{t("idpEntityId")}</label>
                    <input value={idpEntityId} onChange={(e) => setIdpEntityId(e.target.value)}
                        placeholder={t("idpEntityIdPh")} className={inputClasses} />
                </div>

                <div>
                    <label className={labelClasses}>{t("idpSsoUrl")}</label>
                    <input value={idpSsoUrl} onChange={(e) => setIdpSsoUrl(e.target.value)}
                        placeholder={t("idpSsoUrlPh")} className={inputClasses} />
                </div>

                <div>
                    <label className={labelClasses}>{t("idpCertificate")}</label>
                    <textarea value={idpCertificate} onChange={(e) => setIdpCertificate(e.target.value)}
                        placeholder={t("idpCertificatePh")} rows={4}
                        className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors resize-none" />
                </div>

                <div>
                    <label className={labelClasses}>{t("emailDomains")}</label>
                    <input value={emailDomains} onChange={(e) => setEmailDomains(e.target.value)}
                        placeholder={t("emailDomainsPh")} className={inputClasses} />
                    <p className="mt-1 text-xs text-neutral-400">{t("emailDomainsHint")}</p>
                </div>

                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("forceSso")}</p>
                        <p className="text-xs text-neutral-400">{t("forceSsoDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={forceSso} onChange={(e) => setForceSso(e.target.checked)} className="sr-only peer" />
                        <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer dark:bg-neutral-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-neutral-600 peer-checked:bg-emerald-500"></div>
                    </label>
                </div>

                <div>
                    <label className={labelClasses}>{t("defaultRole")}</label>
                    <select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}
                        className={inputClasses}>
                        <option value="tenant_agent">{t("roleAgent")}</option>
                        <option value="tenant_supervisor">{t("roleSupervisor")}</option>
                        <option value="tenant_admin">{t("roleAdmin")}</option>
                    </select>
                    <p className="mt-1 text-xs text-neutral-400">{t("defaultRoleDesc")}</p>
                </div>

                {/* SP Metadata */}
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 bg-neutral-50 dark:bg-neutral-800/50">
                    <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">{t("spMetadata")}</h3>
                    <p className="text-xs text-neutral-400 mb-3">{t("spMetadataDesc")}</p>

                    <div className="space-y-2 text-xs">
                        <div>
                            <span className="font-medium text-neutral-600 dark:text-neutral-400">{t("spEntityId")}:</span>
                            <code className="ml-2 px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 select-all">
                                {spEntityId}
                            </code>
                        </div>
                        <div>
                            <span className="font-medium text-neutral-600 dark:text-neutral-400">{t("acsUrl")}:</span>
                            <code className="ml-2 px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 select-all">
                                {acsUrl}
                            </code>
                        </div>
                    </div>

                    {tenantId && (
                        <a href={`${API_URL}/auth/saml/metadata/${tenantId}`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                            <Download size={13} /> {t("downloadMetadata")}
                            <ExternalLink size={11} />
                        </a>
                    )}
                </div>

                <div className="flex justify-end pt-2">
                    <button onClick={handleSave} disabled={saving}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-all press-effect",
                            saved ? "bg-emerald-500" : "bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90",
                            saving && "opacity-50 cursor-not-allowed"
                        )}>
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        {saved ? <><CheckCircle size={16} /> {t("saved")}</> : tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
