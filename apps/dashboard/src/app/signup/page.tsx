"use client";

import { useState, useCallback, useEffect, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { User, Mail, Lock, Eye, EyeOff, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import AnimatedLogo from "@/components/AnimatedLogo";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
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

const inputClasses = "w-full py-3 px-3.5 pl-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20";

export default function SignupPage() {
    const t = useTranslations('auth');
    const [form, setForm] = useState({
        email: "", password: "", firstName: "", lastName: "",
    });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleReady, setGoogleReady] = useState(false);
    const googleWrapperRef = useRef<HTMLDivElement>(null);
    const { googleLogin } = useAuth();
    const router = useRouter();

    const updateField = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleGoogleCallback = useCallback(
        async (response: { credential: string }) => {
            setError("");
            setIsGoogleLoading(true);
            const result = await googleLogin(response.credential);
            if (result.success && result.redirect) {
                router.push(result.redirect);
            } else {
                setError(result.error || "Error al registrarse con Google");
            }
            setIsGoogleLoading(false);
        },
        [googleLogin, router]
    );

    // Load GSI script and render Google button
    useEffect(() => {
        const renderBtn = () => {
            if (!window.google || !googleWrapperRef.current) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleCallback,
                ux_mode: "popup",
                use_fedcm_for_prompt: false,
            });
            window.google.accounts.id.renderButton(googleWrapperRef.current, {
                type: "standard",
                theme: "outline",
                size: "large",
                text: "signup_with",
                width: 400,
                locale: "es",
            });
            setGoogleReady(true);
        };

        if (window.google) { renderBtn(); return; }

        if (!document.getElementById("google-gsi-script")) {
            const script = document.createElement("script");
            script.id = "google-gsi-script";
            script.src = "https://accounts.google.com/gsi/client";
            script.async = true;
            script.defer = true;
            script.onload = () => renderBtn();
            document.head.appendChild(script);
        }
    }, [handleGoogleCallback]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        try {
            const res = await fetch(`${API_URL}/auth/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setError(data.message || "Error al crear la cuenta");
                setIsSubmitting(false);
                return;
            }

            // Store tokens and user — same as login
            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            // Email signup → verify email → onboarding wizard → admin
            router.push("/verify-email");
        } catch {
            setError("Error de conexión con el servidor");
        }
        setIsSubmitting(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects (dark mode only) */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[460px] relative z-10">
                {/* Logo */}
                <div className="text-center mb-6">
                    <AnimatedLogo height={44} animate showPoweredBy={false} />
                    <p className="text-muted-foreground text-sm mt-2.5">
                        {t('platform')}
                    </p>
                </div>

                {/* Card */}
                <div className="p-8 rounded-2xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    <h1 className="text-2xl font-bold text-foreground mb-1">
                        {t('signup')}
                    </h1>
                    <p className="text-muted-foreground text-sm mb-6">
                        Regístrate y comienza en minutos
                    </p>

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* Google Sign-In Button (rendered by Google GSI) */}
                    <div className="w-full flex justify-center">
                        <div ref={googleWrapperRef} className="w-full [&>div]:!w-full" />
                        {!googleReady && (
                            <div className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-gray-300 dark:border-white/15 bg-white dark:bg-white/[0.06] text-gray-400 text-sm cursor-wait">
                                <div className="w-5 h-5 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
                                Cargando Google...
                            </div>
                        )}
                    </div>
                    {isGoogleLoading && (
                        <div className="flex items-center justify-center gap-2 mt-2 text-sm text-muted-foreground">
                            <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
                            Verificando...
                        </div>
                    )}

                    {/* Separator */}
                    <div className="flex items-center gap-3 my-6">
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                        <span className="text-xs text-muted-foreground">{t('or')}</span>
                        <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Name row */}
                        <div className="grid grid-cols-2 gap-3 mb-3.5">
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">Nombre</label>
                                <div className="relative">
                                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={form.firstName}
                                        onChange={(e) => updateField("firstName", e.target.value)}
                                        placeholder="Juan"
                                        required
                                        className={inputClasses}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">Apellido</label>
                                <div className="relative">
                                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={form.lastName}
                                        onChange={(e) => updateField("lastName", e.target.value)}
                                        placeholder="Pérez"
                                        required
                                        className={inputClasses}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Email */}
                        <div className="mb-3.5">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Email corporativo
                            </label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => updateField("email", e.target.value)}
                                    placeholder="juan@miempresa.com"
                                    required
                                    className={inputClasses}
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
                                    value={form.password}
                                    onChange={(e) => updateField("password", e.target.value)}
                                    placeholder="Mínimo 6 caracteres"
                                    required
                                    minLength={6}
                                    className={cn(inputClasses, "pr-11")}
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
                            {isSubmitting ? "Creando tu cuenta..." : "Crear cuenta y comenzar"}
                        </button>
                    </form>

                    {/* Link to login */}
                    <div className="text-center mt-5">
                        <Link
                            href="/login"
                            className="text-muted-foreground text-[13px] no-underline inline-flex items-center gap-1.5 hover:text-indigo-500 transition-colors"
                        >
                            <ArrowLeft size={14} /> {t('hasAccount')}
                        </Link>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
