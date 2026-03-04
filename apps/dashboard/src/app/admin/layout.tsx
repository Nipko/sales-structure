"use client";

import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { TenantProvider, TenantSelector } from "@/contexts/TenantContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, isLoading, user, logout } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [isLoading, isAuthenticated, router]);

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
                        <TenantSelector />
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
                </TenantProvider>
            </main>
        </div>
    );
}
