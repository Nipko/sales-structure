"use client";

import { useState, useCallback, Fragment, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
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
  ChevronRight,
  Compass,
  type LucideIcon,
} from "lucide-react";

interface NavItemDef {
  labelKey: string;
  href?: string;
  icon: LucideIcon;
  shortcut?: string;
  children?: { labelKey: string; href: string }[];
}

interface NavSectionDef {
  titleKey: string;
  items: NavItemDef[];
}

// Keys map to nav.sections.* and nav.items.* in translation files
const sectionDefs: NavSectionDef[] = [
  {
    titleKey: "operation",
    items: [
      { labelKey: "conversations", href: "/admin/inbox", icon: Inbox, shortcut: "⌘ 1" },
      { 
        labelKey: "crm", 
        icon: Contact, 
        shortcut: "⌘ 2",
        children: [
          { labelKey: "crm", href: "/admin/contacts" },
          { labelKey: "pipeline", href: "/admin/pipeline" }
        ]
      },
      { labelKey: "appointments", href: "/admin/appointments", icon: CalendarDays },
      { labelKey: "properties", href: "/admin/properties", icon: Home },
      { labelKey: "tours", href: "/admin/tours", icon: Compass },
      { labelKey: "listings", href: "/admin/listings", icon: Building2 },
    ],
  },
  {
    titleKey: "growth",
    items: [
      { labelKey: "campaigns", href: "/admin/broadcast", icon: Megaphone },
      { 
        labelKey: "automation", 
        icon: Zap, 
        children: [
          { labelKey: "automation", href: "/admin/automation" },
          { labelKey: "aiAgent", href: "/admin/agent" },
          { labelKey: "knowledgeBase", href: "/admin/knowledge" },
        ]
      },
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
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>({
    crm: true,
    automation: true,
  });
  
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
  // Tours visible for all turismo tenants — sub-types `tours` and
  // `agencia_viajes` get them as their primary surface, but `alquiler_vacacional`
  // and `hotel` operators may also offer day experiences alongside their main
  // service, so we don't gate by sub-type.
  const showTours = verticalConfig?.industry === 'turismo';
  // Listings (long-term sale/rent) visible only for inmobiliaria. Vacation
  // rental shouldn't see this — they have their own /admin/properties.
  const showListings = verticalConfig?.industry === 'inmobiliaria';

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

  const sections = sectionDefs.map(s => {
    const filteredItems = s.items
      .map(item => {
        // Filter children if exist
        const children = item.children
          ?.filter(child => !hiddenItems?.includes(child.labelKey))
          ?.filter(child => child.labelKey !== 'properties' || showProperties)
          ?.filter(child => {
            if (child.labelKey === 'campaigns') return isSupervisor;
            if (child.labelKey === 'automation') return isSupervisor;
            if (child.labelKey === 'aiAgent') return isAdmin;
            if (child.labelKey === 'users') return isAdmin;
            if (child.labelKey === 'knowledgeBase') return isSupervisor;
            return true;
          });

        if (children && children.length === 0) {
           return null; // hide parent if all children are hidden
        }

        // Check parent visibility if no children
        if (!children) {
          if (hiddenItems?.includes(item.labelKey)) return null;
          if (item.labelKey === 'properties' && !showProperties) return null;
          if (item.labelKey === 'tours' && !showTours) return null;
          if (item.labelKey === 'listings' && !showListings) return null;
          if (item.labelKey === 'campaigns' && !isSupervisor) return null;
          if (item.labelKey === 'automation' && !isSupervisor) return null;
          if (item.labelKey === 'aiAgent' && !isAdmin) return null;
          if (item.labelKey === 'users' && !isAdmin) return null;
          if (item.labelKey === 'knowledgeBase' && !isSupervisor) return null;
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

  // Whether sidebar visually shows full width (labels visible)
  const showExpanded = !collapsed || hovered;

  const handleNavClick = useCallback(() => {
    if (onMobileClose) onMobileClose();
  }, [onMobileClose]);

  // Handle auto-expand accordion if child is active
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

      {/* Tenant header */}
      {showExpanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 flex items-center justify-center shrink-0">
              <Building2 size={16} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-foreground truncate">
                {user?.tenantName || user?.firstName || 'Parallly'}
              </p>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-medium uppercase tracking-wider">
                {(user as any)?.plan || 'starter'}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 custom-scrollbar">
        <TooltipProvider delayDuration={200}>
          {sections.map((section, sectionIdx) => (
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

                      {/* Submenu Accordion */}
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

              {/* Plataforma section for super_admin */}
              {sectionIdx === 2 && user?.role === "super_admin" && (
                <div className="mt-2">
                  {showExpanded && (
                    <p className="px-2 mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 select-none">
                      Plataforma
                    </p>
                  )}
                  <ul className="space-y-0.5">
                    {[
                      { href: "/admin/tenants", label: "Tenants", icon: Building2 },
                      { href: "/admin/financials", label: tNav('items.financials'), icon: DollarSign }
                    ].map(item => {
                      const active = isActive(item.href);
                      const Icon = item.icon;
                      const linkContent = (
                        <Link
                          href={item.href}
                          onClick={handleNavClick}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md transition-all duration-150",
                            !showExpanded && "justify-center",
                            active
                              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 font-semibold"
                              : "text-neutral-600 dark:text-neutral-400 hover:text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800/80 font-medium"
                          )}
                        >
                          <Icon size={16} className={cn("shrink-0", active ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-400 dark:text-neutral-500")} />
                          {showExpanded && <span className="truncate">{item.label}</span>}
                        </Link>
                      );

                      return (
                        <li key={item.href}>
                          {!showExpanded ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                              <TooltipContent side="right" className="font-semibold">{item.label}</TooltipContent>
                            </Tooltip>
                          ) : linkContent}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
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
