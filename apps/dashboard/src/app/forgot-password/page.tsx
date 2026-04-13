"use client";

import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
    Mail,
    Lock,
    Eye,
    EyeOff,
    AlertCircle,
    ArrowLeft,
    CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AnimatedLogo from "@/components/AnimatedLogo";

const API_URL =
    process.env.NEXT_PUBLIC_API_URL ||
    "https://api.parallly-chat.cloud/api/v1";

export default function ForgotPasswordPage() {
    const t = useTranslations('auth');
    const router = useRouter();

    // Step: 1 = request code, 2 = reset password
    const [step, setStep] = useState<1 | 2>(1);
    const [email, setEmail] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");

    // Step 2 state
    const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Password requirements
    const requirements = [
        { label: t('passwordRequirements.minLength'), test: (p: string) => p.length >= 8 },
        { label: t('passwordRequirements.uppercase'), test: (p: string) => /[A-Z]/.test(p) },
        { label: t('passwordRequirements.lowercase'), test: (p: string) => /[a-z]/.test(p) },
        { label: t('passwordRequirements.number'), test: (p: string) => /\d/.test(p) },
        {
            label: t('passwordRequirements.special'),
            test: (p: string) => /[^A-Za-z0-9]/.test(p),
        },
    ];

    const allRequirementsMet = requirements.every((r) => r.test(newPassword));
    const passwordsMatch =
        newPassword.length > 0 && newPassword === confirmPassword;

    // Redirect on success
    useEffect(() => {
        if (!successMessage) return;
        const timeout = setTimeout(() => router.push("/login"), 2000);
        return () => clearTimeout(timeout);
    }, [successMessage, router]);

    // --- Step 1: Request code ---
    const handleRequestCode = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        try {
            const res = await fetch(`${API_URL}/auth/forgot-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(
                    data.message || "Error al enviar el codigo. Intenta de nuevo."
                );
                setIsSubmitting(false);
                return;
            }

            setStep(2);
        } catch {
            setError("Error de conexion con el servidor");
        }

        setIsSubmitting(false);
    };

    // --- Step 2: OTP input handlers ---
    const handleDigitChange = (index: number, value: string) => {
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
            return;
        }

        newDigits[index] = value;
        setDigits(newDigits);

        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleDigitKeyDown = (
        index: number,
        e: KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === "Backspace" && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    // --- Step 2: Reset password ---
    const handleResetPassword = async (e: FormEvent) => {
        e.preventDefault();
        setError("");

        const code = digits.join("");
        if (code.length !== 6) {
            setError("Ingresa el codigo de 6 digitos");
            return;
        }

        if (!allRequirementsMet) {
            setError("La contrasena no cumple con los requisitos");
            return;
        }

        if (!passwordsMatch) {
            setError("Las contrasenas no coinciden");
            return;
        }

        setIsSubmitting(true);

        try {
            const res = await fetch(`${API_URL}/auth/reset-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code, newPassword }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(
                    data.message ||
                        "Error al restablecer la contrasena. Verifica el codigo."
                );
                setIsSubmitting(false);
                return;
            }

            setSuccessMessage(
                "Contrasena restablecida correctamente. Redirigiendo al inicio de sesion..."
            );
        } catch {
            setError("Error de conexion con el servidor");
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
                        {t('resetPassword')}
                    </p>
                </div>

                {/* Card */}
                <div className="p-8 rounded-2xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    {/* Success message */}
                    {successMessage ? (
                        <div className="text-center py-4">
                            <div className="flex justify-center mb-4">
                                <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                                    <CheckCircle2
                                        size={28}
                                        className="text-emerald-600 dark:text-emerald-400"
                                    />
                                </div>
                            </div>
                            <h2 className="text-xl font-bold text-foreground mb-2">
                                Contrasena restablecida
                            </h2>
                            <p className="text-muted-foreground text-sm">
                                {successMessage}
                            </p>
                        </div>
                    ) : step === 1 ? (
                        /* ===== STEP 1: Request Code ===== */
                        <>
                            <div className="flex justify-center mb-4">
                                <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
                                    <Mail
                                        size={28}
                                        className="text-indigo-600 dark:text-indigo-400"
                                    />
                                </div>
                            </div>

                            <h1 className="text-2xl font-bold text-foreground mb-1 text-center">
                                {t('resetPassword')}
                            </h1>
                            <p className="text-muted-foreground text-sm mb-6 text-center">
                                Ingresa tu correo electronico y te enviaremos un
                                codigo de verificacion
                            </p>

                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                                    <AlertCircle size={16} className="shrink-0" />{" "}
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleRequestCode}>
                                <div className="mb-6">
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                        {t('email')}
                                    </label>
                                    <div className="relative">
                                        <Mail
                                            size={18}
                                            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
                                        />
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) =>
                                                setEmail(e.target.value)
                                            }
                                            placeholder="tu@correo.com"
                                            required
                                            autoFocus
                                            className="w-full py-3 px-3.5 pl-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                        />
                                    </div>
                                </div>

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
                                    {isSubmitting
                                        ? "Enviando..."
                                        : t('sendCode')}
                                </button>
                            </form>
                        </>
                    ) : (
                        /* ===== STEP 2: Reset Password ===== */
                        <>
                            {/* Back to step 1 */}
                            <button
                                type="button"
                                onClick={() => {
                                    setStep(1);
                                    setError("");
                                    setDigits(["", "", "", "", "", ""]);
                                    setNewPassword("");
                                    setConfirmPassword("");
                                }}
                                className="flex items-center gap-1 text-muted-foreground text-[13px] mb-4 bg-transparent border-none cursor-pointer p-0 hover:text-indigo-500 transition-colors"
                            >
                                <ArrowLeft size={14} /> Cambiar correo
                            </button>

                            <h1 className="text-2xl font-bold text-foreground mb-1">
                                {t('resetPassword')}
                            </h1>
                            <p className="text-muted-foreground text-sm mb-6">
                                Enviamos un codigo a{" "}
                                <span className="font-medium text-foreground">
                                    {email}
                                </span>
                            </p>

                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                                    <AlertCircle size={16} className="shrink-0" />{" "}
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleResetPassword}>
                                {/* OTP Inputs */}
                                <div className="mb-5">
                                    <label className="block text-[13px] text-muted-foreground mb-2 font-medium">
                                        Codigo de verificacion
                                    </label>
                                    <div className="flex justify-center gap-3">
                                        {digits.map((digit, i) => (
                                            <input
                                                key={i}
                                                ref={(el) => {
                                                    inputRefs.current[i] = el;
                                                }}
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={6}
                                                value={digit}
                                                onChange={(e) =>
                                                    handleDigitChange(
                                                        i,
                                                        e.target.value
                                                    )
                                                }
                                                onKeyDown={(e) =>
                                                    handleDigitKeyDown(i, e)
                                                }
                                                disabled={isSubmitting}
                                                autoFocus={i === 0}
                                                className={cn(
                                                    "w-12 h-14 text-center text-2xl font-bold rounded-xl border outline-none transition-all",
                                                    "bg-gray-50 dark:bg-white/5 text-foreground",
                                                    digit
                                                        ? "border-indigo-500 dark:border-indigo-500/50 ring-1 ring-indigo-500/20"
                                                        : "border-gray-300 dark:border-white/10",
                                                    "focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20",
                                                    isSubmitting &&
                                                        "opacity-60 cursor-wait"
                                                )}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* New Password */}
                                <div className="mb-4">
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                        {t('newPassword')}
                                    </label>
                                    <div className="relative">
                                        <Lock
                                            size={18}
                                            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
                                        />
                                        <input
                                            type={
                                                showPassword
                                                    ? "text"
                                                    : "password"
                                            }
                                            value={newPassword}
                                            onChange={(e) =>
                                                setNewPassword(e.target.value)
                                            }
                                            placeholder="Minimo 8 caracteres"
                                            required
                                            className="w-full py-3 px-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setShowPassword(!showPassword)
                                            }
                                            className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground/50 p-0 hover:text-muted-foreground"
                                        >
                                            {showPassword ? (
                                                <EyeOff size={18} />
                                            ) : (
                                                <Eye size={18} />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Confirm Password */}
                                <div className="mb-4">
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                        {t('confirmPassword')}
                                    </label>
                                    <div className="relative">
                                        <Lock
                                            size={18}
                                            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
                                        />
                                        <input
                                            type={
                                                showConfirm
                                                    ? "text"
                                                    : "password"
                                            }
                                            value={confirmPassword}
                                            onChange={(e) =>
                                                setConfirmPassword(
                                                    e.target.value
                                                )
                                            }
                                            placeholder="Repite la contrasena"
                                            required
                                            className="w-full py-3 px-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setShowConfirm(!showConfirm)
                                            }
                                            className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground/50 p-0 hover:text-muted-foreground"
                                        >
                                            {showConfirm ? (
                                                <EyeOff size={18} />
                                            ) : (
                                                <Eye size={18} />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Password requirements checklist */}
                                <div className="mb-5 space-y-1.5">
                                    {requirements.map((req) => {
                                        const met = req.test(newPassword);
                                        return (
                                            <div
                                                key={req.label}
                                                className="flex items-center gap-2 text-[12px]"
                                            >
                                                <CheckCircle2
                                                    size={14}
                                                    className={cn(
                                                        "shrink-0 transition-colors",
                                                        met
                                                            ? "text-emerald-500"
                                                            : "text-gray-300 dark:text-white/15"
                                                    )}
                                                />
                                                <span
                                                    className={cn(
                                                        "transition-colors",
                                                        met
                                                            ? "text-emerald-600 dark:text-emerald-400"
                                                            : "text-muted-foreground"
                                                    )}
                                                >
                                                    {req.label}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {/* Password match indicator */}
                                    {confirmPassword.length > 0 && (
                                        <div className="flex items-center gap-2 text-[12px]">
                                            <CheckCircle2
                                                size={14}
                                                className={cn(
                                                    "shrink-0 transition-colors",
                                                    passwordsMatch
                                                        ? "text-emerald-500"
                                                        : "text-red-400"
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    "transition-colors",
                                                    passwordsMatch
                                                        ? "text-emerald-600 dark:text-emerald-400"
                                                        : "text-red-500 dark:text-red-400"
                                                )}
                                            >
                                                {passwordsMatch
                                                    ? "Las contrasenas coinciden"
                                                    : "Las contrasenas no coinciden"}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={
                                        isSubmitting ||
                                        !allRequirementsMet ||
                                        !passwordsMatch
                                    }
                                    className={cn(
                                        "w-full py-3.5 rounded-xl border-none text-white text-[15px] font-semibold transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)]",
                                        isSubmitting ||
                                            !allRequirementsMet ||
                                            !passwordsMatch
                                            ? "bg-indigo-400 dark:bg-indigo-600/50 cursor-not-allowed opacity-70"
                                            : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:shadow-[0_6px_20px_rgba(108,92,231,0.4)] hover:brightness-110"
                                    )}
                                >
                                    {isSubmitting
                                        ? "Restableciendo..."
                                        : t('resetPassword')}
                                </button>
                            </form>
                        </>
                    )}
                </div>

                {/* Back to login */}
                <div className="text-center mt-5">
                    <Link
                        href="/login"
                        className="text-muted-foreground text-[13px] no-underline hover:text-indigo-500 transition-colors inline-flex items-center gap-1.5"
                    >
                        <ArrowLeft size={14} />
                        Volver al inicio de sesion
                    </Link>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">
                    Powered by{" "}
                    <a
                        href="https://parallext.com"
                        target="_blank"
                        className="text-indigo-500 hover:text-indigo-400"
                    >
                        Parallext.com
                    </a>
                </p>
            </div>
        </div>
    );
}
