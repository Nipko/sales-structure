"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export function PushNotificationToggle() {
    const t = useTranslations("pwa");
    const { activeTenantId } = useTenant();
    const [permission, setPermission] = useState<NotificationPermission>("default");
    const [subscribed, setSubscribed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [supported, setSupported] = useState(false);

    useEffect(() => {
        const hasSW = "serviceWorker" in navigator;
        const hasNotif = "Notification" in window;
        const hasPush = "PushManager" in window;
        setSupported(hasSW && hasNotif && hasPush && !!VAPID_PUBLIC_KEY);

        if (hasNotif) setPermission(Notification.permission);

        if (hasSW && hasPush) {
            navigator.serviceWorker.ready.then((reg) => {
                reg.pushManager.getSubscription().then((sub) => {
                    setSubscribed(!!sub);
                });
            });
        }
    }, []);

    const subscribe = useCallback(async () => {
        setLoading(true);
        try {
            const perm = await Notification.requestPermission();
            setPermission(perm);
            if (perm !== "granted") return;

            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });

            const token = localStorage.getItem("token");
            await fetch(`${API_URL}/push/subscribe`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    "x-tenant-id": activeTenantId || "",
                },
                body: JSON.stringify({ subscription: sub.toJSON() }),
            });

            setSubscribed(true);
        } catch {
            // Permission denied or push registration failed
        } finally {
            setLoading(false);
        }
    }, [activeTenantId]);

    const unsubscribe = useCallback(async () => {
        setLoading(true);
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const token = localStorage.getItem("token");
                await fetch(`${API_URL}/push/unsubscribe`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                        "x-tenant-id": activeTenantId || "",
                    },
                    body: JSON.stringify({ endpoint: sub.endpoint }),
                });
                await sub.unsubscribe();
            }
            setSubscribed(false);
        } catch {
            // Unsubscribe failed
        } finally {
            setLoading(false);
        }
    }, [activeTenantId]);

    if (!supported) return null;

    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: "var(--bg-card, #1a1a2e)",
            borderRadius: 12,
            border: "1px solid var(--border, #2a2a45)",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {subscribed
                    ? <Bell size={20} style={{ color: "var(--success, #00d68f)" }} />
                    : <BellOff size={20} style={{ color: "var(--text-secondary, #9898b0)" }} />
                }
                <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary, #e8e8f0)" }}>
                        {t("pushTitle")}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary, #9898b0)" }}>
                        {permission === "denied" ? t("pushBlocked") : t("pushSubtitle")}
                    </p>
                </div>
            </div>
            <button
                onClick={subscribed ? unsubscribe : subscribe}
                disabled={loading || permission === "denied"}
                style={{
                    padding: "8px 16px",
                    background: subscribed ? "transparent" : "var(--accent, #6c5ce7)",
                    color: subscribed ? "var(--text-secondary, #9898b0)" : "#fff",
                    border: subscribed ? "1px solid var(--border, #2a2a45)" : "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: loading || permission === "denied" ? "not-allowed" : "pointer",
                    opacity: loading ? 0.6 : 1,
                }}
            >
                {loading ? "..." : subscribed ? t("pushDisable") : t("pushEnable")}
            </button>
        </div>
    );
}
