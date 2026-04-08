"use client";

import Sidebar from "@/components/Sidebar";
import CopilotWidget from "@/components/CopilotWidget";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { TenantProvider, TenantSelector } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

const agentStatuses = [
    { key: "online", label: "Online", color: "#2ecc71" },
    { key: "busy", label: "Ocupado", color: "#f1c40f" },
    { key: "offline", label: "Desconectado", color: "#95a5a6" },
] as const;

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, isLoading, user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const router = useRouter();
    const [agentStatus, setAgentStatus] = useState<string>("online");
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [showThemeDropdown, setShowThemeDropdown] = useState(false);
    const statusRef = useRef<HTMLDivElement>(null);
    const themeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [isLoading, isAuthenticated, router]);

    // Load agent status
    useEffect(() => {
        if ((user as any)?.status) setAgentStatus((user as any).status);
    }, [user]);

    // Close dropdowns on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
                setShowStatusDropdown(false);
            }
            if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
                setShowThemeDropdown(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const handleStatusChange = async (status: string) => {
        setAgentStatus(status);
        setShowStatusDropdown(false);
        if (user?.id) {
            try { await api.updateAgentStatus(user.id, status); } catch {}
        }
    };

    if (isLoading) {
        return (
            <div style={{
                minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-primary)", color: "var(--text-primary)",
            }}>
                <div style={{ textAlign: "center" }}>
                    <div style={{
                        width: 40, height: 40, border: "3px solid var(--border)",
                        borderTopColor: "var(--accent)", borderRadius: "50%",
                        animation: "spin 0.8s linear infinite", margin: "0 auto 12px",
                    }} />
                    <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>Cargando...</div>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (!isAuthenticated) return null;

    return (
        <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar />
            <main
                style={{
                    flex: 1,
                    marginLeft: 260,
                    padding: "32px 40px",
                    transition: "margin-left 0.3s ease",
                    maxWidth: "100%",
                    overflow: "auto",
                }}
            >
                <TenantProvider>
                    {/* Top Bar with user info */}
                    <div style={{
                        display: "flex", justifyContent: "flex-end", alignItems: "center",
                        marginBottom: 16, gap: 12,
                    }}>
                        {/* Theme Toggle */}
                        <div ref={themeRef} style={{ position: "relative" }}>
                            <button
                                onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: 34, height: 34, borderRadius: 8,
                                    border: "1px solid var(--border)", background: "transparent",
                                    cursor: "pointer", color: "var(--text-secondary)",
                                }}
                                title="Tema"
                            >
                                {theme === "light" ? <Sun size={16} /> : theme === "system" ? <Monitor size={16} /> : <Moon size={16} />}
                            </button>
                            {showThemeDropdown && (
                                <div style={{
                                    position: "absolute", top: "100%", right: 0, marginTop: 4,
                                    background: "var(--bg-secondary)", border: "1px solid var(--border)",
                                    borderRadius: 10, padding: 4, zIndex: 100, minWidth: 140,
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                                }}>
                                    {([
                                        { key: "light", label: "Claro", icon: <Sun size={14} /> },
                                        { key: "dark", label: "Oscuro", icon: <Moon size={14} /> },
                                        { key: "system", label: "Sistema", icon: <Monitor size={14} /> },
                                    ] as const).map(opt => (
                                        <button
                                            key={opt.key}
                                            onClick={() => { setTheme(opt.key); setShowThemeDropdown(false); }}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 8, width: "100%",
                                                padding: "8px 12px", border: "none", borderRadius: 6,
                                                background: theme === opt.key ? "var(--bg-card)" : "transparent",
                                                color: theme === opt.key ? "var(--accent)" : "var(--text-primary)",
                                                fontSize: 13, cursor: "pointer", textAlign: "left",
                                            }}
                                        >
                                            {opt.icon}
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <TenantSelector />
                        {/* Agent Status Dropdown */}
                        <div ref={statusRef} style={{ position: "relative" }}>
                            <button
                                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                                    borderRadius: 8, border: "1px solid var(--border)", background: "transparent",
                                    cursor: "pointer", fontSize: 12, color: "var(--text-secondary)", fontWeight: 500,
                                }}
                            >
                                <div style={{
                                    width: 8, height: 8, borderRadius: "50%",
                                    background: agentStatuses.find(s => s.key === agentStatus)?.color || "#95a5a6",
                                }} />
                                {agentStatuses.find(s => s.key === agentStatus)?.label || "Online"}
                            </button>
                            {showStatusDropdown && (
                                <div style={{
                                    position: "absolute", top: "100%", right: 0, marginTop: 4,
                                    background: "var(--bg-secondary)", border: "1px solid var(--border)",
                                    borderRadius: 10, padding: 4, zIndex: 100, minWidth: 140,
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                                }}>
                                    {agentStatuses.map(s => (
                                        <button
                                            key={s.key}
                                            onClick={() => handleStatusChange(s.key)}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 8, width: "100%",
                                                padding: "8px 12px", border: "none", borderRadius: 6,
                                                background: agentStatus === s.key ? "var(--bg-tertiary)" : "transparent",
                                                color: "var(--text-primary)", fontSize: 13, cursor: "pointer",
                                                textAlign: "left",
                                            }}
                                        >
                                            <div style={{
                                                width: 8, height: 8, borderRadius: "50%", background: s.color,
                                            }} />
                                            {s.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {user?.firstName} {user?.lastName}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                {user?.role?.replace("_", " ")} {user?.tenantName ? `· ${user.tenantName}` : ""}
                            </div>
                        </div>
                        <div style={{
                            width: 36, height: 36, borderRadius: "50%",
                            background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "white", fontWeight: 700, fontSize: 14, cursor: "pointer",
                        }}
                            title="Cerrar sesión"
                            onClick={logout}
                        >
                            {user?.firstName?.charAt(0) || "U"}
                        </div>
                    </div>
                    {children}
                    <CopilotWidget />
                </TenantProvider>
            </main>
        </div>
    );
}
