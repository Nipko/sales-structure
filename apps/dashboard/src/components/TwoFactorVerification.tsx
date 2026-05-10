"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck, Mail, Key, ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TwoFactorVerificationProps {
    twoFAToken: string;
    twoFactorMethod: string;
    userEmail?: string;
    rememberMe: boolean;
    onVerify: (twoFAToken: string, code: string, method: 'totp' | 'email' | 'backup', rememberMe: boolean) => Promise<{ success: boolean; error?: string; redirect?: string }>;
    onSendEmail: (twoFAToken: string) => Promise<boolean>;
    onBack: () => void;
    onSuccess: (redirect: string) => void;
}

const CODE_LENGTH = 6;

export default function TwoFactorVerification({
    twoFAToken, twoFactorMethod, userEmail, rememberMe,
    onVerify, onSendEmail, onBack, onSuccess,
}: TwoFactorVerificationProps) {
    const t = useTranslations("twoFactor");
    const [activeMethod, setActiveMethod] = useState<'totp' | 'email' | 'backup'>(
        twoFactorMethod === 'totp' ? 'totp' : 'email'
    );
    const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(""));
    const [backupCode, setBackupCode] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const [emailSending, setEmailSending] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (activeMethod !== 'backup') {
            inputRefs.current[0]?.focus();
        }
    }, [activeMethod]);

    const handleDigitChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return;
        const digit = value.slice(-1);
        const newCode = [...code];
        newCode[index] = digit;
        setCode(newCode);
        setError("");

        if (digit && index < CODE_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }

        if (digit && index === CODE_LENGTH - 1 && newCode.every(d => d)) {
            submitCode(newCode.join(""), activeMethod);
        }
    };

    const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !code[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
        if (!pasted) return;
        const newCode = Array(CODE_LENGTH).fill("");
        for (let i = 0; i < pasted.length; i++) newCode[i] = pasted[i];
        setCode(newCode);
        if (pasted.length === CODE_LENGTH) {
            submitCode(pasted, activeMethod);
        } else {
            inputRefs.current[pasted.length]?.focus();
        }
    };

    const submitCode = async (codeStr: string, method: 'totp' | 'email' | 'backup') => {
        setIsSubmitting(true);
        setError("");
        const result = await onVerify(twoFAToken, codeStr, method, rememberMe);
        if (result.success && result.redirect) {
            onSuccess(result.redirect);
        } else {
            setError(result.error || t("invalidCode"));
            setCode(Array(CODE_LENGTH).fill(""));
            inputRefs.current[0]?.focus();
        }
        setIsSubmitting(false);
    };

    const handleBackupSubmit = () => {
        if (!backupCode.trim()) return;
        submitCode(backupCode.trim(), 'backup');
    };

    const handleSendEmail = async () => {
        setEmailSending(true);
        const ok = await onSendEmail(twoFAToken);
        setEmailSending(false);
        if (ok) {
            setEmailSent(true);
            setActiveMethod('email');
            setCode(Array(CODE_LENGTH).fill(""));
        }
    };

    const switchMethod = (method: 'totp' | 'email' | 'backup') => {
        setActiveMethod(method);
        setCode(Array(CODE_LENGTH).fill(""));
        setBackupCode("");
        setError("");
    };

    return (
        <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-7 h-7 text-indigo-500" />
            </div>

            <h2 className="text-xl font-semibold text-foreground mb-1">
                {t("title")}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
                {activeMethod === 'totp' && t("totpDescription")}
                {activeMethod === 'email' && t("emailDescription", { email: userEmail || "***" })}
                {activeMethod === 'backup' && t("backupDescription")}
            </p>

            {error && (
                <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                    {error}
                </div>
            )}

            {/* Code input (TOTP & Email) */}
            {activeMethod !== 'backup' && (
                <div className="flex justify-center gap-2 mb-6" onPaste={handlePaste}>
                    {code.map((digit, i) => (
                        <input
                            key={i}
                            ref={el => { inputRefs.current[i] = el; }}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={e => handleDigitChange(i, e.target.value)}
                            onKeyDown={e => handleKeyDown(i, e)}
                            disabled={isSubmitting}
                            className={cn(
                                "w-11 h-13 text-center text-lg font-semibold rounded-xl border bg-neutral-50 dark:bg-white/5 text-foreground outline-none transition-colors",
                                digit
                                    ? "border-indigo-500 dark:border-indigo-500/50"
                                    : "border-neutral-300 dark:border-white/10",
                                "focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                            )}
                        />
                    ))}
                </div>
            )}

            {/* Backup code input */}
            {activeMethod === 'backup' && (
                <div className="mb-6">
                    <input
                        type="text"
                        value={backupCode}
                        onChange={e => { setBackupCode(e.target.value); setError(""); }}
                        placeholder={t("backupPlaceholder")}
                        disabled={isSubmitting}
                        className="w-full py-3 px-4 text-center text-lg font-mono tracking-widest rounded-xl border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                        onKeyDown={e => e.key === 'Enter' && handleBackupSubmit()}
                    />
                </div>
            )}

            {/* Verify button (for backup or manual submit) */}
            {(activeMethod === 'backup' || code.every(d => d)) && (
                <button
                    onClick={() => activeMethod === 'backup' ? handleBackupSubmit() : submitCode(code.join(""), activeMethod)}
                    disabled={isSubmitting}
                    className={cn(
                        "w-full py-3 rounded-xl border-none text-white text-sm font-semibold transition-all mb-4",
                        isSubmitting
                            ? "bg-indigo-400 dark:bg-indigo-600/50 cursor-wait"
                            : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:brightness-110"
                    )}
                >
                    {isSubmitting ? (
                        <span className="inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" /> {t("verifying")}
                        </span>
                    ) : t("verify")}
                </button>
            )}

            {/* Method switchers */}
            <div className="flex flex-col gap-2 mt-4">
                {activeMethod !== 'email' && (
                    <button
                        type="button"
                        onClick={handleSendEmail}
                        disabled={emailSending}
                        className="inline-flex items-center justify-center gap-2 text-[13px] text-muted-foreground hover:text-indigo-500 transition-colors bg-transparent border-none cursor-pointer"
                    >
                        <Mail size={14} />
                        {emailSending ? t("sendingEmail") : emailSent ? t("resendEmail") : t("useEmail")}
                    </button>
                )}
                {activeMethod !== 'totp' && twoFactorMethod === 'totp' && (
                    <button
                        type="button"
                        onClick={() => switchMethod('totp')}
                        className="inline-flex items-center justify-center gap-2 text-[13px] text-muted-foreground hover:text-indigo-500 transition-colors bg-transparent border-none cursor-pointer"
                    >
                        <ShieldCheck size={14} /> {t("useAuthenticator")}
                    </button>
                )}
                {activeMethod !== 'backup' && (
                    <button
                        type="button"
                        onClick={() => switchMethod('backup')}
                        className="inline-flex items-center justify-center gap-2 text-[13px] text-muted-foreground hover:text-indigo-500 transition-colors bg-transparent border-none cursor-pointer"
                    >
                        <Key size={14} /> {t("useBackupCode")}
                    </button>
                )}
            </div>

            {/* Back to login */}
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center justify-center gap-1.5 mt-6 text-[13px] text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none cursor-pointer"
            >
                <ArrowLeft size={14} /> {t("backToLogin")}
            </button>
        </div>
    );
}
