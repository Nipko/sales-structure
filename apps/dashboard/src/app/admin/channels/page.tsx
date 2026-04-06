"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import {
    Globe,
    MessageSquare,
    Instagram,
    MessageCircle,
    CheckCircle,
    AlertCircle,
    ArrowRight,
} from "lucide-react";

// ---- Styles ----
const card = {
    background: "var(--bg-card, #1a1a2e)",
    border: "1px solid var(--border, #2a2a45)",
    borderRadius: 16,
    overflow: "hidden" as const,
    transition: "transform 0.15s, box-shadow 0.15s",
    cursor: "pointer" as const,
};

const channels = [
    {
        key: "whatsapp",
        name: "WhatsApp",
        color: "#25D366",
        Icon: MessageSquare,
        href: "/admin/channels/whatsapp",
        description: "WhatsApp Business API via Meta Cloud API",
    },
    {
        key: "instagram",
        name: "Instagram DM",
        color: "#E4405F",
        Icon: Instagram,
        href: "/admin/channels/instagram",
        description: "Instagram Direct Messages via Graph API",
    },
    {
        key: "messenger",
        name: "Facebook Messenger",
        color: "#0084FF",
        Icon: MessageCircle,
        href: "/admin/channels/messenger",
        description: "Messenger via Facebook Page integration",
    },
];

export default function ChannelsOverviewPage() {
    const { activeTenantId } = useTenant();
    const router = useRouter();
    const [connectedChannels, setConnectedChannels] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const res = await api.fetch("/channels/overview");
                const list = res?.data || res;
                if (Array.isArray(list)) {
                    setConnectedChannels(list.map((ch: any) => ch.channel_type || ch.channelType));
                }
            } catch (err) {
                console.error("Failed to load channel overview", err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [activeTenantId]);

    if (loading) {
        return (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-secondary, #9898b0)" }}>
                Cargando canales...
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <div style={{
                        background: "var(--accent, #6c5ce7)",
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}>
                        <Globe size={20} color="white" />
                    </div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--text-primary, #e8e8f0)" }}>
                        Canales
                    </h1>
                </div>
                <p style={{ color: "var(--text-secondary, #9898b0)", margin: "4px 0 0", paddingLeft: 50 }}>
                    Gestiona tus canales de comunicacion
                </p>
            </div>

            {/* Channel Cards Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
                {channels.map((ch) => {
                    const isConnected = connectedChannels.includes(ch.key);
                    return (
                        <div
                            key={ch.key}
                            style={card}
                            onClick={() => router.push(ch.href)}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                                (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px rgba(0,0,0,0.3)`;
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                            }}
                        >
                            {/* Card Top */}
                            <div style={{
                                padding: 24,
                                display: "flex",
                                flexDirection: "column" as const,
                                alignItems: "center",
                                gap: 16,
                            }}>
                                <div style={{
                                    background: ch.color,
                                    width: 56,
                                    height: 56,
                                    borderRadius: 14,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}>
                                    <ch.Icon size={28} color="white" />
                                </div>
                                <div style={{ textAlign: "center" }}>
                                    <h2 style={{
                                        fontSize: 18,
                                        fontWeight: 700,
                                        margin: 0,
                                        color: "var(--text-primary, #e8e8f0)",
                                    }}>
                                        {ch.name}
                                    </h2>
                                    <p style={{
                                        fontSize: 12,
                                        color: "var(--text-secondary, #9898b0)",
                                        margin: "6px 0 0",
                                        lineHeight: 1.4,
                                    }}>
                                        {ch.description}
                                    </p>
                                </div>

                                {/* Status Badge */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "6px 14px",
                                    borderRadius: 20,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: isConnected ? "rgba(0, 214, 143, 0.1)" : "rgba(152, 152, 176, 0.1)",
                                    color: isConnected ? "var(--success, #00d68f)" : "var(--text-secondary, #9898b0)",
                                    border: `1px solid ${isConnected ? "rgba(0, 214, 143, 0.2)" : "rgba(152, 152, 176, 0.15)"}`,
                                }}>
                                    {isConnected ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                    {isConnected ? "Conectado" : "Desconectado"}
                                </div>
                            </div>

                            {/* Card Footer */}
                            <div style={{
                                padding: "14px 24px",
                                borderTop: "1px solid var(--border, #2a2a45)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                color: "var(--accent, #6c5ce7)",
                                fontSize: 13,
                                fontWeight: 600,
                            }}>
                                Configurar
                                <ArrowRight size={14} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
