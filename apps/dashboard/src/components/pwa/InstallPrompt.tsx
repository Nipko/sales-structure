"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Download, X, Check } from "lucide-react";

export function InstallPrompt() {
    const t = useTranslations("pwa");
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [dismissed, setDismissed] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [installing, setInstalling] = useState(false);

    useEffect(() => {
        setIsStandalone(
            window.matchMedia("(display-mode: standalone)").matches ||
            (window.navigator as any).standalone === true
        );

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        window.addEventListener("beforeinstallprompt", handler);

        const installed = () => {
            setDeferredPrompt(null);
            setIsStandalone(true);
        };
        window.addEventListener("appinstalled", installed);

        return () => {
            window.removeEventListener("beforeinstallprompt", handler);
            window.removeEventListener("appinstalled", installed);
        };
    }, []);

    if (isStandalone || !deferredPrompt || dismissed) return null;

    const handleInstall = async () => {
        if (!deferredPrompt || installing) return;
        setInstalling(true);
        try {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice.outcome === "accepted") {
                setDeferredPrompt(null);
            }
        } catch {
            // prompt failed silently
        } finally {
            setInstalling(false);
        }
    };

    const handleDismiss = () => {
        setDismissed(true);
        try {
            sessionStorage.setItem("pwa-install-dismissed", "1");
        } catch { /* ok */ }
    };

    return (
        <div style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "var(--bg-card, #1a1a2e)",
            border: "1px solid var(--border, #2a2a45)",
            borderRadius: 12,
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            maxWidth: 400,
        }}>
            <Download size={20} style={{ color: "var(--accent, #6c5ce7)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-primary, #e8e8f0)" }}>
                    {t("installTitle")}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary, #9898b0)" }}>
                    {t("installSubtitle")}
                </p>
            </div>
            <button
                onClick={handleInstall}
                disabled={installing}
                style={{
                    padding: "6px 14px",
                    background: installing ? "var(--text-secondary, #9898b0)" : "var(--accent, #6c5ce7)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: installing ? "wait" : "pointer",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
            >
                {installing ? <Check size={14} /> : null}
                {t("install")}
            </button>
            <button
                onClick={handleDismiss}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
            >
                <X size={16} style={{ color: "var(--text-secondary, #9898b0)" }} />
            </button>
        </div>
    );
}
