"use client";

import { useState, useEffect, useCallback, useRef, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { Lock, Mail, Eye, EyeOff, AlertCircle, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import AnimatedLogo from "@/components/AnimatedLogo";
import LocaleSwitcher from "@/components/LocaleSwitcher";

const GOOGLE_CLIENT_ID =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    "950001098107-4ctk2jm3876afqktip7r4f04120kt0ou.apps.googleusercontent.com";

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: any) => void;
                    renderButton: (element: HTMLElement, config: any) => void;
                    prompt: () => void;
                };
            };
        };
    }
}

export default function LoginPage() {
    const t = useTranslations('auth');
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleReady, setGoogleReady] = useState(false);
    const googleHiddenRef = useRef<HTMLDivElement>(null);
    const { login, googleLogin } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const sessionExpired = searchParams.get("expired") === "1";

    const handleGoogleCallback = useCallback(
        async (response: { credential: string }) => {
            setError("");
            setIsGoogleLoading(true);
            const result = await googleLogin(response.credential, rememberMe);
            if (result.success && result.redirect) {
                router.push(result.redirect);
            } else {
                setError(result.error || t('googleLoginError'));
            }
            setIsGoogleLoading(false);
        },
        [googleLogin, router]
    );

    // Load GSI script and render hidden button (works even without Google session)
    useEffect(() => {
        const initGsi = () => {
            if (!window.google || !googleHiddenRef.current) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleCallback,
                ux_mode: "popup",
                use_fedcm_for_prompt: false,
            });
            window.google.accounts.id.renderButton(googleHiddenRef.current, {
                type: "icon",
                size: "large",
            });
            setGoogleReady(true);
        };

        if (window.google) { initGsi(); return; }

        if (!document.getElementById("google-gsi-script")) {
            const script = document.createElement("script");
            script.id = "google-gsi-script";
            script.src = "https://accounts.google.com/gsi/client";
            script.async = true;
            script.defer = true;
            script.onload = () => initGsi();
            document.head.appendChild(script);
        }
    }, [handleGoogleCallback]);

    const handleGoogleClick = () => {
        const btn = googleHiddenRef.current?.querySelector('[role="button"]') as HTMLElement;
        if (btn) {
            btn.click();
        } else if (window.google) {
            window.google.accounts.id.prompt();
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        const result = await login(email, password, rememberMe);

        if (result.success) {
            router.push(result.redirect || "/admin");
        } else {
            setError(result.error || t('loginError'));
        }
        setIsSubmitting(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects (dark mode only) */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[420px] relative z-10">
                {/* Top bar: back + language */}
                <div className="flex items-center justify-between mb-6">
                    <a
                        href="https://parallly-chat.cloud"
                        className="inline-flex items-center gap-1.5 text-muted-foreground text-[13px] no-underline hover:text-indigo-500 transition-colors"
                    >
                        <ArrowLeft size={14} /> {t('backToLanding')}
                    </a>
                    <LocaleSwitcher />
                </div>

                {/* Logo */}
                <div className="text-center mb-8">
                    <AnimatedLogo height={44} animate showPoweredBy={false} />
                    <p className="text-muted-foreground text-sm mt-3">
                        {t('platform')}
                    </p>
                </div>

                {/* Login Card */}
                <div className="p-8 rounded-2xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    <h1 className="text-2xl font-bold text-foreground mb-1">
                        {t('login')}
                    </h1>
                    <p className="text-muted-foreground text-sm mb-6">
                        {t('enterCredentials')}
                    </p>

                    {/* Session expired notice */}
                    {sessionExpired && !error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-[13px]">
                            <AlertCircle size={16} /> {t('sessionExpired')}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* Google Sign-In Button (custom styled) */}
                    <button
                        type="button"
                        onClick={handleGoogleClick}
                        disabled={!googleReady || isGoogleLoading}
                        className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-gray-300 dark:border-white/15 bg-white dark:bg-white/[0.06] text-foreground text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                        {!googleReady ? (
                            <>
                                <div className="w-5 h-5 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
                                {t('loadingGoogle')}
                            </>
                        ) : (
                            <>
                                <svg width="18" height="18" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                </svg>
                                {t('continueWithGoogle')}
                            </>
                        )}
                    </button>
                    {/* Hidden Google rendered button */}
                    <div ref={googleHiddenRef} className="hidden" />
                    {isGoogleLoading && (
                        <div className="flex items-center justify-center gap-2 mt-2 text-sm text-muted-foreground">
                            <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
                            {t('verifying')}
                        </div>
                    )}

                    {/* Separator */}
                    <div className="flex items-center gap-3 my-6">
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                        <span className="text-xs text-muted-foreground">{t('or')}</span>
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Email */}
                        <div className="mb-4">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                {t('email')}
                            </label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="admin@parallext.com"
                                    required
                                    className="w-full py-3 px-3.5 pl-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[13px] text-muted-foreground font-medium">
                                    {t('password')}
                                </label>
                                <Link href="/forgot-password" className="text-[12px] text-indigo-500 hover:text-indigo-400 no-underline">
                                    {t('forgotPassword')}
                                </Link>
                            </div>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="w-full py-3 px-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground/50 p-0 hover:text-muted-foreground"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Remember Me */}
                        <label className="flex items-center gap-2 mb-6 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={(e) => setRememberMe(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 dark:border-white/20 text-indigo-500 focus:ring-indigo-500/30 bg-gray-50 dark:bg-white/5 cursor-pointer"
                            />
                            <span className="text-[13px] text-muted-foreground">{t('rememberMe')}</span>
                        </label>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={cn(
                                "w-full py-3.5 rounded-xl border-none text-white text-[15px] font-semibold transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)]",
                                isSubmitting
                                    ? "bg-indigo-400 dark:bg-indigo-600/50 cursor-wait"
                                    : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:shadow-[0_6px_20px_rgba(108,92,231,0.4)] hover:brightness-110"
                            )}
                        >
                            {isSubmitting ? t('submitting') : t('login')}
                        </button>
                    </form>
                </div>

                {/* Signup Link */}
                <div className="text-center mt-5">
                    <Link
                        href="/signup"
                        className="text-muted-foreground text-[13px] no-underline hover:text-indigo-500 transition-colors"
                    >
                        {t('noAccount')} <span className="font-semibold">{t('createFreeAccount')} →</span>
                    </Link>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
