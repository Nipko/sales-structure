"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import {
    ArrowLeft,
    Eye,
    EyeOff,
    Lock,
    CheckCircle,
    XCircle,
    Info,
    Loader2,
} from "lucide-react";

interface PasswordRequirement {
    label: string;
    test: (pw: string) => boolean;
}

const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
    { label: "Minimo 8 caracteres", test: (pw) => pw.length >= 8 },
    { label: "Al menos 1 mayuscula", test: (pw) => /[A-Z]/.test(pw) },
    { label: "Al menos 1 minuscula", test: (pw) => /[a-z]/.test(pw) },
    { label: "Al menos 1 numero", test: (pw) => /[0-9]/.test(pw) },
    { label: "Al menos 1 caracter especial", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export default function ChangePasswordPage() {
    const t = useTranslations('changePassword');
    const tc = useTranslations("common");
    const router = useRouter();
    const { user } = useAuth();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    const isGoogleOnly = user && user.hasPassword === false;

    const requirementResults = useMemo(
        () => PASSWORD_REQUIREMENTS.map((r) => ({ ...r, met: r.test(newPassword) })),
        [newPassword],
    );

    const allRequirementsMet = requirementResults.every((r) => r.met);
    const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
    const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

    const canSubmit =
        (isGoogleOnly || currentPassword.length > 0) &&
        allRequirementsMet &&
        passwordsMatch &&
        !saving;

    function showToast(type: "success" | "error", message: string) {
        setToast({ type, message });
        setTimeout(() => setToast(null), 4000);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;

        setSaving(true);
        try {
            const res = await api.changePassword(currentPassword, newPassword);
            if (res.success) {
                showToast("success", "Password updated successfully");
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
            } else {
                showToast("error", res.error || tc("errorSaving"));
            }
        } catch {
            showToast("error", "Error de conexion. Intenta de nuevo.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-6 md:p-8">
            {/* Toast */}
            {toast && (
                <div
                    className={cn(
                        "fixed right-6 top-6 z-[9999] flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg",
                        toast.type === "success" ? "bg-emerald-600" : "bg-red-600",
                    )}
                >
                    {toast.type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {toast.message}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => router.push("/admin/settings")}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                        {t('title')}
                    </h1>
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                        Actualiza la contrasena de tu cuenta
                    </p>
                </div>
            </div>

            {/* Google-only notice */}
            {isGoogleOnly && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 dark:border-blue-500/20 dark:bg-blue-500/10">
                    <Info size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        Tu cuenta usa Google Sign-In. Puedes establecer una contrasena adicional para
                        acceder tambien con email y contrasena.
                    </p>
                </div>
            )}

            {/* Form Card */}
            <Card className="border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg text-neutral-900 dark:text-neutral-100">
                        <Lock size={18} className="text-amber-500" />
                        {isGoogleOnly ? "Establecer contrasena" : "Actualizar contrasena"}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                        {/* Current Password */}
                        {!isGoogleOnly && (
                            <div className="flex flex-col gap-1.5">
                                <Label className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                    Contrasena actual
                                </Label>
                                <div className="relative">
                                    <Input
                                        type={showCurrent ? "text" : "password"}
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        placeholder="Ingresa tu contrasena actual"
                                        className="h-10 rounded-lg border-neutral-200 bg-neutral-50 pr-11 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrent(!showCurrent)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                                    >
                                        {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* New Password */}
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                Nueva contrasena
                            </Label>
                            <div className="relative">
                                <Input
                                    type={showNew ? "text" : "password"}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Ingresa tu nueva contrasena"
                                    className="h-10 rounded-lg border-neutral-200 bg-neutral-50 pr-11 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew(!showNew)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                                >
                                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Confirm Password */}
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                Confirmar nueva contrasena
                            </Label>
                            <div className="relative">
                                <Input
                                    type={showConfirm ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Repite tu nueva contrasena"
                                    className={cn(
                                        "h-10 rounded-lg border-neutral-200 bg-neutral-50 pr-11 text-sm dark:border-neutral-700 dark:bg-neutral-800",
                                        mismatch && "border-red-400 dark:border-red-500",
                                    )}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(!showConfirm)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                                >
                                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {mismatch && (
                                <p className="mt-1 text-xs font-medium text-red-500">
                                    Las contrasenas no coinciden
                                </p>
                            )}
                        </div>

                        {/* Password Requirements Checklist */}
                        {newPassword.length > 0 && (
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
                                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                                    Requisitos de contrasena
                                </p>
                                <div className="flex flex-col gap-1.5">
                                    {requirementResults.map((req) => (
                                        <div key={req.label} className="flex items-center gap-2">
                                            {req.met ? (
                                                <CheckCircle size={14} className="shrink-0 text-emerald-500" />
                                            ) : (
                                                <XCircle size={14} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                                            )}
                                            <span
                                                className={cn(
                                                    "text-xs",
                                                    req.met
                                                        ? "text-emerald-600 dark:text-emerald-400"
                                                        : "text-neutral-500 dark:text-neutral-400",
                                                )}
                                            >
                                                {req.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Submit */}
                        <Button
                            type="submit"
                            disabled={!canSubmit}
                            className={cn(
                                "mt-2 gap-2 rounded-xl px-6",
                                "bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50",
                            )}
                        >
                            {saving ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <Lock size={18} />
                            )}
                            {saving ? t("saving") || "..." : "Cambiar contrasena"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
