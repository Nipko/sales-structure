"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

export function InstallPrompt() {
    const t = useTranslations("pwa");
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [dismissed, setDismissed] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        window.addEventListener("beforeinstallprompt", handler);
        return () => window.removeEventListener("beforeinstallprompt", handler);
    }, []);

    if (isStandalone || !deferredPrompt || dismissed) return null;

    const handleInstall = async () => {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
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
                style={{
                    padding: "6px 14px",
                    background: "var(--accent, #6c5ce7)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                }}
            >
                {t("install")}
            </button>
            <button
                onClick={() => setDismissed(true)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
            >
                <X size={16} style={{ color: "var(--text-secondary, #9898b0)" }} />
            </button>
        </div>
    );
}
