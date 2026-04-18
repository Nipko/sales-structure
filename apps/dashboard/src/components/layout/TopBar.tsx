"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  Sun, Moon, Monitor, ChevronDown, ChevronRight, LogOut, Menu, User, Settings,
  Bell, MessageSquare, Calendar, Mail, Shield, UserX, AlertTriangle,
  Users, Zap, Package, Clock,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { useLocale, useTranslations } from "next-intl";
import { locales, localeNames, type Locale } from "@/i18n/config";

// Notification categories with colors and icons
const NOTIF_CATEGORIES = {
  chat:       { label: "Messages",    icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-100 dark:bg-emerald-500/15", href: "/admin/inbox" },
  handoff:    { label: "Transfers",   icon: Users,      color: "text-orange-500",  bg: "bg-orange-100 dark:bg-orange-500/15",  href: "/admin/inbox" },
  compliance: { label: "Compliance",  icon: Shield,        color: "text-red-500",     bg: "bg-red-100 dark:bg-red-500/15",        href: "/admin/compliance" },
  appointment:{ label: "Appointments", icon: Calendar,    color: "text-blue-500",    bg: "bg-blue-100 dark:bg-blue-500/15",      href: "/admin/appointments" },
  automation: { label: "Automation",  icon: Zap,           color: "text-purple-500",  bg: "bg-purple-100 dark:bg-purple-500/15",  href: "/admin/automation" },
  order:      { label: "Orders",      icon: Package,       color: "text-cyan-500",    bg: "bg-cyan-100 dark:bg-cyan-500/15",      href: "/admin/orders" },
  system:     { label: "System",      icon: AlertTriangle, color: "text-amber-500",   bg: "bg-amber-100 dark:bg-amber-500/15",    href: "/admin" },
} as const;

type NotifType = keyof typeof NOTIF_CATEGORIES;

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

const pathLabels: Record<string, string> = {
  admin: "",
  inbox: "Inbox",
  contacts: "CRM",
  pipeline: "Pipeline",
  automation: "Automation",
  agent: "AI Agent",
  settings: "Settings",
  channels: "Channels",
  analytics: "Analytics",
  "analytics-v2": "Analytics",
  "agent-analytics": "Reports",
  identity: "Identity",
  knowledge: "Knowledge Base",
  users: "Users",
  broadcast: "Campaigns",
  compliance: "Compliance",
  inventory: "Inventory",
  orders: "Orders",
  tenants: "Tenants",
  appointments: "Appointments",
  "email-templates": "Templates",
  media: "Images",
  "change-password": "Password",
  "custom-attributes": "Attributes",
  macros: "Macros",
  prechat: "Pre-Chat",
  appearance: "Appearance",
  segments: "Segments",
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifTab, setNotifTab] = useState<"all" | NotifType>("all");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const currentLocale = useLocale();

  const isSuperAdmin = user?.role === "super_admin";
  const showTenantSelector = isSuperAdmin && tenants.length > 1;

  const unreadCount = notifications.filter(n => !n.read).length;
  const filteredNotifs = notifTab === "all" ? notifications : notifications.filter(n => n.type === notifTab);

  // Count unread per category
  const unreadByType: Partial<Record<NotifType, number>> = {};
  notifications.filter(n => !n.read).forEach(n => { unreadByType[n.type] = (unreadByType[n.type] || 0) + 1; });

  const now = () => new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  function addNotif(type: NotifType, title: string, body: string) {
    setNotifications(prev => [{ id: `${type}-${Date.now()}-${Math.random()}`, type, title, body, time: now(), read: false }, ...prev].slice(0, 100));
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // WebSocket: listen to all real-time events
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (!token || !activeTenantId) return;

    const wsUrl = (process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1").replace("/api/v1", "");
    const socket = io(`${wsUrl}/inbox`, {
      auth: { token },
      query: { tenantId: activeTenantId },
      transports: ["websocket", "polling"],
    });

    // ── Messages ──
    socket.on("newMessage", (payload: any) => {
      const { message } = payload;
      if (message?.direction === "inbound") {
        addNotif("chat", "New incoming message", (message.content_text || message.content || "").slice(0, 80));
      }
    });

    // ── Handoff ──
    socket.on("handoff.escalated", (payload: any) => {
      addNotif("handoff", "Transfer to agent", payload.reason || "A customer requests to speak with a human agent");
    });

    // ── Compliance / Opt-out ──
    socket.on("optout.detected", (payload: any) => {
      addNotif("compliance", "Opt-out detected", `${payload.phone || "Contact"}: "${(payload.triggerMessage || "").slice(0, 60)}"`);
    });

    // ── Appointments ──
    socket.on("appointment.created", (payload: any) => {
      addNotif("appointment", "New appointment", `${payload.serviceName || "Appointment"} — ${payload.startAt ? new Date(payload.startAt).toLocaleDateString() : ""}`);
    });
    socket.on("appointment.cancelled", (payload: any) => {
      addNotif("appointment", "Appointment cancelled", payload.serviceName || "An appointment was cancelled");
    });

    // ── Automation ──
    socket.on("automation.triggered", (payload: any) => {
      addNotif("automation", "Rule executed", payload.ruleName || "An automation rule was executed");
    });
    socket.on("lead.captured", (payload: any) => {
      addNotif("automation", "New lead captured", `${payload.name || payload.phone || "New contact"} via ${payload.channel || "whatsapp"}`);
    });

    // ── Orders ──
    socket.on("order.created", (payload: any) => {
      addNotif("order", "New order", `Order for $${payload.totalAmount || 0} — ${payload.status || "pending"}`);
    });

    // ── System ──
    socket.on("error", (err: any) => {
      addNotif("system", "System error", typeof err === "string" ? err : err?.message || "Connection error");
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [activeTenantId]);

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  function clearNotifications() {
    if (notifTab === "all") {
      setNotifications([]);
    } else {
      setNotifications(prev => prev.filter(n => n.type !== notifTab));
    }
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
    { key: "light", icon: Sun, label: "Light" },
    { key: "dark", icon: Moon, label: "Dark" },
    { key: "system", icon: Monitor, label: "System" },
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

      {/* Language switcher */}
      <select
        value={currentLocale}
        onChange={(e) => {
          document.cookie = `locale=${e.target.value};path=/;max-age=31536000`;
          window.location.reload();
        }}
        className="h-8 rounded-md border border-neutral-200 dark:border-neutral-700 bg-transparent text-sm text-neutral-700 dark:text-neutral-300 px-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        title="Language"
      >
        {locales.map((l) => (
          <option key={l} value={l}>{localeNames[l]}</option>
        ))}
      </select>

      {/* Timezone indicator */}
      <TimezoneIndicator />

      {/* Notification bell */}
      <div ref={notifRef} className="relative">
        <button
          onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) markAllRead(); }}
          className="relative p-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          title="Notifications"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold px-1 animate-pulse">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {showNotifications && (
          <div className="absolute right-0 top-full mt-2 w-96 max-h-[500px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl z-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Notifications</span>
              <div className="flex items-center gap-2">
                {filteredNotifs.length > 0 && (
                  <button onClick={clearNotifications}
                    className="text-[11px] text-red-500 hover:text-red-400 cursor-pointer bg-transparent border-none font-medium">
                    Clear{notifTab !== "all" ? ` ${NOTIF_CATEGORIES[notifTab]?.label}` : ""}
                  </button>
                )}
                {unreadCount > 0 && (
                  <button onClick={markAllRead}
                    className="text-[11px] text-indigo-500 hover:text-indigo-400 cursor-pointer bg-transparent border-none font-medium">
                    Mark read
                  </button>
                )}
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex gap-0.5 px-2 py-2 border-b border-neutral-100 dark:border-neutral-800 overflow-x-auto">
              <button onClick={() => setNotifTab("all")}
                className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium border-none cursor-pointer whitespace-nowrap transition-colors",
                  notifTab === "all" ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")}>
                All {unreadCount > 0 && <span className="ml-1 text-[10px]">({unreadCount})</span>}
              </button>
              {(Object.entries(NOTIF_CATEGORIES) as [NotifType, typeof NOTIF_CATEGORIES[NotifType]][]).map(([key, cat]) => {
                const count = unreadByType[key] || 0;
                const CatIcon = cat.icon;
                return (
                  <button key={key} onClick={() => setNotifTab(key)}
                    className={cn("px-2 py-1 rounded-md text-[11px] font-medium border-none cursor-pointer whitespace-nowrap flex items-center gap-1 transition-colors",
                      notifTab === key ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")}>
                    <CatIcon size={11} />
                    {cat.label}
                    {count > 0 && <span className="min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-semibold">{count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Notification list */}
            <div className="overflow-y-auto max-h-[380px]">
              {filteredNotifs.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell size={24} className="text-neutral-300 dark:text-neutral-700 mx-auto mb-2" />
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">
                    {notifTab === "all" ? "No notifications" : `No ${NOTIF_CATEGORIES[notifTab]?.label.toLowerCase()}`}
                  </p>
                </div>
              ) : (
                filteredNotifs.map(n => {
                  const cat = NOTIF_CATEGORIES[n.type] || NOTIF_CATEGORIES.system;
                  const CatIcon = cat.icon;
                  return (
                    <div key={n.id}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 border-b border-neutral-50 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors cursor-pointer",
                        !n.read && "bg-indigo-50/50 dark:bg-indigo-500/5"
                      )}
                      onClick={() => { window.location.href = cat.href; setShowNotifications(false); }}
                    >
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5", cat.bg)}>
                        <CatIcon size={14} className={cat.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">{n.title}</span>
                            <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0", cat.bg, cat.color)}>
                              {cat.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-neutral-400 shrink-0">{n.time}</span>
                        </div>
                        <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{n.body}</p>
                      </div>
                      {!n.read && <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-2" />}
                    </div>
                  );
                })
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
          {user?.picture ? (
            <img src={user.picture} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
              {user?.firstName?.charAt(0) || "U"}
            </div>
          )}
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 hidden sm:inline">
            {user?.firstName}
          </span>
          <ChevronDown size={14} className="text-neutral-400" />
        </button>

        {showUserMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-lg z-50 py-2">
            {/* Profile info */}
            <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-3">
              {user?.picture ? (
                <img src={user.picture} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                  {user?.firstName?.charAt(0) || "U"}
                </div>
              )}
              <div>
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
            </div>
            {/* Quick links */}
            <Link
              href="/admin/settings/profile"
              onClick={() => setShowUserMenu(false)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              <User size={15} />
              My profile
            </Link>
            <Link
              href="/admin/settings"
              onClick={() => setShowUserMenu(false)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              <Settings size={15} />
              Settings
            </Link>
            {/* Logout */}
            <div className="border-t border-neutral-100 dark:border-neutral-800 mt-1 pt-1">
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
              >
                <LogOut size={15} />
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function TimezoneIndicator() {
  const [tz, setTz] = useState("");
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.tenantId) return;
    api.getTenantTimezone().then((res: any) => {
      if (res?.success) setTz(res.data?.timezone || "");
    }).catch(() => {});
  }, [user?.tenantId]);

  if (!tz) return null;

  // Format: "America/Bogota" → "Bogota (UTC-5)"
  const city = tz.split("/").pop()?.replace(/_/g, " ") || tz;
  const now = new Date();
  const offset = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(now).find(p => p.type === "timeZoneName")?.value || "";

  return (
    <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-neutral-500 dark:text-neutral-400" title={tz}>
      <Clock size={12} />
      <span>{city} {offset}</span>
    </div>
  );
}
