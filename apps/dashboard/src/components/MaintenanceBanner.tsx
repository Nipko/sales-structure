"use client";

/**
 * Platform-wide maintenance / status banner. Polls /platform-status every
 * 60 seconds and renders a colored banner across the top of the dashboard
 * for any active maintenance message. Users can dismiss the banner per
 * message — when the operator publishes a new message (different setAt
 * timestamp), the banner returns even if previously dismissed.
 *
 * Severity → color mapping:
 *   info     → blue, low intensity
 *   warning  → amber, medium intensity
 *   critical → red, full attention
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Info, AlertTriangle, AlertOctagon, X } from "lucide-react";

interface MaintenanceConfig {
    enabled: boolean;
    message: string;
    severity: "info" | "warning" | "critical";
    expiresAt?: string | null;
    setAt?: string | null;
    setBy?: string | null;
}

const POLL_INTERVAL_MS = 60_000;
const DISMISS_KEY = "maintenance:dismissed-setAt";

export default function MaintenanceBanner() {
    const tc = useTranslations("common");
    const [config, setConfig] = useState<MaintenanceConfig | null>(null);
    const [dismissedSetAt, setDismissedSetAt] = useState<string | null>(null);

    useEffect(() => {
        try {
            setDismissedSetAt(localStorage.getItem(DISMISS_KEY));
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        async function fetchStatus() {
            try {
                const res = await api.getPlatformMaintenance();
                if (res.success && res.data) {
                    setConfig(res.data);
                }
            } catch {
                // network blip — keep current state
            }
        }
        fetchStatus();
        const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    if (!config?.enabled || !config.message) return null;

    // Per-message dismissal: reappear when operator publishes a new one
    if (config.setAt && dismissedSetAt === config.setAt) return null;

    const handleDismiss = () => {
        if (config.setAt) {
            try {
                localStorage.setItem(DISMISS_KEY, config.setAt);
                setDismissedSetAt(config.setAt);
            } catch { /* ignore */ }
        } else {
            setConfig({ ...config, enabled: false });
        }
    };

    const Icon = config.severity === "critical"
        ? AlertOctagon
        : config.severity === "warning"
        ? AlertTriangle
        : Info;

    return (
        <div className={cn(
            "flex items-start gap-3 px-4 py-2.5 text-sm shrink-0 border-b",
            config.severity === "critical" && "bg-red-600 text-white border-red-700",
            config.severity === "warning" && "bg-amber-500 text-neutral-900 border-amber-600",
            config.severity === "info" && "bg-blue-600 text-white border-blue-700",
        )}>
            <Icon size={16} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <p className="font-medium leading-snug">{config.message}</p>
                {config.expiresAt && (
                    <p className="text-xs opacity-80 mt-0.5">
                        {new Date(config.expiresAt).toLocaleString()}
                    </p>
                )}
            </div>
            <button
                onClick={handleDismiss}
                className={cn(
                    "flex-shrink-0 p-1 rounded transition-colors",
                    config.severity === "warning"
                        ? "hover:bg-neutral-900/20"
                        : "hover:bg-white/20",
                )}
                aria-label={tc("dismiss")}
            >
                <X size={14} />
            </button>
        </div>
    );
}
