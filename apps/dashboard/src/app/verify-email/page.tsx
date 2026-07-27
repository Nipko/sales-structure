"use client";

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedLogo from "@/components/AnimatedLogo";

export default function VerifyEmailPage() {
    const t = useTranslations('auth');
    const tc = useTranslations('common');
    const { logout } = useAuth();
    const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [deliveryFailed, setDeliveryFailed] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [userEmail, setUserEmail] = useState("");
    const [editingEmail, setEditingEmail] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [savingEmail, setSavingEmail] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const router = useRouter();

    // Protected: redirect if no token; load user email
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) {
            router.push("/login");
            return;
        }
        const savedUser = localStorage.getItem("user");
        if (savedUser) {
            try {
                const u = JSON.parse(savedUser);
                setUserEmail(u.email || "");
            } catch { /* ignore */ }
        }
        // El signup avisa si el correo no llegó a salir (SMTP caído). Sin esto el
        // usuario se queda mirando una pantalla esperando un mail que nunca se envió.
        try {
            if (sessionStorage.getItem("verificationEmailFailed") === "1") {
                setDeliveryFailed(true);
                sessionStorage.removeItem("verificationEmailFailed");
            }
        } catch { /* sessionStorage no disponible */ }
    }, [router]);

    const handleChangeEmail = async () => {
        const email = newEmail.trim();
        if (!email) return;
        setError("");
        setNotice("");
        setSavingEmail(true);
        try {
            const result = await api.changePendingEmail(email);
            if (!result.success) {
                const code = result.errorCode || "";
                setError(
                    code === "email_taken" ? t('emailTakenError')
                        : code === "invalid_email" ? t('invalidEmailError')
                            : code === "email_send_failed" ? t('emailDeliveryFailed')
                                // Sin código conocido cae al mensaje del backend, que ya
                                // viene en español (p. ej. el de correos desechables).
                                : result.error || t('connectionError')
                );
                setSavingEmail(false);
                return;
            }
            const saved = result.data?.email || email;
            setUserEmail(saved);
            // Mantener el usuario en localStorage al día: el resto de la app lee de ahí.
            try {
                const savedUser = localStorage.getItem("user");
                if (savedUser) {
                    const u = JSON.parse(savedUser);
                    u.email = saved;
                    localStorage.setItem("user", JSON.stringify(u));
                }
            } catch { /* ignore */ }
            setDeliveryFailed(result.data?.verificationEmailSent === false);
            setNotice(t('emailChangedSuccess', { email: saved }));
            setEditingEmail(false);
            setNewEmail("");
            setDigits(["", "", "", "", "", ""]);
            setCooldown(60);
        } catch {
            setError(t('connectionError'));
        }
        setSavingEmail(false);
    };

    // Cooldown timer
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
        return () => clearInterval(timer);
    }, [cooldown]);

    const submitCode = useCallback(
        async (code: string) => {
            setError("");
            setIsSubmitting(true);
            try {
                const result = await api.verifyEmail(code);
                if (!result.success) {
                    setError(result.errorCode === "invalid_verification_code"
                        ? t('wrongCode')
                        : result.error || t('wrongCode'));
                    setIsSubmitting(false);
                    return;
                }
                // Update user in localStorage
                const savedUser = localStorage.getItem("user");
                if (savedUser) {
                    try {
                        const u = JSON.parse(savedUser);
                        u.emailVerified = true;
                        localStorage.setItem("user", JSON.stringify(u));
                    } catch { /* ignore */ }
                }
                router.push("/onboarding");
            } catch {
                setError(t('connectionError'));
            }
            setIsSubmitting(false);
        },
        [router]
    );

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return;

        const newDigits = [...digits];

        if (value.length > 1) {
            // Handle paste
            const pasted = value.slice(0, 6).split("");
            pasted.forEach((d, i) => {
                if (index + i < 6) newDigits[index + i] = d;
            });
            setDigits(newDigits);
            const nextIdx = Math.min(index + pasted.length, 5);
            inputRefs.current[nextIdx]?.focus();

            // Auto-submit if all filled
            if (newDigits.every((d) => d !== "")) {
                submitCode(newDigits.join(""));
            }
            return;
        }

        newDigits[index] = value;
        setDigits(newDigits);

        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }

        // Auto-submit when all 6 filled
        if (newDigits.every((d) => d !== "")) {
            submitCode(newDigits.join(""));
        }
    };

    const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleResend = async () => {
        if (cooldown > 0) return;
        setError("");
        setNotice("");
        try {
            const result = await api.sendVerification();
            if (!result.success) {
                // El backend ahora devuelve 503 email_send_failed cuando el correo no
                // llegó a salir, en vez de responder success y dejar al usuario esperando.
                if (result.errorCode === "email_send_failed" || result.error === "email_send_failed") {
                    setDeliveryFailed(true);
                    setError(t('emailDeliveryFailed'));
                } else {
                    setError(result.error || t('resendCodeError'));
                }
                return;
            }
            setDeliveryFailed(false);
            setCooldown(60);
        } catch {
            setError(t('connectionError'));
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[420px] relative z-10">
                {/* Logo */}
                <div className="text-center mb-8">
                    <AnimatedLogo height={44} animate showPoweredBy={false} />
                </div>

                {/* Card */}
                <div className="p-8 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    {/* Email icon */}
                    <div className="flex justify-center mb-4">
                        <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
                            <Mail size={28} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-semibold text-foreground mb-1 text-center">
                        {t('verifyCode')}
                    </h1>
                    <p className="text-muted-foreground text-sm mb-8 text-center">
                        {t('codeSentToEmail')}{" "}
                        <span className="font-medium text-foreground">
                            {userEmail || t('yourEmail')}
                        </span>
                    </p>

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* El correo no llegó a salir: decirlo, en vez de dejarlo esperando */}
                    {deliveryFailed && !error && (
                        <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-[13px]">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {t('emailDeliveryFailed')}
                        </div>
                    )}

                    {notice && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[13px]">
                            <Mail size={16} /> {notice}
                        </div>
                    )}

                    {/* OTP Inputs */}
                    <div className="flex justify-center gap-3 mb-6">
                        {digits.map((digit, i) => (
                            <input
                                key={i}
                                ref={(el) => { inputRefs.current[i] = el; }}
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={digit}
                                onChange={(e) => handleChange(i, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(i, e)}
                                disabled={isSubmitting}
                                autoFocus={i === 0}
                                className={cn(
                                    "w-12 h-14 text-center text-2xl font-semibold rounded-xl border outline-none transition-all",
                                    "bg-neutral-50 dark:bg-white/5 text-foreground",
                                    digit
                                        ? "border-indigo-500 dark:border-indigo-500/50 ring-1 ring-indigo-500/20"
                                        : "border-neutral-300 dark:border-white/10",
                                    "focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20",
                                    isSubmitting && "opacity-60 cursor-wait"
                                )}
                            />
                        ))}
                    </div>

                    {/* Loading indicator */}
                    {isSubmitting && (
                        <div className="flex justify-center mb-4">
                            <div className="w-6 h-6 border-2 border-neutral-300 dark:border-white/20 border-t-indigo-500 rounded-full animate-spin" />
                        </div>
                    )}

                    {/* Resend */}
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={cooldown > 0}
                            className={cn(
                                "text-[13px] bg-transparent border-none p-0 transition-colors",
                                cooldown > 0
                                    ? "text-muted-foreground/50 cursor-not-allowed"
                                    : "text-indigo-500 hover:text-indigo-400 cursor-pointer"
                            )}
                        >
                            {cooldown > 0
                                ? t('resendCodeCountdown', { seconds: cooldown })
                                : t('resendCode')}
                        </button>
                    </div>

                    {/* Salidas. Un correo mal tipeado era un callejón sin salida: el código
                        iba a una casilla ajena y cada login futuro volvía a esta pantalla. */}
                    <div className="mt-6 pt-5 border-t border-neutral-200 dark:border-white/[0.08]">
                        {editingEmail ? (
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('newEmailLabel')}
                                </label>
                                <input
                                    type="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    placeholder={t('resetEmailPlaceholder')}
                                    autoFocus
                                    className="w-full py-2.5 px-3.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                />
                                <div className="flex items-center gap-2 mt-3">
                                    <button
                                        type="button"
                                        onClick={handleChangeEmail}
                                        disabled={!newEmail.trim() || savingEmail}
                                        className={cn(
                                            "flex-1 py-2.5 rounded-xl border-none text-white text-[13px] font-semibold transition-all",
                                            !newEmail.trim() || savingEmail
                                                ? "bg-indigo-400/50 dark:bg-indigo-600/30 cursor-not-allowed"
                                                : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:brightness-110"
                                        )}
                                    >
                                        {savingEmail ? t('verifying') : t('saveNewEmail')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setEditingEmail(false); setNewEmail(""); setError(""); }}
                                        className="px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-transparent text-[13px] font-medium text-foreground hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                    >
                                        {tc('cancel')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => { setEditingEmail(true); setNewEmail(userEmail); }}
                                    className="text-[12px] text-indigo-500 hover:text-indigo-400 bg-transparent border-none p-0 transition-colors cursor-pointer"
                                >
                                    {t('wrongEmailQuestion')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => logout()}
                                    className="text-[12px] text-muted-foreground hover:text-foreground bg-transparent border-none p-0 transition-colors cursor-pointer"
                                >
                                    {t('logout')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">{t('poweredBy')} <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
