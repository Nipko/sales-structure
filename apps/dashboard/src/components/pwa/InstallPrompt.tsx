"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

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
                setCanInstall(false);
            }
        } catch (_err) {
            setCanInstall(false);
        }
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
                onClick={() => setDismissed(true)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
            >
                <X size={16} style={{ color: "#9898b0" }} />
            </button>
        </div>
    );
}
