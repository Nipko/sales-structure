"use client";

import { useTranslations } from "next-intl";
import { useState, FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Lock, Eye, EyeOff, Check, X, AlertCircle, Shield, CheckCircle } from "lucide-react";

export default function SecurityPage() {
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
        { label: "Al menos 8 caracteres", valid: newPassword.length >= 8 },
        { label: "Al menos 1 letra mayúscula", valid: /[A-Z]/.test(newPassword) },
        { label: "Al menos 1 letra minúscula", valid: /[a-z]/.test(newPassword) },
        { label: "Al menos 1 número", valid: /[0-9]/.test(newPassword) },
        { label: "Al menos 1 carácter especial (!@#$%^&*)", valid: /[!@#$%^&*]/.test(newPassword) },
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
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Seguridad</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Contraseña y opciones de seguridad de tu cuenta
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* Change Password */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                    {isGoogleOnly ? "Establecer contraseña" : "Cambiar contraseña"}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5">
                    {isGoogleOnly
                        ? "Tu cuenta usa Google Sign-in. Establece una contraseña adicional para acceso directo."
                        : "Ingresa tu contraseña actual y elige una nueva"
                    }
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Current password (skip for Google-only) */}
                    {!isGoogleOnly && (
                        <div>
                            <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                                Contraseña actual
                            </label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                                <input
                                    type={showCurrent ? "text" : "password"}
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className={inputClasses}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCurrent(!showCurrent)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 bg-transparent border-none p-0"
                                >
                                    {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* New password */}
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            Nueva contraseña
                        </label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                type={showNew ? "text" : "password"}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className={inputClasses}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(!showNew)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 bg-transparent border-none p-0"
                            >
                                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Confirm password */}
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            Confirmar nueva contraseña
                        </label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    {/* Validations */}
                    <div className="space-y-1.5">
                        {validations.map((v, i) => (
                            <div key={i} className={cn("flex items-center gap-2 text-[13px]", v.valid ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
                                {v.valid ? <Check size={14} /> : <X size={14} />} {v.label}
                            </div>
                        ))}
                        <div className={cn("flex items-center gap-2 text-[13px]", passwordsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
                            {passwordsMatch ? <Check size={14} /> : <X size={14} />} Las contraseñas coinciden
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className={cn(
                                "flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
                                saved ? "bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-700",
                                !canSubmit && !saved && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {saved ? <><CheckCircle size={16} /> Contraseña actualizada</> : "Actualizar contraseña"}
                        </button>
                    </div>
                </form>
            </div>

            {/* 2FA Section */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                        <Shield size={20} className="text-amber-500" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            Autenticación de dos factores (2FA)
                        </h2>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            Protege tu cuenta con un código adicional al iniciar sesión
                        </p>
                    </div>
                    <span className="rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                        Próximamente
                    </span>
                </div>
            </div>
        </div>
    );
}
