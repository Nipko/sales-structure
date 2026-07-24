"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

// Closing the prompt persists a snooze so it doesn't reappear on every page
// load. Dismissing the OS dialog snoozes for less time than an explicit close.
const SNOOZE_KEY = "pwa-install-snooze-until";
const DISMISS_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days after an explicit X
const SOFT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;     // 7 days after declining the OS dialog

function snoozedUntil(): number {
    try {
        return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
    } catch {
        return 0;
    }
}

function snooze(ms: number) {
    try {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
    } catch {
        /* private mode / storage disabled — fall back to in-memory dismissal */
    }
}

export function InstallPrompt() {
    const t = useTranslations("pwa");
    const promptRef = useRef<any>(null);
    const [canInstall, setCanInstall] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        setIsStandalone(
            window.matchMedia("(display-mode: standalone)").matches ||
            (window.navigator as any).standalone === true
        );

        // Respect a previous snooze across reloads/navigations.
        if (Date.now() < snoozedUntil()) {
            setDismissed(true);
        }

        const handler = (e: Event) => {
            e.preventDefault();
            promptRef.current = e;
            setCanInstall(true);
        };
        window.addEventListener("beforeinstallprompt", handler);

        const installed = () => {
            promptRef.current = null;
            setCanInstall(false);
            setIsStandalone(true);
            try { localStorage.removeItem(SNOOZE_KEY); } catch { /* noop */ }
        };
        window.addEventListener("appinstalled", installed);

        return () => {
            window.removeEventListener("beforeinstallprompt", handler);
            window.removeEventListener("appinstalled", installed);
        };
    }, []);

    const handleInstall = useCallback(async () => {
        const prompt = promptRef.current;
        if (!prompt) return;
        promptRef.current = null;
        try {
            prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "dismissed") {
                // They opened the OS dialog but backed out — hold off a week.
                snooze(SOFT_SNOOZE_MS);
                setCanInstall(false);
                setDismissed(true);
            }
        } catch (_err) {
            setCanInstall(false);
        }
    }, []);

    const handleDismiss = useCallback(() => {
        snooze(DISMISS_SNOOZE_MS);
        setDismissed(true);
    }, []);

    if (isStandalone || !canInstall || dismissed) return null;

    return (
        <div
            style={{
                position: "fixed",
                bottom: 20,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 9999,
                background: "#1a1a2e",
                border: "1px solid #2a2a45",
                borderRadius: 12,
                padding: "12px 20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                maxWidth: 400,
            }}
        >
            <Download size={20} style={{ color: "#6c5ce7", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e8e8f0" }}>
                    {t("installTitle")}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9898b0" }}>
                    {t("installSubtitle")}
                </p>
            </div>
            <button
                onClick={handleInstall}
                style={{
                    padding: "8px 16px",
                    background: "#6c5ce7",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.02em",
                }}
            >
                {t("install")}
            </button>
            <button
                onClick={handleDismiss}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
            >
                <X size={16} style={{ color: "#9898b0" }} />
            </button>
        </div>
    );
}
