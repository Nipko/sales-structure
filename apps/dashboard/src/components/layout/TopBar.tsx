"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { useCurrentNavigationLocation } from "@/hooks/useCurrentNavigationLocation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  buildNavigationBreadcrumbs,
  getNavigationRoute,
  navigationItemKeyFromTitleKey,
  resolveNavigationDisplayLabel,
} from "@/lib/navigation-contract";
import { canAccessDashboardNavigationPath } from "@/lib/navigation-access";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import {
  Sun, Moon, Monitor, ChevronDown, ChevronLeft, ChevronRight, LogOut, Menu, User, Settings,
  Bell, MessageSquare, Calendar, Shield, AlertTriangle,
  Users, Zap, Package, Clock, Search,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { useLocale, useTranslations } from "next-intl";
import { locales, localeNames } from "@/i18n/config";
import { useCurrentNavigationPageTitle } from "@/contexts/NavigationPageContext";

type NotifType = "chat" | "handoff" | "compliance" | "appointment" | "automation" | "order" | "system";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

interface TopBarProps {
  onMobileMenuToggle?: () => void;
}

export default function TopBar({ onMobileMenuToggle }: TopBarProps) {
  const pathname = usePathname();
  const currentNavigationLocation = useCurrentNavigationLocation();
  const { user, logout, verticalConfig } = useAuth();
  const { activeTenantId } = useTenant();
  const role = useRole();
  const { theme, setTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifTab, setNotifTab] = useState<"all" | NotifType>("all");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const currentLocale = useLocale();
  const tRoles = useTranslations("roles");
  const t = useTranslations("topbar");
  const tRoot = useTranslations();
  const pageTitle = useCurrentNavigationPageTitle();
  const labelOverrides = verticalConfig?.sidebar?.labelOverrides as
    | Record<string, Record<string, string>>
    | undefined;
  const canNavigateTo = useCallback((href: string) => (
    Boolean(role.role) && canAccessDashboardNavigationPath(
      href,
      role.role!,
      role.impersonating,
      verticalConfig,
    )
  ), [role, verticalConfig]);

  // NOTIF_CATEGORIES — must be inside component to use t()
  const NOTIF_CATEGORIES = useMemo(() => ({
    chat:       { label: t("categories.chat"),        icon: MessageSquare, color: "text-emerald-500", bg: "bg-emerald-100 dark:bg-emerald-500/15", href: "/admin/inbox" },
    handoff:    { label: t("categories.handoff"),     icon: Users,         color: "text-orange-500",  bg: "bg-orange-100 dark:bg-orange-500/15",  href: "/admin/inbox" },
    compliance: { label: t("categories.compliance"),  icon: Shield,        color: "text-red-500",     bg: "bg-red-100 dark:bg-red-500/15",        href: "/admin/compliance" },
    appointment:{ label: t("categories.appointment"), icon: Calendar,      color: "text-blue-500",    bg: "bg-blue-100 dark:bg-blue-500/15",      href: "/admin/appointments" },
    automation: { label: t("categories.automation"),  icon: Zap,           color: "text-purple-500",  bg: "bg-purple-100 dark:bg-purple-500/15",  href: "/admin/automation" },
    order:      { label: t("categories.order"),       icon: Package,       color: "text-cyan-500",    bg: "bg-cyan-100 dark:bg-cyan-500/15",      href: "/admin/orders" },
    system:     { label: t("categories.system"),      icon: AlertTriangle, color: "text-amber-500",   bg: "bg-amber-100 dark:bg-amber-500/15",    href: "/admin" },
  } as const), [t]);

  // Friendly role label. The raw DB role is tenant_admin / tenant_agent /
  // super_admin / tenant_viewer — we hide the tenant_ prefix since it's
  // internal and show what the person actually IS.
  const roleLabel = (() => {
    switch (user?.role) {
      case "super_admin": return tRoles("superAdmin");
      case "tenant_admin": return tRoles("admin");
      case "tenant_supervisor": return tRoles("supervisor");
      case "tenant_agent": return tRoles("agent");
      case "tenant_viewer": return tRoles("viewer");
      default: return user?.role?.replace(/_/g, " ") ?? "";
    }
  })();

  const unreadCount = notifications.filter(n => !n.read).length;
  const filteredNotifs = notifTab === "all" ? notifications : notifications.filter(n => n.type === notifTab);

  // Count unread per category
  const unreadByType: Partial<Record<NotifType, number>> = {};
  notifications.filter(n => !n.read).forEach(n => { unreadByType[n.type] = (unreadByType[n.type] || 0) + 1; });
  const unreadChat = unreadByType.chat || 0;
  const unreadHandoff = unreadByType.handoff || 0;
  const unreadCompliance = unreadByType.compliance || 0;
  const unreadAppointment = unreadByType.appointment || 0;
  const unreadAutomation = unreadByType.automation || 0;
  const unreadOrder = unreadByType.order || 0;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("navigation:badge-counts", {
      detail: {
        "/admin/inbox": unreadChat + unreadHandoff,
        "/admin/compliance": unreadCompliance,
        "/admin/appointments": unreadAppointment,
        "/admin/automation": unreadAutomation,
        "/admin/orders": unreadOrder,
        "/admin/food-orders": unreadOrder,
      },
    }));
  }, [
    unreadAppointment,
    unreadAutomation,
    unreadChat,
    unreadCompliance,
    unreadHandoff,
    unreadOrder,
  ]);

  const addNotif = useCallback((type: NotifType, title: string, body: string) => {
    const time = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    setNotifications(prev => [{ id: `${type}-${Date.now()}-${Math.random()}`, type, title, body, time, read: false }, ...prev].slice(0, 100));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const restoreTarget = showNotifications
        ? notificationButtonRef.current
        : showUserMenu
          ? userMenuButtonRef.current
          : null;
      setShowUserMenu(false);
      setShowNotifications(false);
      restoreTarget?.focus();
    };
    const commandHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ restoreFocus?: HTMLElement | null }>).detail;
      if (showNotifications) {
        if (detail) detail.restoreFocus = notificationButtonRef.current;
        setShowNotifications(false);
      }
      if (showUserMenu) {
        if (detail) detail.restoreFocus = userMenuButtonRef.current;
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escapeHandler);
    window.addEventListener("navigation:command-open", commandHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escapeHandler);
      window.removeEventListener("navigation:command-open", commandHandler);
    };
  }, [showNotifications, showUserMenu]);

  // WebSocket: listen to all real-time events
  // Request browser notification permission
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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
        addNotif("chat", t("notifTitles.newMessage"), (message.content_text || message.content || "").slice(0, 80));
      }
    });

    // ── Handoff ──
    socket.on("handoff.escalated", (payload: any) => {
      const contactName = payload.contactName || t("notifications.unknownClient");
      const lastMsg = payload.lastMessage ? `: "${payload.lastMessage.slice(0, 60)}"` : "";
      addNotif("handoff", `🔴 ${contactName}`, `${payload.reason || t("notifications.transfer")}${lastMsg}`);
      // Play notification sound
      try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkYyGfnJ3fomVnJmSkol/dnN3gY2VmZaRi4R+eHd7hI6Ul5WQioN+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXl8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+").play().catch(() => {}); } catch {}
    });
    socket.on("inbox:handoff", (payload: any) => {
      if (payload.urgent) {
        const contactName = payload.contactName || t("notifications.unknownClient");
        addNotif("handoff", `🔴 ${contactName}`, `${payload.reason || t("notifications.transfer")}${payload.lastMessage ? `: "${payload.lastMessage.slice(0, 60)}"` : ""}`);
        try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkYyGfnJ3fomVnJmSkol/dnN3gY2VmZaRi4R+eHd7hI6Ul5WQioN+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXl8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+").play().catch(() => {}); } catch {}
        
        // Browser push for unassigned handoff (critical — works even with tab minimized/in background)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
          new Notification(`🔴 ${t("notifications.leadWaiting", { name: contactName })}`, {
            body: `Se requiere atención humana. Motivo: ${payload.reason || 'Traspaso'}`,
            icon: '/favicon.ico',
            tag: `handoff-${payload.conversationId}`,
            requireInteraction: true,
          });
        }
      }
    });
    // Supervisor escalation — conversation waiting too long
    socket.on("inbox:escalation", (payload: any) => {
      addNotif("handoff", `⚠️ ${payload.contactName || t("notifications.unknownClient")} — ${payload.waitMinutes}min`, `${t("notifications.escalation")}: ${payload.reason || t("notifications.noResponse")}`);
      // Browser push for escalation (critical — works even with tab minimized)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`⚠️ ${t("notifications.escalationTitle", { name: payload.contactName })}`, {
          body: `Esperando ${payload.waitMinutes} min sin respuesta. ${payload.reason || ''}`,
          icon: '/favicon.ico',
          tag: `escalation-${payload.conversationId}`,
          requireInteraction: true,
        });
      }
      try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkYyGfnJ3fomVnJmSkol/dnN3gY2VmZaRi4R+eHd7hI6Ul5WQioN+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXl8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+").play().catch(() => {}); } catch {}
    });
    // Direct assignment notification
    socket.on("inbox:assigned_to_you", (payload: any) => {
      addNotif("handoff", `⚡ ${t("notifications.assignedToYou")}`, payload.message || t("notifTitles.conversationAssigned"));
      // Browser push notification (works even if tab is in background)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`⚡ ${payload.contactName || t("notifications.unknownClient")} ${t("notifications.assignedToYou").toLowerCase()}`, {
          body: payload.reason || t("notifications.transfer"),
          icon: '/favicon.ico',
          tag: `handoff-${payload.conversationId}`,
        });
      }
      try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkYyGfnJ3fomVnJmSkol/dnN3gY2VmZaRi4R+eHd7hI6Ul5WQioN+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpWQioN+eXl8g42UlpWQioN+eXp8g42Tl5WQioN9eXp8hI2UlpWQioN+eXl8hI6UlpWQioJ+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXl8g42Tl5WQioJ+eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42Tl5WQioN9eXl8hI2UlpWQioJ+eXl8hI6UlpWQioN+eXl8hI6UlpaQioN+eXp8g42UlpWQioN+eXp8g42UlpWQioJ9eXl8hI2UlpWQioN+eXl8hI6UlpWQioN+").play().catch(() => {}); } catch {}
    });

    // ── Compliance / Opt-out ──
    socket.on("optout.detected", (payload: any) => {
      addNotif("compliance", t("notifTitles.optoutDetected"), `${payload.phone || t("notifTitles.contact")}: "${(payload.triggerMessage || "").slice(0, 60)}"`);
    });

    // ── Appointments ──
    socket.on("appointment.created", (payload: any) => {
      addNotif("appointment", t("notifTitles.newAppointment"), `${payload.serviceName || t("notifTitles.appointment")} — ${payload.startAt ? new Date(payload.startAt).toLocaleDateString() : ""}`);
    });
    socket.on("appointment.cancelled", (payload: any) => {
      addNotif("appointment", t("notifTitles.appointmentCancelled"), payload.serviceName || t("notifTitles.appointmentCancelledDefault"));
    });

    // ── Automation ──
    socket.on("automation.triggered", (payload: any) => {
      addNotif("automation", t("notifTitles.ruleExecuted"), payload.ruleName || t("notifTitles.ruleExecutedDefault"));
    });
    socket.on("lead.captured", (payload: any) => {
      addNotif("automation", t("notifTitles.newLead"), `${payload.name || payload.phone || t("notifTitles.newContact")} via ${payload.channel || "whatsapp"}`);
    });

    // ── Orders ──
    socket.on("order.created", (payload: any) => {
      addNotif("order", t("notifTitles.newOrder"), `${t("notifTitles.orderFor")} $${payload.totalAmount || 0} — ${payload.status || t("notifTitles.pending")}`);
    });

    // ── System ──
    socket.on("error", (err: any) => {
      addNotif("system", t("notifTitles.systemError"), typeof err === "string" ? err : err?.message || t("notifTitles.connectionError"));
    });

    // ── LLM Provider Health ──
    socket.on("system:llm_alert", (payload: any) => {
      const isCritical = payload.severity === "critical";
      const title = isCritical
        ? t("notifTitles.llmCritical", { provider: payload.provider })
        : t("notifTitles.llmWarning", { provider: payload.provider });
      addNotif("system", title, (payload.error || "").slice(0, 100));
      if (isCritical && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, {
          body: payload.error || t("notifTitles.llmDown"),
          icon: "/favicon.ico",
          tag: `llm-alert-${payload.provider}`,
        });
      }
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [activeTenantId, addNotif, t]);

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

  // Breadcrumbs come exclusively from the canonical route contract. Unknown
  // paths intentionally fall back to Inicio instead of exposing URL slugs,
  // database IDs or UUIDs in the interface.
  const breadcrumbSegments = useMemo(() => {
    const canonicalSegments = buildNavigationBreadcrumbs(pathname);
    if (canonicalSegments.length === 0) {
      return [{
        routeId: "tenantHome",
        label: t("breadcrumbs.dashboard"),
        href: "/admin",
        isCurrent: pathname === "/admin",
      }];
    }

    return canonicalSegments.map((segment) => {
      const definition = getNavigationRoute(segment.routeId);
      const translatedLabel = segment.label ?? tRoot(segment.titleKey);
      return {
        routeId: segment.routeId,
        label: segment.isCurrent && pageTitle
          ? pageTitle
          : resolveNavigationDisplayLabel(
              definition ? navigationItemKeyFromTitleKey(definition.titleKey) : null,
              translatedLabel,
              currentLocale,
              labelOverrides,
            ),
        href: segment.href,
        isCurrent: segment.isCurrent,
      };
    });
  }, [currentLocale, labelOverrides, pageTitle, pathname, t, tRoot]);

  const mobileBreadcrumbParent = breadcrumbSegments.length > 1
    ? breadcrumbSegments[breadcrumbSegments.length - 2]
    : null;

  const themeOptions = useMemo(() => [
    { key: "light", icon: Sun,     label: t("theme.light") },
    { key: "dark",  icon: Moon,    label: t("theme.dark") },
    { key: "system",icon: Monitor, label: t("theme.system") },
  ] as const, [t]);

  return (
    <header className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 sm:px-4 md:px-6 flex items-center gap-1.5 sm:gap-2 md:gap-4 shrink-0 min-w-0">
      {/* Mobile hamburger */}
      <button
        id="dashboard-mobile-menu-trigger"
        onClick={onMobileMenuToggle}
        type="button"
        aria-label={t("menu")}
        className="md:hidden p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        title={t("menu")}
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      {/* Breadcrumb */}
      <nav
        aria-label={tRoot("navigation.breadcrumbLabel")}
        className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-hidden"
      >
        {mobileBreadcrumbParent && (
          <Link
            href={mobileBreadcrumbParent.href}
            aria-label={`${tRoot("common.back")}: ${mobileBreadcrumbParent.label}`}
            title={`${tRoot("common.back")}: ${mobileBreadcrumbParent.label}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 sm:hidden"
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </Link>
        )}
        <ol className="flex items-center gap-1 min-w-0 overflow-hidden">
        {breadcrumbSegments.map((seg, idx) => (
          <li
            key={seg.routeId}
            className={cn(
              "items-center gap-1 min-w-0",
              seg.isCurrent ? "flex" : "hidden sm:flex",
            )}
          >
            {idx > 0 && (
              <ChevronRight
                size={14}
                aria-hidden="true"
                className="hidden sm:block text-neutral-300 dark:text-neutral-600 shrink-0"
              />
            )}
            {seg.isCurrent ? (
              <span
                aria-current="page"
                className="text-neutral-900 dark:text-neutral-100 font-medium truncate max-w-[52vw] sm:max-w-56 lg:max-w-80"
                title={seg.label}
              >
                {seg.label}
              </span>
            ) : (
              <Link
                href={seg.href}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-sm"
              >
                {seg.label}
              </Link>
            )}
          </li>
        ))}
        </ol>
      </nav>

      {/* Global command palette integration */}
      <button
        type="button"
        id={guidedTourAnchorId("command-palette")}
        onClick={(event) => window.dispatchEvent(new CustomEvent("navigation:command-open", {
          detail: { restoreFocus: event.currentTarget },
        }))}
        aria-label={tRoot("navigation.command.open")}
        title={tRoot("navigation.command.open")}
        className="hidden lg:flex h-8 items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 shrink-0"
      >
        <Search size={14} aria-hidden="true" />
        <span>{tRoot("navigation.command.open")}</span>
        <kbd className="hidden 2xl:inline rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
          Ctrl K
        </kbd>
      </button>

      {/* Theme toggle */}
      <div className="hidden xl:flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700 p-0.5 shrink-0">
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          const isActive = theme === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setTheme(opt.key)}
              aria-label={opt.label}
              aria-pressed={isActive}
              title={opt.label}
              className={cn(
                "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                isActive
                  ? "bg-neutral-100 dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400"
                  : "text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
              )}
            >
              <Icon size={15} aria-hidden="true" />
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
        aria-label={t("language")}
        className="hidden 2xl:block h-8 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-neutral-700 dark:text-neutral-300 px-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0"
        title={t("language")}
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
          ref={notificationButtonRef}
          type="button"
          onClick={() => {
            setShowUserMenu(false);
            setShowNotifications(!showNotifications);
          }}
          aria-label={unreadCount > 0
            ? `${t("notifications.title")}: ${unreadCount}`
            : t("notifications.title")}
          aria-haspopup="dialog"
          aria-expanded={showNotifications}
          aria-controls="topbar-notifications"
          className="relative p-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title={t("notifications.title")}
        >
          <Bell size={18} aria-hidden="true" />
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold px-1 animate-pulse">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {unreadCount > 0 ? `${t("notifications.title")}: ${unreadCount}` : ""}
        </span>

        {showNotifications && (
          <div
            id="topbar-notifications"
            role="dialog"
            aria-label={t("notifications.title")}
            className="fixed inset-x-2 top-16 w-auto max-h-[calc(100vh-5rem)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-h-[500px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("notifications.title")}</span>
              <div className="flex items-center gap-2">
                {filteredNotifs.length > 0 && (
                  <button type="button" onClick={clearNotifications}
                    className="text-[11px] text-red-500 hover:text-red-400 cursor-pointer bg-transparent border-none font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-sm">
                    {t("notifications.clear")}{notifTab !== "all" ? ` ${NOTIF_CATEGORIES[notifTab]?.label}` : ""}
                  </button>
                )}
                {unreadCount > 0 && (
                  <button type="button" onClick={markAllRead}
                    className="text-[11px] text-indigo-500 hover:text-indigo-400 cursor-pointer bg-transparent border-none font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-sm">
                    {t("notifications.markRead")}
                  </button>
                )}
              </div>
            </div>

            {/* Category tabs */}
            <div role="tablist" aria-label={t("notifications.title")} className="flex gap-0.5 px-2 py-2 border-b border-neutral-100 dark:border-neutral-800 overflow-x-auto">
              <button type="button" role="tab" aria-selected={notifTab === "all"} aria-controls="notification-tabpanel" onClick={() => setNotifTab("all")}
                className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium border-none cursor-pointer whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  notifTab === "all" ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")}>
                {t("categories.all")} {unreadCount > 0 && <span className="ml-1 text-[10px]">({unreadCount})</span>}
              </button>
              {(Object.entries(NOTIF_CATEGORIES) as [NotifType, typeof NOTIF_CATEGORIES[NotifType]][]).map(([key, cat]) => {
                const count = unreadByType[key] || 0;
                const CatIcon = cat.icon;
                return (
                  <button key={key} type="button" role="tab" aria-selected={notifTab === key} aria-controls="notification-tabpanel" onClick={() => setNotifTab(key)}
                    className={cn("px-2 py-1 rounded-md text-[11px] font-medium border-none cursor-pointer whitespace-nowrap flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                      notifTab === key ? "bg-indigo-500 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")}>
                    <CatIcon size={11} aria-hidden="true" />
                    {cat.label}
                    {count > 0 && <span className="min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-semibold">{count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Notification list */}
            <div id="notification-tabpanel" role="tabpanel" className="overflow-y-auto max-h-[calc(100vh-14rem)] sm:max-h-[380px]">
              {filteredNotifs.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell size={24} aria-hidden="true" className="text-neutral-300 dark:text-neutral-700 mx-auto mb-2" />
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">
                    {notifTab === "all" ? t("notifications.empty") : `${t("notifications.noCategory")} ${NOTIF_CATEGORIES[notifTab]?.label.toLowerCase()}`}
                  </p>
                </div>
              ) : (
                filteredNotifs.map(n => {
                  const cat = NOTIF_CATEGORIES[n.type] || NOTIF_CATEGORIES.system;
                  const CatIcon = cat.icon;
                  const notificationHref = canNavigateTo(cat.href) ? cat.href : null;
                  const markNotificationRead = () => {
                    setNotifications((current) => current.map((notification) => (
                      notification.id === n.id ? { ...notification, read: true } : notification
                    )));
                    if (notificationHref) setShowNotifications(false);
                  };
                  const notificationContents = (
                    <>
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5", cat.bg)}>
                        <CatIcon size={14} aria-hidden="true" className={cat.color} />
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
                      {!n.read && <div aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-2" />}
                    </>
                  );
                  const notificationClassName = cn(
                    "flex w-full items-start gap-3 border-b border-neutral-50 px-4 py-3 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-neutral-900 dark:hover:bg-neutral-900/50",
                    !n.read && "bg-indigo-50/50 dark:bg-indigo-500/5",
                  );

                  return notificationHref ? (
                    <Link
                      key={n.id}
                      href={notificationHref}
                      className={notificationClassName}
                      onClick={markNotificationRead}
                    >
                      {notificationContents}
                    </Link>
                  ) : (
                    <button
                      key={n.id}
                      type="button"
                      className={notificationClassName}
                      onClick={markNotificationRead}
                    >
                      {notificationContents}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* User avatar dropdown */}
      <div ref={userMenuRef} className="relative">
        <button
          ref={userMenuButtonRef}
          type="button"
          onClick={() => {
            setShowNotifications(false);
            setShowUserMenu(!showUserMenu);
          }}
          aria-label={t("userMenu.profile")}
          aria-haspopup="dialog"
          aria-expanded={showUserMenu}
          aria-controls="topbar-user-menu"
          className="flex items-center gap-2 p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {user?.picture ? (
            <Image src={user.picture} alt="" width={32} height={32} unoptimized className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold">
              {user?.firstName?.charAt(0) || "U"}
            </div>
          )}
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 hidden xl:inline max-w-[120px] truncate">
            {user?.firstName}
          </span>
          <ChevronDown size={14} aria-hidden="true" className="hidden sm:block text-neutral-400" />
        </button>

        {showUserMenu && (
          <div id="topbar-user-menu" role="dialog" aria-label={t("userMenu.profile")} className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-lg z-50 py-2">
            {/* Profile info */}
            <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-3">
              {user?.picture ? (
                <Image src={user.picture} alt="" width={40} height={40} unoptimized className="w-10 h-10 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                  {user?.firstName?.charAt(0) || "U"}
                </div>
              )}
              <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {user?.email}
              </p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5 truncate">
                {user?.tenantName ? `${user.tenantName} · ${roleLabel}` : roleLabel}
              </p>
              </div>
            </div>
            {/* Controls hidden from the compact top bar remain reachable here. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("navigation:command-open", {
                detail: { restoreFocus: userMenuButtonRef.current },
              }))}
              className="lg:hidden flex items-center gap-2 w-full px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
            >
              <Search size={15} aria-hidden="true" />
              {tRoot("navigation.command.open")}
            </button>
            <div className="xl:hidden flex items-center justify-center gap-1 px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = theme === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTheme(opt.key)}
                    aria-label={opt.label}
                    aria-pressed={isActive}
                    title={opt.label}
                    className={cn(
                      "flex-1 flex items-center justify-center p-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                      isActive
                        ? "bg-neutral-100 dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400"
                        : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200",
                    )}
                  >
                    <Icon size={15} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <div className="2xl:hidden px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
              <select
                value={currentLocale}
                onChange={(e) => {
                  document.cookie = `locale=${e.target.value};path=/;max-age=31536000`;
                  window.location.reload();
                }}
                aria-label={t("language")}
                className="h-8 w-full rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-neutral-700 dark:text-neutral-300 px-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {locales.map((locale) => (
                  <option key={locale} value={locale}>{localeNames[locale]}</option>
                ))}
              </select>
            </div>
            {/* Quick links */}
            <Link
              href={pathname.startsWith("/admin/settings")
                ? "/admin/settings/profile"
                : `/admin/settings/profile?returnTo=${encodeURIComponent(currentNavigationLocation)}`}
              onClick={() => setShowUserMenu(false)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              <User size={15} />
              {t("userMenu.profile")}
            </Link>
            <Link
              href={pathname.startsWith("/admin/settings")
                ? "/admin/settings"
                : `/admin/settings?returnTo=${encodeURIComponent(currentNavigationLocation)}`}
              onClick={() => setShowUserMenu(false)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              <Settings size={15} />
              {t("userMenu.settings")}
            </Link>
            {/* Logout */}
            <div className="border-t border-neutral-100 dark:border-neutral-800 mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  logout();
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
              >
                <LogOut size={15} />
                {t("userMenu.logout")}
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
    <div className="hidden 2xl:flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0" title={tz}>
      <Clock size={12} aria-hidden="true" />
      <span>{city} {offset}</span>
    </div>
  );
}
