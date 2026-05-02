"use client";

import { useState, useCallback, Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Inbox,
  Contact,
  TrendingUp,
  CalendarDays,
  Home,
  Megaphone,
  Zap,
  Bot,
  BookOpen,
  BarChart3,
  Radio,
  Users,
  Settings,
  Building2,
  DollarSign,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

// Keys map to nav.sections.* and nav.items.* in translation files
interface NavSectionDef {
  titleKey: string;
  items: { labelKey: string; href: string; icon: LucideIcon }[];
}

const sectionDefs: NavSectionDef[] = [
  {
    titleKey: "operation",
    items: [
      { labelKey: "conversations", href: "/admin/inbox", icon: Inbox },
      { labelKey: "crm", href: "/admin/contacts", icon: Contact },
      { labelKey: "pipeline", href: "/admin/pipeline", icon: TrendingUp },
      { labelKey: "appointments", href: "/admin/appointments", icon: CalendarDays },
      { labelKey: "properties", href: "/admin/properties", icon: Home },
    ],
  },
  {
    titleKey: "growth",
    items: [
      { labelKey: "campaigns", href: "/admin/broadcast", icon: Megaphone },
      { labelKey: "automation", href: "/admin/automation", icon: Zap },
      { labelKey: "aiAgent", href: "/admin/agent", icon: Bot },
      { labelKey: "knowledgeBase", href: "/admin/knowledge", icon: BookOpen },
    ],
  },
  {
    titleKey: "management",
    items: [
      { labelKey: "analytics", href: "/admin/analytics-v2", icon: BarChart3 },
      { labelKey: "channels", href: "/admin/channels", icon: Radio },
      { labelKey: "users", href: "/admin/users", icon: Users },
    ],
  },
  {
    titleKey: "config",
    items: [
      { labelKey: "settings", href: "/admin/settings", icon: Settings },
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
  const { user, verticalConfig } = useAuth();
  const tNav = useTranslations('nav');
  const tRoles = useTranslations('roles');
  const locale = useLocale();

  // Role helpers
  const isAdmin = user?.role === 'super_admin' || user?.role === 'tenant_admin';
  const isSupervisor = isAdmin || user?.role === 'tenant_supervisor';

  const roleLabel = (() => {
    switch (user?.role) {
      case "super_admin": return tRoles("superAdmin");
      case "tenant_admin": return tRoles("admin");
      case "tenant_agent": return tRoles("agent");
      case "tenant_viewer": return tRoles("viewer");
      default: return user?.role?.replace(/_/g, " ") ?? "";
    }
  })();

  // Vertical overrides
  const hiddenItems = verticalConfig?.sidebar?.hiddenItems as string[] | undefined;
  const labelOverrides = verticalConfig?.sidebar?.labelOverrides as Record<string, Record<string, string>> | undefined;
  const itemOrder = verticalConfig?.sidebar?.itemOrder as string[] | undefined;

  const showProperties = verticalConfig?.industry === 'turismo';

  const sections: NavSection[] = sectionDefs.map(s => {
    const filteredItems = s.items
      .filter(i => !hiddenItems?.includes(i.labelKey))
      .filter(i => i.labelKey !== 'properties' || showProperties)
      // Role-based visibility
      .filter(i => {
        if (i.labelKey === 'campaigns') return isSupervisor;
        if (i.labelKey === 'automation') return isSupervisor;
        if (i.labelKey === 'aiAgent') return isAdmin;
        if (i.labelKey === 'users') return isAdmin;
        if (i.labelKey === 'knowledgeBase') return isSupervisor;
        return true;
      });

    if (itemOrder && itemOrder.length > 0) {
      filteredItems.sort((a, b) => {
        const idxA = itemOrder.indexOf(a.labelKey);
        const idxB = itemOrder.indexOf(b.labelKey);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }

    return {
      titleKey: s.titleKey,
      items: filteredItems.map(i => ({
        label: labelOverrides?.[i.labelKey]?.[locale] ?? tNav(`items.${i.labelKey}`),
        href: i.href,
        icon: i.icon,
      })),
    };
  });

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
    <div className="flex flex-col h-full">
      {/* Logo header */}
      <div
        className={cn(
          "flex items-center h-14 border-b border-border/50 px-4 shrink-0",
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
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Tenant header */}
      {showExpanded && (
        <div className="px-3 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              <Building2 size={14} className="text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">
                {user?.tenantName || user?.firstName || 'Parallly'}
              </p>
              <p className="text-[10px] text-neutral-400 capitalize">
                {(user as any)?.plan || 'starter'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5">
        {sections.map((section, sectionIdx) => (
          <Fragment key={section.titleKey}>
            {/* Section header */}
            {section.titleKey === "config" ? (
              <div className="my-2 mx-3 border-t border-border/40" />
            ) : (
              showExpanded && (
                <p className="px-3 mb-1.5 mt-5 first:mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400/80 dark:text-neutral-500/80 select-none">
                  {tNav(`sections.${section.titleKey}`)}
                </p>
              )
            )}

            {/* Section items */}
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
                        "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium rounded-r-md transition-all duration-150",
                        "border-l-2",
                        !showExpanded && "justify-center px-2",
                        active
                          ? "border-indigo-500 bg-indigo-500/5 text-foreground dark:bg-indigo-500/10"
                          : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-foreground hover:bg-neutral-500/5 dark:hover:bg-neutral-500/10"
                      )}
                    >
                      <Icon size={16} className={cn(
                        "shrink-0 transition-colors",
                        active ? "text-indigo-500" : "text-neutral-400 dark:text-neutral-500"
                      )} />
                      {showExpanded && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Plataforma section — injected after the last regular section (management, index 2), super_admin only */}
            {sectionIdx === 2 && user?.role === "super_admin" && (
              <div className="mt-1">
                {showExpanded && (
                  <p className="px-3 mb-1.5 mt-5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400/80 dark:text-neutral-500/80 select-none">
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
                        "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium rounded-r-md transition-all duration-150",
                        "border-l-2",
                        !showExpanded && "justify-center px-2",
                        isActive("/admin/tenants")
                          ? "border-indigo-500 bg-indigo-500/5 text-foreground dark:bg-indigo-500/10"
                          : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-foreground hover:bg-neutral-500/5 dark:hover:bg-neutral-500/10"
                      )}
                    >
                      <Building2 size={16} className={cn(
                        "shrink-0 transition-colors",
                        isActive("/admin/tenants") ? "text-indigo-500" : "text-neutral-400 dark:text-neutral-500"
                      )} />
                      {showExpanded && <span className="truncate">Tenants</span>}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/admin/financials"
                      title={!showExpanded ? tNav('items.financials') : undefined}
                      onClick={handleNavClick}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium rounded-r-md transition-all duration-150",
                        "border-l-2",
                        !showExpanded && "justify-center px-2",
                        isActive("/admin/financials")
                          ? "border-indigo-500 bg-indigo-500/5 text-foreground dark:bg-indigo-500/10"
                          : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-foreground hover:bg-neutral-500/5 dark:hover:bg-neutral-500/10"
                      )}
                    >
                      <DollarSign size={16} className={cn(
                        "shrink-0 transition-colors",
                        isActive("/admin/financials") ? "text-indigo-500" : "text-neutral-400 dark:text-neutral-500"
                      )} />
                      {showExpanded && <span className="truncate">{tNav('items.financials')}</span>}
                    </Link>
                  </li>
                </ul>
              </div>
            )}
          </Fragment>
        ))}
      </nav>

      {/* User footer */}
      {showExpanded ? (
        <div className="px-3 py-3 border-t border-border/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-[10px] text-neutral-400">{roleLabel}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-center py-3 border-t border-border/30 shrink-0">
          <div
            className="w-7 h-7 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center"
            title={`${user?.firstName} ${user?.lastName}`}
          >
            <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
              {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
            </span>
          </div>
        </div>
      )}
    </div>
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
          showExpanded ? "w-[240px]" : "w-12"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={(open) => { if (!open && onMobileClose) onMobileClose(); }}>
        <SheetContent
          side="left"
          showCloseButton={true}
          className="w-[240px] p-0 bg-white dark:bg-neutral-950 flex flex-col"
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
}
