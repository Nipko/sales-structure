"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Building2, Loader2, AlertTriangle, CheckCircle, ArrowRight, Eye, EyeOff } from "lucide-react";

interface InvitationData {
    valid: boolean;
    reason?: "not_found" | "accepted" | "revoked" | "expired";
    invitation?: {
        email: string;
        role: string;
        expiresAt: string;
        tenantName: string;
        tenantSlug: string | null;
        tenantLogoUrl: string | null;
    };
}

const ROLE_LABEL: Record<string, string> = {
    tenant_admin: "Administrador",
    tenant_supervisor: "Supervisor",
    tenant_agent: "Agente",
};

export default function AcceptInvitePage() {
    const router = useRouter();
    const { token } = useParams<{ token: string }>();
    const t = useTranslations("acceptInvite");
    const tc = useTranslations("common");

    const [data, setData] = useState<InvitationData | null>(null);
    const [loading, setLoading] = useState(true);
    const [accepting, setAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [password, setPassword] = useState("");

    useEffect(() => {
        async function load() {
            const res = await api.getInvitationByToken(token);
            setData(res.data as InvitationData);
            setLoading(false);
        }
        load().catch(() => {
            setData({ valid: false, reason: "not_found" });
            setLoading(false);
        });
    }, [token]);

    async function handleAccept() {
        setError(null);
        if (!firstName.trim()) return setError(t("firstNameRequired"));
        if (password.length < 8) return setError(t("passwordTooShort"));

        setAccepting(true);
        try {
            const res = await api.acceptInvitation(token, { firstName: firstName.trim(), lastName: lastName.trim() || undefined, password });
            if (!res?.success) throw new Error((res as any)?.error || t("acceptFailed"));
            // Auto-redirect to login
            router.push("/login?invited=true");
        } catch (err: any) {
            setError(err?.message || t("acceptFailed"));
            setAccepting(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
        );
    }

    if (!data?.valid) {
        const reasonKey = data?.reason ?? "not_found";
        return (
            <div className="min-h-screen flex items-center justify-center px-6 bg-neutral-50 dark:bg-neutral-950">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-8 text-center shadow-xl"
                >
                    <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="w-7 h-7 text-amber-500" />
                    </div>
                    <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
                        {t(`reason.${reasonKey}.title`)}
                    </h1>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
                        {t(`reason.${reasonKey}.description`)}
                    </p>
                    <Link
                        href="/login"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                        {t("goToLogin")} <ArrowRight className="w-4 h-4" />
                    </Link>
                </motion.div>
            </div>
        );
    }

    const inv = data.invitation!;
    const roleLabel = ROLE_LABEL[inv.role] || inv.role;

    return (
        <div className="min-h-screen flex items-center justify-center px-6 py-10 bg-neutral-50 dark:bg-neutral-950">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-8 shadow-xl"
            >
                {/* Tenant header */}
                <div className="text-center mb-6">
                    {inv.tenantLogoUrl ? (
                        <img
                            src={inv.tenantLogoUrl}
                            alt={inv.tenantName}
                            className="w-16 h-16 rounded-2xl mx-auto mb-3 object-cover"
                        />
                    ) : (
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">
                            {inv.tenantName.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                        {t("greeting", { tenantName: inv.tenantName })}
                    </h1>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5">
                        {t("invitedAs")} <span className="font-semibold text-indigo-600 dark:text-indigo-400">{roleLabel}</span>
                    </p>
                </div>

                {/* Email pre-filled (read-only) */}
                <div className="mb-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{t("emailLabel")}</p>
                        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{inv.email}</p>
                    </div>
                </div>

                {/* Name */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                        <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
                            {t("firstNameLabel")} <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder={t("firstNamePlaceholder")}
                            className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
                            {t("lastNameLabel")}
                        </label>
                        <input
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder={t("lastNamePlaceholder")}
                            className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                    </div>
                </div>

                {/* Password */}
                <div className="mb-5">
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
                        {t("passwordLabel")} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t("passwordPlaceholder")}
                            className="w-full px-3 py-2 pr-10 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                        >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                        {t("passwordHint")}
                    </p>
                </div>

                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-700 dark:text-red-300">
                        {error}
                    </div>
                )}

                <button
                    onClick={handleAccept}
                    disabled={accepting || !firstName || password.length < 8}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                    {accepting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {accepting ? tc("saving") : t("acceptButton")}
                    {!accepting && <CheckCircle className="w-4 h-4" />}
                </button>

                <p className="text-center text-[11px] text-neutral-500 dark:text-neutral-400 mt-4">
                    {t("expiresOn", { date: new Date(inv.expiresAt).toLocaleDateString() })}
                </p>
            </motion.div>
        </div>
    );
}
