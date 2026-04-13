"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor, ChevronDown, ChevronRight, LogOut, Menu, Bell, MessageSquare, Calendar, Mail } from "lucide-react";
import { io, Socket } from "socket.io-client";

const pathLabels: Record<string, string> = {
  admin: "",
  inbox: "Inbox",
  contacts: "CRM",
  pipeline: "Pipeline",
  automation: "Automatización",
  agent: "Agente IA",
  settings: "Configuración",
  channels: "Canales",
  analytics: "Analytics",
  "agent-analytics": "Reportes",
  identity: "Identidad",
  knowledge: "Knowledge Base",
  users: "Usuarios",
  broadcast: "Campañas",
  compliance: "Compliance",
  inventory: "Inventario",
  orders: "Órdenes",
  tenants: "Tenants",
  appointments: "Citas",
  "email-templates": "Plantillas",
  media: "Imagenes",
  "change-password": "Contrasena",
  "custom-attributes": "Atributos",
  macros: "Macros",
  prechat: "Pre-Chat",
  appearance: "Apariencia",
  segments: "Segmentos",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

interface TopBarProps {
  onMobileMenuToggle?: () => void;
}

export default function TopBar({ onMobileMenuToggle }: TopBarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { tenants, activeTenantId, setActiveTenant } = useTenant();
  const { theme, setTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; type: string; title: string; body: string; time: string; read: boolean }[]>([]);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const isSuperAdmin = user?.role === "super_admin";
  const showTenantSelector = isSuperAdmin && tenants.length > 1;

  const unreadCount = notifications.filter(n => !n.read).length;

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Connect to WebSocket for real-time notifications
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (!token || !activeTenantId) return;

    const wsUrl = (process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1").replace("/api/v1", "");
    const socket = io(`${wsUrl}/inbox`, {
      auth: { token },
      query: { tenantId: activeTenantId },
      transports: ["websocket", "polling"],
    });

    socket.on("newMessage", (payload: any) => {
      const { conversationId, message } = payload;
      if (message.direction === "inbound") {
        const notif = {
          id: `msg-${message.id || Date.now()}`,
          type: "chat",
          title: "Nuevo mensaje",
          body: (message.content_text || message.content || "").slice(0, 80),
          time: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
          read: false,
        };
        setNotifications(prev => [notif, ...prev].slice(0, 50));
      }
    });

    socket.on("handoff.escalated", (payload: any) => {
      const notif = {
        id: `handoff-${Date.now()}`,
        type: "handoff",
        title: "Transferencia a agente",
        body: payload.reason || "Un cliente solicita hablar con un agente",
        time: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
        read: false,
      };
      setNotifications(prev => [notif, ...prev].slice(0, 50));
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [activeTenantId]);

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  function clearNotifications() {
    setNotifications([]);
    setShowNotifications(false);
  }

  // Build breadcrumb segments from pathname
  const breadcrumbSegments = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const segments: { label: string; href: string; isLast: boolean }[] = [];

    // Always start with Dashboard
    segments.push({
      label: "Dashboard",
      href: "/admin",
      isLast: parts.length <= 1,
    });

    // Build remaining segments (skip "admin" at index 0)
    for (let i = 1; i < parts.length; i++) {
      const seg = parts[i];
      const label = pathLabels[seg] || seg;
      // Skip empty labels
      if (!label) continue;
      const href = "/" + parts.slice(0, i + 1).join("/");
      segments.push({
        label,
        href,
        isLast: i === parts.length - 1,
      });
    }

    return segments;
  }, [pathname]);

  const themeOptions = [
    { key: "light", icon: Sun, label: "Claro" },
    { key: "dark", icon: Moon, label: "Oscuro" },
    { key: "system", icon: Monitor, label: "Sistema" },
  ] as const;

  return (
    <header className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 md:px-6 flex items-center gap-4 shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onMobileMenuToggle}
        className="md:hidden p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        title="Menu"
      >
        <Menu size={20} />
      </button>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm min-w-0">
        {breadcrumbSegments.map((seg, idx) => (
          <span key={seg.href} className="flex items-center gap-1 min-w-0">
            {idx > 0 && (
              <ChevronRight size={14} className="text-neutral-300 dark:text-neutral-600 shrink-0" />
            )}
            {seg.isLast ? (
              <span className="text-neutral-900 dark:text-neutral-100 font-medium truncate">
                {seg.label}
              </span>
            ) : (
              <Link
                href={seg.href}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors truncate"
              >
                {seg.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme toggle */}
      <div className="flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700 p-0.5">
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          const isActive = theme === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setTheme(opt.key)}
              title={opt.label}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isActive
                  ? "bg-neutral-100 dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400"
                  : "text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
              )}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      {/* Notification bell */}
      <div ref={notifRef} className="relative">
        <button
          onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) markAllRead(); }}
          className="relative p-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          title="Notificaciones"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {showNotifications && (
          <div className="absolute right-0 top-full mt-2 w-80 max-h-[420px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl z-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Notificaciones</span>
              {notifications.length > 0 && (
                <button onClick={clearNotifications}
                  className="text-[11px] text-indigo-500 hover:text-indigo-400 cursor-pointer bg-transparent border-none font-medium">
                  Limpiar todo
                </button>
              )}
            </div>

            {/* Notification list */}
            <div className="overflow-y-auto max-h-[350px]">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell size={24} className="text-neutral-300 dark:text-neutral-700 mx-auto mb-2" />
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">Sin notificaciones</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div key={n.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 border-b border-neutral-50 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors cursor-pointer",
                      !n.read && "bg-indigo-50/50 dark:bg-indigo-500/5"
                    )}
                    onClick={() => {
                      if (n.type === "chat" || n.type === "handoff") {
                        window.location.href = "/admin/inbox";
                      }
                      setShowNotifications(false);
                    }}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      n.type === "chat" ? "bg-emerald-100 dark:bg-emerald-500/15" :
                      n.type === "handoff" ? "bg-orange-100 dark:bg-orange-500/15" :
                      "bg-indigo-100 dark:bg-indigo-500/15"
                    )}>
                      {n.type === "chat" ? <MessageSquare size={14} className="text-emerald-600 dark:text-emerald-400" /> :
                       n.type === "handoff" ? <Bell size={14} className="text-orange-600 dark:text-orange-400" /> :
                       <Mail size={14} className="text-indigo-600 dark:text-indigo-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{n.title}</span>
                        <span className="text-[10px] text-neutral-400 shrink-0 ml-2">{n.time}</span>
                      </div>
                      <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{n.body}</p>
                    </div>
                    {!n.read && <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-2" />}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tenant selector */}
      {showTenantSelector && (
        <select
          value={activeTenantId || ""}
          onChange={(e) => setActiveTenant(e.target.value)}
          className="h-8 rounded-md border border-neutral-200 dark:border-neutral-700 bg-transparent text-sm text-neutral-700 dark:text-neutral-300 px-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {/* User avatar dropdown */}
      <div ref={userMenuRef} className="relative">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-2 p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
            {user?.firstName?.charAt(0) || "U"}
          </div>
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 hidden sm:inline">
            {user?.firstName}
          </span>
          <ChevronDown size={14} className="text-neutral-400" />
        </button>

        {showUserMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-lg z-50 py-2">
            {/* Profile info */}
            <div className="px-4 py-2 border-b border-neutral-100 dark:border-neutral-800">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {user?.email}
              </p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                {user?.role?.replace(/_/g, " ")}
                {user?.tenantName ? ` · ${user.tenantName}` : ""}
              </p>
            </div>
            {/* Logout */}
            <button
              onClick={() => {
                setShowUserMenu(false);
                logout();
              }}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              <LogOut size={15} />
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
