"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    MessageSquare,
    BookOpen,
    BarChart3,
    Settings,
    Users,
    ChevronLeft,
    ChevronRight,
    Zap,
    Inbox,
    Contact,
    Megaphone,
    Globe,
    Shield,
    Bot,
    UserPlus,
    Workflow,
} from "lucide-react";

const navItems = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/inbox", label: "Inbox", icon: Inbox },
    { href: "/admin/crm", label: "CRM", icon: Contact },
    { href: "/admin/leads", label: "Leads", icon: UserPlus },
    { href: "/admin/automation", label: "Automatización", icon: Workflow },
    { href: "/admin/landings", label: "Landings", icon: Globe },
    { href: "/admin/catalog/courses", label: "Cursos", icon: BookOpen },
    { href: "/admin/catalog/campaigns", label: "Campañas", icon: Megaphone },
    { href: "/admin/compliance", label: "Compliance", icon: Shield },
    { href: "/admin/knowledge", label: "Knowledge Base", icon: BookOpen },
    { href: "/admin/carla", label: "Carla AI", icon: Bot },
    { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/admin/users", label: "Usuarios", icon: Users },
    { href: "/admin/settings", label: "Configuración", icon: Settings },
];

export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const pathname = usePathname();

    return (
        <aside
            style={{
                width: collapsed ? 72 : 260,
                minHeight: "100vh",
                background: "var(--bg-secondary)",
                borderRight: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                transition: "width 0.3s ease",
                position: "fixed",
                left: 0,
                top: 0,
                zIndex: 50,
            }}
        >
            {/* Logo */}
            <div
                style={{
                    padding: collapsed ? "20px 16px" : "20px 24px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderBottom: "1px solid var(--border)",
                }}
            >
                <div
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    <Zap size={20} color="white" />
                </div>
                {!collapsed && (
                    <div style={{ overflow: "hidden" }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>Parallext</div>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                            Engine v0.1
                        </div>
                    </div>
                )}
            </div>

            {/* Nav Items */}
            <nav style={{ flex: 1, padding: "12px 8px" }}>
                {navItems.map((item) => {
                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/admin" && pathname?.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                padding: collapsed ? "12px 16px" : "10px 16px",
                                borderRadius: 10,
                                marginBottom: 2,
                                textDecoration: "none",
                                color: isActive
                                    ? "var(--accent)"
                                    : "var(--text-secondary)",
                                background: isActive
                                    ? "var(--accent-glow)"
                                    : "transparent",
                                fontWeight: isActive ? 600 : 500,
                                fontSize: 14,
                                transition: "all 0.2s ease",
                                justifyContent: collapsed ? "center" : "flex-start",
                            }}
                        >
                            <Icon size={20} />
                            {!collapsed && <span>{item.label}</span>}
                        </Link>
                    );
                })}
            </nav>

            {/* Collapse Toggle */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                style={{
                    margin: "8px",
                    padding: "10px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
        </aside>
    );
}
