"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import AnimatedLogo from "@/components/AnimatedLogo";
import {
  LayoutDashboard,
  Inbox,
  Contact,
  UserPlus,
  Workflow,
  Megaphone,
  Phone,
  BarChart3,
  Shield,
  Bot,
  BookOpen,
  Fingerprint,
  Users,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Building2,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: "Principal",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "Inbox", href: "/admin/inbox", icon: Inbox },
      { label: "CRM", href: "/admin/contacts", icon: Contact },
      { label: "Pipeline", href: "/admin/pipeline", icon: UserPlus },
    ],
  },
  {
    title: "Operación",
    items: [
      { label: "Automatización", href: "/admin/automation", icon: Workflow },
      { label: "Campañas", href: "/admin/broadcast", icon: Megaphone },
      { label: "Canales", href: "/admin/channels", icon: Phone },
    ],
  },
  {
    title: "Análisis",
    items: [
      { label: "Analytics", href: "/admin/agent-analytics", icon: BarChart3 },
      { label: "Compliance", href: "/admin/compliance", icon: Shield },
    ],
  },
  {
    title: "Configuración",
    items: [
      { label: "Agente IA", href: "/admin/agent", icon: Bot },
      { label: "Knowledge Base", href: "/admin/knowledge", icon: BookOpen },
      { label: "Identidad", href: "/admin/identity", icon: Fingerprint },
      { label: "Usuarios", href: "/admin/users", icon: Users },
      { label: "Configuración", href: "/admin/settings", icon: Settings },
    ],
  },
];

interface AppSidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function AppSidebar({ mobileOpen = false, onMobileClose }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const pathname = usePathname();
  const { user } = useAuth();

  // Whether sidebar visually shows full width (labels visible)
  const showExpanded = !collapsed || hovered;

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  const handleNavClick = useCallback(() => {
    if (onMobileClose) onMobileClose();
  }, [onMobileClose]);

  const sidebarContent = (
    <>
      {/* Header */}
      <div
        className={cn(
          "flex items-center h-14 border-b border-neutral-200 dark:border-neutral-800 px-4 shrink-0",
          showExpanded ? "justify-between" : "justify-center"
        )}
      >
        {showExpanded && (
          <>
            <img src="/parallly-logo-black.svg" alt="Parallly" className="h-7 dark:hidden" />
            <img src="/parallly-logo-white.svg" alt="Parallly" className="h-7 hidden dark:block" />
          </>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors hidden md:inline-flex"
          title={collapsed ? "Expandir" : "Colapsar"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {sections.map((section, sectionIdx) => (
          <Fragment key={section.title}>
            <div>
              {showExpanded && (
                <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                  {section.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={!showExpanded ? item.label : undefined}
                        onClick={handleNavClick}
                        className={cn(
                          "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                          showExpanded
                            ? "px-3 py-2"
                            : "justify-center px-2 py-2.5",
                          active
                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                        )}
                      >
                        <Icon size={18} className="shrink-0" />
                        {showExpanded && <span>{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Plataforma section — after Análisis (index 2), super_admin only */}
            {sectionIdx === 2 && user?.role === "super_admin" && (
              <div>
                {showExpanded && (
                  <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                    Plataforma
                  </p>
                )}
                <ul className="space-y-0.5">
                  <li>
                    <Link
                      href="/admin/tenants"
                      title={!showExpanded ? "Tenants" : undefined}
                      onClick={handleNavClick}
                      className={cn(
                        "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                        showExpanded ? "px-3 py-2" : "justify-center px-2 py-2.5",
                        isActive("/admin/tenants")
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                      )}
                    >
                      <Building2 size={18} className="shrink-0" />
                      {showExpanded && <span>Tenants</span>}
                    </Link>
                  </li>
                </ul>
              </div>
            )}
          </Fragment>
        ))}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0",
          showExpanded ? "flex items-center gap-3" : "flex justify-center"
        )}
      >
        <div
          className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0"
          title={!showExpanded ? `${user?.firstName} ${user?.lastName}` : undefined}
        >
          {user?.firstName?.charAt(0) || "U"}
        </div>
        {showExpanded && (
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {user?.role?.replace(/_/g, " ")}
            </p>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        onMouseEnter={() => { if (collapsed) setHovered(true); }}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "hidden md:flex flex-col h-screen border-r border-neutral-200 dark:border-neutral-800",
          "bg-white dark:bg-neutral-950 transition-all duration-200 shrink-0 overflow-hidden",
          showExpanded ? "w-[272px]" : "w-16"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={(open) => { if (!open && onMobileClose) onMobileClose(); }}>
        <SheetContent
          side="left"
          showCloseButton={true}
          className="w-[272px] p-0 bg-white dark:bg-neutral-950 flex flex-col"
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
