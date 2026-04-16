"use client";

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import AnimatedLogo from "@/components/AnimatedLogo";

export default function VerifyEmailPage() {
    const t = useTranslations('auth');
    const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [userEmail, setUserEmail] = useState("");
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
    }, [router]);

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
                    setError(result.error || t('wrongCode'));
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
        try {
            const result = await api.sendVerification();
            if (!result.success) {
                setError(result.error || t('resendCodeError'));
                return;
            }
            setCooldown(60);
        } catch {
            setError(t('connectionError'));
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[420px] relative z-10">
                {/* Logo */}
                <div className="text-center mb-8">
                    <AnimatedLogo height={44} animate showPoweredBy={false} />
                </div>

                {/* Card */}
                <div className="p-8 rounded-2xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    {/* Email icon */}
                    <div className="flex justify-center mb-4">
                        <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
                            <Mail size={28} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold text-foreground mb-1 text-center">
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
                                    "w-12 h-14 text-center text-2xl font-bold rounded-xl border outline-none transition-all",
                                    "bg-gray-50 dark:bg-white/5 text-foreground",
                                    digit
                                        ? "border-indigo-500 dark:border-indigo-500/50 ring-1 ring-indigo-500/20"
                                        : "border-gray-300 dark:border-white/10",
                                    "focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20",
                                    isSubmitting && "opacity-60 cursor-wait"
                                )}
                            />
                        ))}
                    </div>

                    {/* Loading indicator */}
                    {isSubmitting && (
                        <div className="flex justify-center mb-4">
                            <div className="w-6 h-6 border-2 border-gray-300 dark:border-white/20 border-t-indigo-500 rounded-full animate-spin" />
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
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
