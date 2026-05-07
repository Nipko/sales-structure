"use client";

import { useState, useCallback, Fragment, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Inbox,
  Contact,
  CalendarDays,
  Home,
  Megaphone,
  Zap,
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
  ChevronRight,
  Compass,
  UtensilsCrossed,
  ChefHat,
  Dumbbell,
  CalendarRange,
  Activity,
  TrendingUp,
  ShieldCheck,
  Brain,
  Scale,
  Filter as FunnelIcon,
  type LucideIcon,
} from "lucide-react";

interface NavItemDef {
  labelKey: string;
  href?: string;
  icon: LucideIcon;
  shortcut?: string;
  children?: { labelKey: string; href: string; capability?: keyof ReturnType<typeof useRole> }[];
  /** Capability flag from useRole that gates visibility. Omit = always visible. */
  capability?: keyof ReturnType<typeof useRole>;
  /** Vertical industries that show this item. Omit = visible for all verticals. */
  verticals?: string[];
}

interface NavSectionDef {
  titleKey: string;
  items: NavItemDef[];
}

// ────────────────────────────────────────────────────────────────
// TENANT MODE — what tenant_admin / supervisor / agent see, plus
// super_admin during impersonation. This matches the role matrix:
// agent gets a slim operational view, supervisor/admin progressively
// unlock growth & management features.
// ────────────────────────────────────────────────────────────────
const tenantSections: NavSectionDef[] = [
  {
    titleKey: "operation",
    items: [
      { labelKey: "conversations", href: "/admin/inbox", icon: Inbox, shortcut: "⌘ 1", capability: "canHandleConversations" },
      {
        labelKey: "crm",
        icon: Contact,
        shortcut: "⌘ 2",
        capability: "canViewContacts",
        children: [
          { labelKey: "crm", href: "/admin/contacts" },
          { labelKey: "pipeline", href: "/admin/pipeline" }
        ]
      },
      { labelKey: "appointments", href: "/admin/appointments", icon: CalendarDays },
      { labelKey: "properties", href: "/admin/properties", icon: Home, verticals: ["turismo"] },
      { labelKey: "tours", href: "/admin/tours", icon: Compass, verticals: ["turismo"] },
      { labelKey: "listings", href: "/admin/listings", icon: Building2, verticals: ["inmobiliaria"] },
      { labelKey: "menu", href: "/admin/menu", icon: UtensilsCrossed, verticals: ["restaurantes"] },
      { labelKey: "foodOrders", href: "/admin/food-orders", icon: ChefHat, verticals: ["restaurantes"] },
      { labelKey: "memberships", href: "/admin/memberships", icon: Dumbbell, verticals: ["gimnasios"] },
      { labelKey: "classes", href: "/admin/classes", icon: CalendarRange, verticals: ["gimnasios"] },
    ],
  },
  {
    titleKey: "growth",
    items: [
      { labelKey: "campaigns", href: "/admin/broadcast", icon: Megaphone, capability: "canSendBroadcast" },
      {
        labelKey: "automation",
        icon: Zap,
        capability: "canEditAutomation",
        children: [
          { labelKey: "automation", href: "/admin/automation", capability: "canEditAutomation" },
          { labelKey: "aiAgent", href: "/admin/agent", capability: "canEditAgent" },
          { labelKey: "knowledgeBase", href: "/admin/knowledge", capability: "canViewKnowledge" },
        ]
      },
    ],
  },
  {
    titleKey: "management",
    items: [
      { labelKey: "analytics", href: "/admin/analytics-v2", icon: BarChart3, capability: "canSeeGlobalAnalytics" },
      { labelKey: "channels", href: "/admin/channels", icon: Radio, capability: "canManageChannels" },
      { labelKey: "users", href: "/admin/users", icon: Users, capability: "canManageUsers" },
    ],
  },
  {
    titleKey: "config",
    items: [
      { labelKey: "settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

// ────────────────────────────────────────────────────────────────
// PLATFORM MODE — what super_admin sees when NOT impersonating.
// Stripped to platform-management surfaces only.
// ────────────────────────────────────────────────────────────────
const platformSections: NavSectionDef[] = [
  {
    titleKey: "platform",
    items: [
      { labelKey: "tenants", href: "/admin/tenants", icon: Building2, shortcut: "⌘ 1" },
      { labelKey: "financials", href: "/admin/financials", icon: DollarSign },
      { labelKey: "platformUsage", href: "/admin/usage", icon: TrendingUp },
      { labelKey: "platformHealth", href: "/admin/health", icon: Activity },
      { labelKey: "platformAudit", href: "/admin/audit", icon: ShieldCheck },
      { labelKey: "llmStats", href: "/admin/llm-stats", icon: Brain },
      { labelKey: "webhookTap", href: "/admin/webhooks", icon: Radio },
      { labelKey: "complianceAdmin", href: "/admin/compliance-admin", icon: Scale },
      { labelKey: "funnel", href: "/admin/funnel", icon: FunnelIcon },
    ],
  },
  {
    titleKey: "platformConfig",
    items: [
      {
        labelKey: "aiModels",
        icon: Brain,
        children: [
          { labelKey: "llmProviders", href: "/admin/settings/ai-providers" },
          { labelKey: "aiConfig", href: "/admin/settings/ai-config" },
        ]
      },
      { labelKey: "channelsPhone", href: "/admin/settings/channels", icon: Radio },
      { labelKey: "platformAdvanced", href: "/admin/settings/platform", icon: Settings },
    ],
  },
  {
    titleKey: "config",
    items: [
      { labelKey: "personalSettings", href: "/admin/settings", icon: Settings },
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
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>({
    crm: true,
    automation: true,
    aiModels: true,
  });

  const pathname = usePathname();
  const { user, verticalConfig } = useAuth();
  const roleCtx = useRole();
  const tNav = useTranslations('nav');
  const tRoles = useTranslations('roles');
  const locale = useLocale();

  // Decide which navigation tree to render. super_admin without
  // impersonation gets the platform tree; everyone else (including
  // super_admin while impersonating) gets the tenant tree.
  const useTenantTree = !roleCtx.isSuperAdmin || roleCtx.impersonating;
  const sectionDefs = useTenantTree ? tenantSections : platformSections;

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

  // Vertical overrides only apply in tenant mode
  const hiddenItems = useTenantTree
    ? (verticalConfig?.sidebar?.hiddenItems as string[] | undefined)
    : undefined;
  const labelOverrides = useTenantTree
    ? (verticalConfig?.sidebar?.labelOverrides as Record<string, Record<string, string>> | undefined)
    : undefined;
  const itemOrder = useTenantTree
    ? (verticalConfig?.sidebar?.itemOrder as string[] | undefined)
    : undefined;

  const isActive = useCallback((href?: string) => {
    if (!href) return false;
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }, [pathname]);

  const toggleAccordion = (key: string) => {
    if (!showExpanded) {
      setCollapsed(false);
      setHovered(false);
    }
    setExpandedAccordions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const checkCapability = (cap?: keyof ReturnType<typeof useRole>): boolean => {
    if (!cap) return true;
    return Boolean(roleCtx[cap]);
  };

  const checkVertical = (verticals?: string[]): boolean => {
    if (!verticals || verticals.length === 0) return true;
    return verticals.includes(verticalConfig?.industry || "");
  };

  const sections = sectionDefs.map(s => {
    const filteredItems = s.items
      .map(item => {
        // Filter children
        const children = item.children
          ?.filter(child => !hiddenItems?.includes(child.labelKey))
          ?.filter(child => checkCapability(child.capability));

        if (children && children.length === 0) {
          return null; // hide parent if all children hidden
        }

        // Parent visibility checks
        if (!children) {
          if (hiddenItems?.includes(item.labelKey)) return null;
          if (!checkVertical(item.verticals)) return null;
          if (!checkCapability(item.capability)) return null;
        } else {
          // Items with children also need their own capability check
          if (!checkCapability(item.capability)) return null;
        }

        const isItemOrChildActive = isActive(item.href) || children?.some(c => isActive(c.href));

        return {
          ...item,
          label: labelOverrides?.[item.labelKey]?.[locale] ?? tNav(`items.${item.labelKey}`),
          children: children?.map(c => ({
            ...c,
            label: labelOverrides?.[c.labelKey]?.[locale] ?? tNav(`items.${c.labelKey}`),
            active: isActive(c.href)
          })),
          active: isItemOrChildActive,
        };
      })
      .filter(Boolean) as any[];

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
      items: filteredItems,
    };
  });

  const showExpanded = !collapsed || hovered;

  const handleNavClick = useCallback(() => {
    if (onMobileClose) onMobileClose();
  }, [onMobileClose]);

  useEffect(() => {
    sections.forEach(sec => {
      sec.items.forEach((item: any) => {
        if (item.children && item.active && expandedAccordions[item.labelKey] === undefined) {
          setExpandedAccordions(p => ({ ...p, [item.labelKey]: true }));
        }
      });
    });
  }, [pathname, sections, expandedAccordions]);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo header */}
      <div
        className={cn(
          "flex items-center h-14 border-b border-border/50 px-4 shrink-0 transition-all duration-200",
          showExpanded ? "justify-between" : "justify-center"
        )}
      >
        {showExpanded && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <img src="/parallly-logo-black.svg" alt="Parallly" className="h-7 dark:hidden" />
            <img src="/parallly-logo-white.svg" alt="Parallly" className="h-7 hidden dark:block" />
          </motion.div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors hidden md:inline-flex"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Workspace / platform header — adapts to mode */}
      {showExpanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "w-8 h-8 rounded-lg border flex items-center justify-center shrink-0",
              useTenantTree
                ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20"
                : "bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20"
            )}>
              <Building2 size={16} className={useTenantTree
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-amber-600 dark:text-amber-400"} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-foreground truncate">
                {useTenantTree
                  ? (user?.tenantName || user?.firstName || 'Parallly')
                  : tNav('platformConsole')}
              </p>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-medium uppercase tracking-wider">
                {useTenantTree
                  ? ((user as any)?.plan || 'starter')
                  : tNav('superAdminMode')}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 custom-scrollbar">
        <TooltipProvider delayDuration={200}>
          {sections.map((section) => (
            <Fragment key={section.titleKey}>
              {section.titleKey === "config" ? (
                <div className="my-3 mx-2 border-t border-border/40" />
              ) : (
                showExpanded && section.items.length > 0 && (
                  <p className="px-2 mb-1.5 mt-4 first:mt-0 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none">
                    {tNav(`sections.${section.titleKey}`)}
                  </p>
                )
              )}

              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isExpanded = expandedAccordions[item.labelKey];

                  const NavItemContent = (
                    <div
                      className={cn(
                        "flex items-center justify-between w-full px-2.5 py-1.5 text-[13px] rounded-md transition-all duration-150 cursor-pointer",
                        !showExpanded && "justify-center",
                        item.active && !item.children
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800/80 font-medium",
                        item.active && item.children && "text-indigo-700 dark:text-indigo-300"
                      )}
                      onClick={() => {
                        if (item.children) {
                          toggleAccordion(item.labelKey);
                        } else if (item.href) {
                          handleNavClick();
                        }
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon size={16} className={cn(
                          "shrink-0",
                          item.active ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-400 dark:text-neutral-500"
                        )} />
                        {showExpanded && (
                          <span className="truncate">{item.label}</span>
                        )}
                      </div>

                      {showExpanded && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.shortcut && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-border/50 text-neutral-400 font-mono tracking-tighter bg-background/50">
                              {item.shortcut}
                            </span>
                          )}
                          {item.children && (
                            isExpanded ? <ChevronDown size={14} className="text-neutral-400" /> : <ChevronRight size={14} className="text-neutral-400" />
                          )}
                        </div>
                      )}
                    </div>
                  );

                  const wrapWithLink = (node: React.ReactNode) =>
                    item.href ? <Link href={item.href}>{node}</Link> : node;

                  const content = wrapWithLink(NavItemContent);

                  return (
                    <li key={item.labelKey} className="relative">
                      {!showExpanded ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>{content}</div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="flex items-center gap-3">
                            <span className="font-semibold">{item.label}</span>
                            {item.shortcut && <span className="text-neutral-400 font-mono">{item.shortcut}</span>}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        content
                      )}

                      {/* Submenu */}
                      {item.children && (
                        <AnimatePresence initial={false}>
                          {(isExpanded && showExpanded) && (
                            <motion.ul
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden mt-0.5 space-y-0.5"
                            >
                              {item.children.map((child: any) => (
                                <li key={child.href}>
                                  <Link
                                    href={child.href}
                                    onClick={handleNavClick}
                                    className={cn(
                                      "flex items-center pl-9 pr-2.5 py-1.5 text-[13px] rounded-md transition-colors",
                                      child.active
                                        ? "bg-indigo-50/50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-semibold"
                                        : "text-neutral-500 dark:text-neutral-400 hover:text-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 font-medium"
                                    )}
                                  >
                                    <span className="truncate">{child.label}</span>
                                  </Link>
                                </li>
                              ))}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          ))}
        </TooltipProvider>
      </nav>

      {/* User footer */}
      {showExpanded ? (
        <div className="px-3 py-3 border-t border-border/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-neutral-100 border border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase">
                {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-foreground truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-medium">{roleLabel}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-center py-3 border-t border-border/30 shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-8 h-8 rounded-full bg-neutral-100 border border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 flex items-center justify-center cursor-pointer">
                  <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase">
                    {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-semibold">{user?.firstName} {user?.lastName}</p>
                <p className="text-[10px] text-neutral-400">{roleLabel}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
          "bg-white dark:bg-neutral-950 transition-all duration-300 ease-in-out shrink-0 overflow-hidden",
          showExpanded ? "w-[240px]" : "w-14"
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
