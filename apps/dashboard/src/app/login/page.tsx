"use client";

import { useState, useEffect, useCallback, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Lock, Mail, Eye, EyeOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import AnimatedLogo from "@/components/AnimatedLogo";

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

function GoogleLogo() {
    return (
        <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
    );
}

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleReady, setGoogleReady] = useState(false);
    const googleBtnRef = useRef<HTMLDivElement>(null);
    const { login, googleLogin } = useAuth();
    const router = useRouter();

    const handleGoogleCallback = useCallback(
        async (response: { credential: string }) => {
            setError("");
            setIsGoogleLoading(true);
            const result = await googleLogin(response.credential);
            if (result.success && result.redirect) {
                router.push(result.redirect);
            } else {
                setError(result.error || "Error al iniciar sesión con Google");
            }
            setIsGoogleLoading(false);
        },
        [googleLogin, router]
    );

    // Load Google Identity Services script and render hidden button
    useEffect(() => {
        const initGoogle = () => {
            if (!window.google || !googleBtnRef.current) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleCallback,
                ux_mode: "popup",
            });
            window.google.accounts.id.renderButton(googleBtnRef.current, {
                type: "standard",
                size: "large",
                width: 300,
            });
            setGoogleReady(true);
        };

        if (window.google) {
            initGoogle();
            return;
        }

        if (!document.getElementById("google-gsi-script")) {
            const script = document.createElement("script");
            script.id = "google-gsi-script";
            script.src = "https://accounts.google.com/gsi/client";
            script.async = true;
            script.defer = true;
            script.onload = () => initGoogle();
            document.head.appendChild(script);
        }
    }, [handleGoogleCallback]);

    const handleGoogleClick = useCallback(() => {
        // Click the hidden Google-rendered button
        const btn = googleBtnRef.current?.querySelector<HTMLElement>(
            'div[role="button"]'
        );
        if (btn) {
            btn.click();
        } else {
            setError("Google no está listo. Intenta de nuevo en un momento.");
        }
    }, []);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        const result = await login(email, password);

        if (result.success) {
            router.push(result.redirect || "/admin");
        } else {
            setError(result.error || "Error al iniciar sesión");
        }
        setIsSubmitting(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects (dark mode only) */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[420px] relative z-10">
                {/* Logo */}
                <div className="text-center mb-8">
                    <AnimatedLogo height={44} animate showPoweredBy={false} />
                    <p className="text-muted-foreground text-sm mt-3">
                        Plataforma de IA Conversacional
                    </p>
                </div>

                {/* Login Card */}
                <div className="p-8 rounded-2xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    <h1 className="text-2xl font-bold text-foreground mb-1">
                        Iniciar sesión
                    </h1>
                    <p className="text-muted-foreground text-sm mb-6">
                        Ingresa tus credenciales para continuar
                    </p>

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* Hidden Google-rendered button */}
                    <div ref={googleBtnRef} className="absolute overflow-hidden" style={{ width: 0, height: 0, opacity: 0, pointerEvents: "none" }} />

                    {/* Google Button */}
                    <button
                        type="button"
                        onClick={handleGoogleClick}
                        disabled={isGoogleLoading}
                        className={cn(
                            "w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border text-sm font-medium transition-all",
                            "bg-white dark:bg-white/[0.06] border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-200",
                            isGoogleLoading
                                ? "cursor-wait opacity-70"
                                : "cursor-pointer hover:bg-gray-50 dark:hover:bg-white/10 hover:border-gray-400 dark:hover:border-white/25"
                        )}
                    >
                        {isGoogleLoading ? (
                            <div className="w-5 h-5 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
                        ) : (
                            <GoogleLogo />
                        )}
                        Continuar con Google
                    </button>

                    {/* Separator */}
                    <div className="flex items-center gap-3 my-6">
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                        <span className="text-xs text-muted-foreground">o</span>
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Email */}
                        <div className="mb-4">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Email
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
                        <div className="mb-6">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Contraseña
                            </label>
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
                            {isSubmitting ? "Iniciando sesión..." : "Iniciar sesión"}
                        </button>
                    </form>
                </div>

                {/* Signup Link */}
                <div className="text-center mt-5">
                    <Link
                        href="/signup"
                        className="text-muted-foreground text-[13px] no-underline hover:text-indigo-500 transition-colors"
                    >
                        ¿Primera vez? <span className="font-semibold">Crea tu cuenta gratuita →</span>
                    </Link>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
