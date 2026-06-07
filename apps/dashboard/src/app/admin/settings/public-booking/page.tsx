"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { Calendar, Copy, Check, ExternalLink, QrCode, Loader2 } from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";
import { motion } from "motion/react";

interface Config {
    enabled: boolean;
    welcomeText: string | null;
    brandColor: string | null;
    bookingUrl: string;
    slug: string;
}

export default function PublicBookingSettingsPage() {
    const t = useTranslations("publicBookingSettings");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();

    const [config, setConfig] = useState<Config | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [welcomeText, setWelcomeText] = useState("");
    const [brandColor, setBrandColor] = useState("#3897f0");
    const [copied, setCopied] = useState(false);
    const [showQR, setShowQR] = useState(false);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const res = await api.getPublicBookingConfig(activeTenantId);
        if (res.success) {
            const data = res.data as Config;
            setConfig(data);
            setWelcomeText(data.welcomeText ?? "");
            setBrandColor(data.brandColor ?? "#3897f0");
        }
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { load(); }, [load]);

    async function toggleEnabled() {
        if (!activeTenantId || !config) return;
        setSaving(true);
        const res = await api.updatePublicBookingConfig(activeTenantId, { enabled: !config.enabled });
        if (res.success) setConfig(res.data as Config);
        setSaving(false);
    }

    async function saveCustomization() {
        if (!activeTenantId) return;
        setSaving(true);
        const res = await api.updatePublicBookingConfig(activeTenantId, { welcomeText, brandColor });
        if (res.success) setConfig(res.data as Config);
        setSaving(false);
    }

    async function copyLink() {
        if (!config?.bookingUrl) return;
        await navigator.clipboard.writeText(config.bookingUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    if (loading || !config) {
        return (
            <div className="space-y-3 max-w-3xl">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton h-24 w-full rounded-xl" />
                ))}
            </div>
        );
    }

    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(config.bookingUrl)}&color=000&bgcolor=fff`;

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                    <Calendar className="w-6 h-6 text-indigo-500" />
                    {t("title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {t("subtitle")}
                </p>
            </div>

            <HelpPanel
                title={tHelp("settingsPublicBooking.title")}
                description={tHelp("settingsPublicBooking.description")}
                tips={tHelp.raw("settingsPublicBooking.tips") as string[]}
                mediaKey="settingsPublicBooking"
            />

            {/* Toggle */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5"
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {t("toggleTitle")}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                            {t("toggleHint")}
                        </p>
                    </div>
                    <button
                        onClick={toggleEnabled}
                        disabled={saving}
                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                            config.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                        }`}
                        aria-label={config.enabled ? t("disable") : t("enable")}
                    >
                        <motion.div
                            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow"
                            animate={{ left: config.enabled ? "26px" : "2px" }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                    </button>
                </div>
                {config.enabled && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-3 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        {t("enabledStatus")}
                    </p>
                )}
            </motion.div>

            {/* Link + QR (only when enabled) */}
            {config.enabled && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5"
                >
                    <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                        {t("linkTitle")}
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
                        {t("linkHint")}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2 mb-4">
                        <div className="flex-1 flex items-center gap-2 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2.5 text-sm font-mono text-neutral-800 dark:text-neutral-200 min-w-0">
                            <span className="truncate">{config.bookingUrl}</span>
                        </div>
                        <button
                            onClick={copyLink}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
                                copied
                                    ? "bg-emerald-500 text-white"
                                    : "bg-indigo-600 hover:bg-indigo-700 text-white"
                            }`}
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? t("copied") : t("copy")}
                        </button>
                        <a
                            href={config.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        >
                            <ExternalLink className="w-4 h-4" />
                            {t("preview")}
                        </a>
                    </div>

                    <button
                        onClick={() => setShowQR(!showQR)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                    >
                        <QrCode className="w-3.5 h-3.5" />
                        {showQR ? t("hideQR") : t("showQR")}
                    </button>

                    {showQR && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="mt-4 p-4 bg-white border border-neutral-200 rounded-xl inline-block"
                        >
                            <img src={qrSrc} alt="QR booking" width={240} height={240} className="block" />
                            <p className="text-[10px] text-neutral-500 text-center mt-2 font-mono">{config.slug}</p>
                        </motion.div>
                    )}
                </motion.div>
            )}

            {/* Customization */}
            {config.enabled && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4"
                >
                    <div>
                        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {t("customizationTitle")}
                        </h3>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                            {t("customizationHint")}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                            {t("welcomeLabel")}
                        </label>
                        <textarea
                            value={welcomeText}
                            onChange={(e) => setWelcomeText(e.target.value)}
                            placeholder={t("welcomePlaceholder")}
                            rows={3}
                            maxLength={300}
                            className="w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                        <p className="text-[10px] text-neutral-400 mt-1 text-right">
                            {welcomeText.length}/300
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                            {t("brandColorLabel")}
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={brandColor}
                                onChange={(e) => setBrandColor(e.target.value)}
                                className="h-10 w-16 rounded cursor-pointer border border-neutral-200 dark:border-neutral-700"
                            />
                            <input
                                type="text"
                                value={brandColor}
                                onChange={(e) => setBrandColor(e.target.value)}
                                className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm font-mono w-32"
                            />
                        </div>
                    </div>

                    <button
                        onClick={saveCustomization}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white inline-flex items-center gap-2 transition-colors"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                        {tc("save")}
                    </button>
                </motion.div>
            )}
        </div>
    );
}
