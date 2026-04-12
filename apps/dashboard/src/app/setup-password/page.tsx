"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, Eye, EyeOff, AlertCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import AnimatedLogo from "@/components/AnimatedLogo";

export default function SetupPasswordPage() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    // Protected: redirect if no token
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) router.push("/login");
    }, [router]);

    const validations = [
        { label: "Al menos 8 caracteres", valid: password.length >= 8 },
        { label: "Al menos 1 letra mayúscula", valid: /[A-Z]/.test(password) },
        { label: "Al menos 1 letra minúscula", valid: /[a-z]/.test(password) },
        { label: "Al menos 1 número", valid: /[0-9]/.test(password) },
        { label: "Al menos 1 carácter especial (!@#$%^&*)", valid: /[!@#$%^&*]/.test(password) },
    ];

    const allValid = validations.every((v) => v.valid);
    const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
    const canSubmit = allValid && passwordsMatch && !isSubmitting;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setError("");
        setIsSubmitting(true);

        try {
            const result = await api.setupPassword(password);
            if (!result.success) {
                setError(result.error || "Error al establecer la contraseña");
                setIsSubmitting(false);
                return;
            }

            // Send verification email
            await api.sendVerification();

            router.push("/verify-email");
        } catch {
            setError("Error de conexión con el servidor");
        }
        setIsSubmitting(false);
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
                    <h1 className="text-2xl font-bold text-foreground mb-1">
                        Establece tu contraseña
                    </h1>
                    <p className="text-muted-foreground text-sm mb-6">
                        Crea una contraseña segura para acceder a tu cuenta
                    </p>

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {/* Password */}
                        <div className="mb-4">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Contraseña
                            </label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
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

                        {/* Confirm Password */}
                        <div className="mb-4">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Confirmar contraseña
                            </label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type={showConfirm ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full py-3 px-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(!showConfirm)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground/50 p-0 hover:text-muted-foreground"
                                >
                                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Validation checklist */}
                        <div className="mb-6 space-y-1.5">
                            {validations.map((v, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "flex items-center gap-2 text-[13px] transition-colors",
                                        v.valid
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-muted-foreground/60"
                                    )}
                                >
                                    {v.valid ? <Check size={14} /> : <X size={14} />}
                                    {v.label}
                                </div>
                            ))}
                            <div
                                className={cn(
                                    "flex items-center gap-2 text-[13px] transition-colors",
                                    passwordsMatch
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-muted-foreground/60"
                                )}
                            >
                                {passwordsMatch ? <Check size={14} /> : <X size={14} />}
                                Las contraseñas coinciden
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className={cn(
                                "w-full py-3.5 rounded-xl border-none text-white text-[15px] font-semibold transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)]",
                                !canSubmit
                                    ? "bg-indigo-400/50 dark:bg-indigo-600/30 cursor-not-allowed"
                                    : isSubmitting
                                        ? "bg-indigo-400 dark:bg-indigo-600/50 cursor-wait"
                                        : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:shadow-[0_6px_20px_rgba(108,92,231,0.4)] hover:brightness-110"
                            )}
                        >
                            {isSubmitting ? "Estableciendo..." : "Establecer contraseña"}
                        </button>
                    </form>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
