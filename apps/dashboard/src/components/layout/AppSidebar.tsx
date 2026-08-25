"use client";

import { useState, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useNavigationPreferences } from "@/hooks/useNavigationPreferences";
import { useCurrentNavigationLocation } from "@/hooks/useCurrentNavigationLocation";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { canAccessDashboardNavigationPath } from "@/lib/navigation-access";
import { navigationPlanDecision, planFeatureForPath } from "@parallext/shared";
import { recordNavigationEvent } from "@/lib/navigation-telemetry";
import { defaultLandingForRole } from "@/lib/roles";
import { useQualityHealth } from "@/contexts/QualityHealthContext";
import { getQualityAttentionCount } from "@/lib/quality-health";
import { canRunProductTourAtWidth } from "@/lib/product-tour-contract";
import {
  getNavigationRoute,
  isSegmentAwareNavigationMatch,
  normalizeNavigationPath,
  resolveNavigationDisplayLabel,
  sanitizeInternalReturnTo,
  selectActiveNavigationTarget,
} from "@/lib/navigation-contract";
import {
  hasVerticalDashboardItem,
  resolveVerticalDashboard,
  type VerticalDashboardItem,
} from "@/lib/vertical-dashboard-resolver";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog } from "radix-ui";
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
  Activity,
  BarChart3,
  BedDouble,
  BookOpen,
  Brain,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarRange,
  Camera,
  Car,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Compass,
  Contact,
  CreditCard,
  DollarSign,
  Dumbbell,
  Filter as FunnelIcon,
  Gauge,
  GraduationCap,
  HardDrive,
  Home,
  Inbox,
  KeyRound,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Lock,
  Megaphone,
  MessageSquare,
  Package,
  PanelLeft,
  PanelLeftClose,
  PawPrint,
  PieChart,
  Radio,
  Receipt,
  Scale,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Siren,
  Sparkles,
  Tag,
  Tags,
  TrendingUp,
  Umbrella,
  Users,
  UtensilsCrossed,
  Wallet,
  Waypoints,
  Workflow,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";


interface NavItemDef {
  labelKey: string;
  href?: string;
  icon: LucideIcon;
  children?: { labelKey: string; href: string; capability?: keyof ReturnType<typeof useRole>; planLocked?: boolean }[];
  /** Capability flag from useRole that gates visibility. Omit = always visible. */
  capability?: keyof ReturnType<typeof useRole>;
  /** Capability-backed vertical surface. Omit = visible for every vertical. */
  verticalItem?: VerticalDashboardItem;
  /** Accent color for primary/important items. Omit = neutral grey. */
  accent?: string;
  /** El plan del tenant no incluye esta pantalla: candado y ruta a Facturación. */
  planLocked?: boolean;
}

interface NavSectionDef {
  titleKey: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  items: NavItemDef[];
}

interface ResolvedNavChild {
  labelKey: string;
  href: string;
  label: string;
  active: boolean;
}

interface ResolvedNavItem extends Omit<NavItemDef, "children"> {
  label: string;
  active: boolean;
  linkActive: boolean;
  children?: ResolvedNavChild[];
}

interface ResolvedNavSection extends Omit<NavSectionDef, "items"> {
  items: ResolvedNavItem[];
}

/**
 * Match complete route segments instead of raw prefixes. For example,
 * `/admin/agent-analytics` must not activate `/admin/agent`.
 */
export function isSegmentAwareNavMatch(pathname: string, href: string): boolean {
  return isSegmentAwareNavigationMatch(pathname, href, href === "/admin");
}

/** Pick one canonical active destination: the most specific matching route. */
export function resolveActiveNavHref(pathname: string, hrefs: string[]): string | undefined {
  return selectActiveNavigationTarget(
    pathname,
    Array.from(new Set(hrefs), (href) => ({ href })),
  )?.href;
}

/** Keep Settings return destinations internal and avoid self-referential loops. */
export function buildSettingsNavigationHref(pathname: string): string {
  const safeLocation = sanitizeInternalReturnTo(pathname);
  const normalized = safeLocation ? normalizeNavigationPath(safeLocation) : null;
  if (!safeLocation || !normalized || !(normalized === "/admin" || normalized.startsWith("/admin/"))) {
    return "/admin/settings";
  }
  if (isSegmentAwareNavigationMatch(normalized, "/admin/settings")) {
    return "/admin/settings";
  }
  return `/admin/settings?returnTo=${encodeURIComponent(safeLocation)}`;
}

export interface VisibleFavoriteRoute {
  routeId: string;
  href: string;
}

/** Resolve preferences through the canonical registry, then intersect with the gated tree. */
export function resolveVisibleFavoriteRoutes(
  favoriteRouteIds: readonly string[],
  visibleHrefs: readonly string[],
): VisibleFavoriteRoute[] {
  const visible = new Set(visibleHrefs);
  const usedHrefs = new Set<string>();
  const resolved: VisibleFavoriteRoute[] = [];

  for (const routeId of favoriteRouteIds) {
    const route = getNavigationRoute(routeId);
    if (!route || route.pattern.includes(":") || !visible.has(route.pattern) || usedHrefs.has(route.pattern)) {
      continue;
    }
    usedHrefs.add(route.pattern);
    resolved.push({ routeId: route.id, href: route.pattern });
  }
  return resolved;
}

// ────────────────────────────────────────────────────────────────
// TENANT MODE — what tenant_admin / supervisor / agent see, plus
// super_admin during impersonation. This matches the role matrix:
// agent gets a slim operational view, supervisor/admin progressively
// unlock growth & management features.
// ────────────────────────────────────────────────────────────────
const tenantSections: NavSectionDef[] = [
  {
    // Lo primero que se abre, todos los días. Nada más.
    titleKey: "essentials",
    items: [
      { labelKey: "home", href: "/admin", icon: LayoutDashboard, capability: "canSeeGlobalAnalytics" },
      { labelKey: "conversations", href: "/admin/inbox", icon: Inbox, capability: "canHandleConversations", accent: "text-emerald-500 dark:text-emerald-400" },
    ],
  },
  {
    // Las PERSONAS. Estaban colgadas de un ítem llamado "CRM" con el embudo de
    // ventas adentro, así que buscar el teléfono de un cliente era entrar por
    // una sección que habla de negociaciones. Son dos trabajos distintos y los
    // hace gente distinta: quien atiende busca a la persona, quien vende mira
    // el embudo.
    titleKey: "customers",
    collapsible: true,
    defaultExpanded: true,
    items: [
      { labelKey: "crm", href: "/admin/contacts", icon: Contact, capability: "canViewContacts", accent: "text-blue-500 dark:text-blue-400" },
      { labelKey: "organizations", href: "/admin/contacts/organizations", icon: Building2, capability: "canEditPipeline" },
    ],
  },
  {
    // El dinero: el embudo y lo que se ofrece para moverlo.
    titleKey: "commercial",
    collapsible: true,
    items: [
      { labelKey: "pipeline", href: "/admin/pipeline", icon: Workflow, capability: "canViewContacts" },
      { labelKey: "offers", href: "/admin/catalog/offers", icon: Tag, capability: "canEditPipeline" },
    ],
  },
  {
    // Trabajo diario: los REGISTROS, el objeto que se abre todos los días.
    // Estaban mezclados con sus catálogos en una sola sección, así que quien
    // atiende recorría fichas de producto para llegar a su propia agenda. El
    // corte no es de gusto: sale de `NAVIGATION_SURFACE_KIND`, donde cada
    // superficie ya está declarada como registro, catálogo o mixta.
    titleKey: "dailyWork",
    collapsible: true,
    defaultExpanded: true,
    items: [
      { labelKey: "appointments", href: "/admin/appointments", icon: CalendarDays, verticalItem: "appointments", capability: "canHandleConversations", accent: "text-amber-500 dark:text-amber-400" },
      { labelKey: "stays", href: "/admin/stays", icon: BedDouble, verticalItem: "stays", capability: "canHandleConversations", accent: "text-sky-500 dark:text-sky-400" },
      { labelKey: "tourBookings", href: "/admin/tour-bookings", icon: Compass, verticalItem: "tourBookings", capability: "canHandleConversations", accent: "text-teal-500 dark:text-teal-400" },
      { labelKey: "resourceRentals", href: "/admin/resource-rentals", icon: KeyRound, verticalItem: "resourceRentals", capability: "canHandleConversations" },
      { labelKey: "repairOrders", href: "/admin/repair-orders", icon: Wrench, verticalItem: "repairOrders", capability: "canHandleConversations" },
      { labelKey: "foodOrders", href: "/admin/food-orders", icon: ChefHat, verticalItem: "foodOrders", capability: "canHandleConversations" },
      { labelKey: "orders", href: "/admin/orders", icon: ShoppingCart, verticalItem: "orders", capability: "canHandleConversations" },
      { labelKey: "serviceRequests", href: "/admin/service-requests", icon: Wrench, verticalItem: "serviceRequests", capability: "canHandleConversations" },
      { labelKey: "classes", href: "/admin/classes", icon: CalendarRange, verticalItem: "classes", capability: "canHandleConversations" },
      { labelKey: "photoSessions", href: "/admin/photo-sessions", icon: Camera, verticalItem: "photoSessions", capability: "canHandleConversations" },
      { labelKey: "pets", href: "/admin/pets", icon: PawPrint, verticalItem: "pets", capability: "canHandleConversations" },
      // Los casos de un estudio: registro operativo, no catálogo. La pantalla
      // se creó y el menú no la listaba — una pantalla que existe y a la que
      // no se llega es lo mismo que no tenerla.
      { labelKey: "cases", href: "/admin/cases", icon: Briefcase, verticalItem: "cases", capability: "canHandleConversations" },
      // Mixtas: se abren operando y su pestaña de catálogo se cierra adentro.
      { labelKey: "memberships", href: "/admin/memberships", icon: Dumbbell, verticalItem: "memberships", capability: "canHandleConversations" },
      { labelKey: "insurance", href: "/admin/insurance", icon: Umbrella, verticalItem: "insurance", capability: "canHandleConversations" },
    ],
  },
  {
    // Catálogo y recursos: lo que CONFIGURA el objeto de arriba. Trabajo de
    // supervisión, y restringirlo acá no le quita trabajo a nadie.
    titleKey: "catalogAndResources",
    collapsible: true,
    items: [
      { labelKey: "properties", href: "/admin/properties", icon: Home, verticalItem: "properties", capability: "canEditPipeline" },
      { labelKey: "tours", href: "/admin/tours", icon: Compass, verticalItem: "tours", capability: "canEditPipeline" },
      { labelKey: "listings", href: "/admin/listings", icon: Building2, verticalItem: "listings", capability: "canEditPipeline" },
      { labelKey: "vehicles", href: "/admin/vehicles", icon: Car, verticalItem: "vehicles", capability: "canEditPipeline" },
      { labelKey: "menu", href: "/admin/menu", icon: UtensilsCrossed, verticalItem: "menu", capability: "canEditPipeline" },
      { labelKey: "courses", href: "/admin/courses", icon: GraduationCap, verticalItem: "courses", capability: "canEditPipeline" },
      { labelKey: "treatmentPlans", href: "/admin/treatment-plans", icon: ClipboardList, verticalItem: "treatmentPlans", capability: "canEditPipeline" },
      { labelKey: "serviceCatalog", href: "/admin/service-catalog", icon: Tags, verticalItem: "serviceCatalog", capability: "canEditPipeline" },
      { labelKey: "inventory", href: "/admin/inventory", icon: Package, verticalItem: "inventory", capability: "canEditPipeline" },
    ],
  },
  {
    titleKey: "aiGrowth",
    collapsible: true,
    defaultExpanded: true,
    items: [
      {
        labelKey: "aiAgent",
        href: "/admin/agent",
        icon: Brain,
        capability: "canEditAgent",
        accent: "text-violet-500 dark:text-violet-400",
        children: [
          { labelKey: "agentSimulation", href: "/admin/agent/simulation", capability: "canEditAgent" },
        ],
      },
      { labelKey: "procedures", href: "/admin/procedures", icon: ClipboardList, capability: "canEditAutomation" },
      { labelKey: "knowledgeBase", href: "/admin/knowledge", icon: BookOpen, capability: "canViewKnowledge", accent: "text-indigo-500 dark:text-indigo-400" },
      {
        labelKey: "automation",
        href: "/admin/automation",
        icon: Zap,
        capability: "canEditAutomation",
        children: [
          { labelKey: "dripSequences", href: "/admin/automation/drip-sequences", capability: "canEditAutomation" },
          { labelKey: "automationTemplates", href: "/admin/automation/templates", capability: "canEditAutomation" },
        ],
      },
      { labelKey: "campaigns", href: "/admin/broadcast", icon: Megaphone, capability: "canSendBroadcast", accent: "text-orange-500 dark:text-orange-400" },
    ],
  },
  {
    titleKey: "insights",
    collapsible: true,
    items: [
      {
        labelKey: "analytics",
        href: "/admin/analytics-v2",
        icon: BarChart3,
        capability: "canSeeGlobalAnalytics",
        children: [
          { labelKey: "crmAnalytics", href: "/admin/crm-analytics" },
          { labelKey: "attribution", href: "/admin/attribution" },
          { labelKey: "reportBuilder", href: "/admin/report-builder" },
        ]
      },
      // Ventas va con `canManageBilling`, no con analitica: son los ingresos
      // del negocio, no una metrica operativa. Un agente no tiene por que
      // verlos.
      { labelKey: "sales", href: "/admin/sales", icon: Wallet, capability: "canManageBilling" },
      { labelKey: "agentQuality", href: "/admin/agent/quality", icon: ShieldCheck, capability: "canSeeGlobalAnalytics", accent: "text-emerald-500 dark:text-emerald-400" },
      { labelKey: "agentAnalytics", href: "/admin/agent-analytics", icon: Gauge, capability: "canSeeGlobalAnalytics" },
    ],
  },
  {
    titleKey: "administration",
    collapsible: true,
    items: [
      { labelKey: "channels", href: "/admin/channels", icon: Radio, capability: "canManageChannels", accent: "text-sky-500 dark:text-sky-400" },
      { labelKey: "users", href: "/admin/users", icon: Users, capability: "canManageUsers" },
      { labelKey: "compliance", href: "/admin/compliance", icon: Shield, capability: "canManageBilling" },
      { labelKey: "billing", href: "/admin/settings/billing", icon: CreditCard, capability: "canManageBilling" },
      { labelKey: "featureRequests", href: "/admin/feature-requests", icon: Lightbulb },
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
    titleKey: "essentials",
    items: [
      { labelKey: "home", href: "/admin", icon: LayoutDashboard },
      { labelKey: "tenants", href: "/admin/tenants", icon: Building2, accent: "text-blue-500 dark:text-blue-400" },
      { labelKey: "incidents", href: "/admin/incidents", icon: Siren, accent: "text-rose-500 dark:text-rose-400" },
    ],
  },
  {
    titleKey: "platformOperations",
    collapsible: true,
    defaultExpanded: true,
    items: [
      { labelKey: "ops", href: "/admin/ops", icon: Gauge, accent: "text-indigo-500 dark:text-indigo-400" },
      { labelKey: "integrationOutbox", href: "/admin/ops/integrations", icon: Waypoints, accent: "text-indigo-500 dark:text-indigo-400" },
      { labelKey: "managed", href: "/admin/managed", icon: ShieldCheck, accent: "text-indigo-500 dark:text-indigo-400" },
      { labelKey: "platformHealth", href: "/admin/health", icon: Activity, accent: "text-rose-500 dark:text-rose-400" },
      { labelKey: "storage", href: "/admin/storage", icon: HardDrive, accent: "text-cyan-500 dark:text-cyan-400" },
      { labelKey: "webhookTap", href: "/admin/webhooks", icon: Radio },
    ],
  },
  {
    titleKey: "insights",
    collapsible: true,
    items: [
      { labelKey: "platformUsage", href: "/admin/usage", icon: TrendingUp },
      { labelKey: "llmStats", href: "/admin/llm-stats", icon: Brain, accent: "text-violet-500 dark:text-violet-400" },
      { labelKey: "funnel", href: "/admin/funnel", icon: FunnelIcon },
      { labelKey: "verticalAnalytics", href: "/admin/vertical-analytics", icon: PieChart },
    ],
  },
  {
    titleKey: "revenueBilling",
    collapsible: true,
    items: [
      { labelKey: "financials", href: "/admin/financials", icon: DollarSign, accent: "text-emerald-500 dark:text-emerald-400" },
      { labelKey: "fiscalAdmin", href: "/admin/fiscal", icon: Receipt, accent: "text-teal-500 dark:text-teal-400" },
      { labelKey: "billingOps", href: "/admin/billing-ops", icon: CreditCard, accent: "text-emerald-500 dark:text-emerald-400" },
      { labelKey: "plans", href: "/admin/plans", icon: Layers },
      { labelKey: "coupons", href: "/admin/coupons", icon: Tag },
      { labelKey: "smsPackages", href: "/admin/sms-packages", icon: MessageSquare, accent: "text-indigo-500 dark:text-indigo-400" },
    ],
  },
  {
    titleKey: "governance",
    collapsible: true,
    items: [
      { labelKey: "complianceAdmin", href: "/admin/compliance-admin", icon: Scale },
      { labelKey: "platformAudit", href: "/admin/audit", icon: ShieldCheck },
      { labelKey: "verticalAudit", href: "/admin/vertical-audit", icon: ClipboardList },
    ],
  },
  {
    titleKey: "config",
    items: [
      { labelKey: "personalSettings", href: "/admin/settings", icon: Settings },
    ],
  },
];

const categoryLabels: Record<string, Record<string, string>> = {
  new: { es: "NUEVO", en: "NEW", pt: "NOVO", fr: "NOUVEAU" },
  improved: { es: "MEJORA", en: "IMPROVED", pt: "MELHORIA", fr: "AMÉLIORATION" },
  fixed: { es: "CORREGIDO", en: "FIXED", pt: "CORRIGIDO", fr: "CORRIGÉ" }
};
const getCategoryLabel = (type: string, lang: string) => {
  return categoryLabels[type]?.[lang] || categoryLabels[type]?.['es'] || type.toUpperCase();
};

const ctaLabels: Record<string, string> = {
  es: "Entendido",
  en: "Got it",
  pt: "Entendido",
  fr: "Compris"
};
const getCtaLabel = (lang: string) => ctaLabels[lang] || ctaLabels['es'];

// Temporary fallbacks until these section keys are added to the four message files.
// Keeping the semantic section ids independent from their display copy prevents the
// information architecture from falling back to old technical group names.
const sectionLabelFallbacks: Record<string, Record<string, string>> = {
  essentials: { es: "Esenciales", en: "Essentials", pt: "Essenciais", fr: "Essentiels" },
  aiGrowth: { es: "IA y crecimiento", en: "AI & growth", pt: "IA e crescimento", fr: "IA et croissance" },
  insights: { es: "Insights", en: "Insights", pt: "Insights", fr: "Insights" },
  administration: { es: "Administración", en: "Administration", pt: "Administração", fr: "Administration" },
  platformOperations: { es: "Operación de plataforma", en: "Platform operations", pt: "Operação da plataforma", fr: "Opérations de la plateforme" },
  revenueBilling: { es: "Ingresos y facturación", en: "Revenue & billing", pt: "Receita e faturamento", fr: "Revenus et facturation" },
  governance: { es: "Gobierno y cumplimiento", en: "Governance & compliance", pt: "Governança e conformidade", fr: "Gouvernance et conformité" },
};

const itemLabelFallbacks: Record<string, Record<string, string>> = {
  home: { es: "Inicio", en: "Home", pt: "Início", fr: "Accueil" },
};

const defaultAccordionState: Record<string, boolean> = {
  crm: false,
  aiAgent: false,
  automation: false,
  analytics: false,
};

function getDefaultSectionState(definitions: NavSectionDef[]): Record<string, boolean> {
  return Object.fromEntries(
    definitions
      .filter((section) => section.collapsible)
      .map((section) => [section.titleKey, Boolean(section.defaultExpanded)]),
  );
}

function asBooleanRecord(value: unknown): Record<string, boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

interface AppSidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}


export default function AppSidebar({ mobileOpen = false, onMobileClose }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>(defaultAccordionState);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    getDefaultSectionState(tenantSections),
  );
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState<string | null>(null);
  const [routeBadgeCounts, setRouteBadgeCounts] = useState<Record<string, number>>({});

  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

  const pathname = usePathname();
  const currentNavigationLocation = useCurrentNavigationLocation();
  const { user, verticalConfig, planFeatures } = useAuth();
  const roleCtx = useRole();
  const { summary: qualityHealthSummary } = useQualityHealth();
  const { favorites } = useNavigationPreferences();
  const tNav = useTranslations('nav');
  const tCommand = useTranslations('navigation.command');
  const tNavigation = useTranslations('navigation');
  const tRoles = useTranslations('roles');
  const tTopbar = useTranslations('topbar');
  const tQualityHealth = useTranslations('qualityHealth');
  const locale = useLocale();

  // Decide which navigation tree to render. super_admin without
  // impersonation gets the platform tree; everyone else (including
  // super_admin while impersonating) gets the tenant tree.
  const useTenantTree = !roleCtx.isSuperAdmin || roleCtx.impersonating;
  const roleHomeHref = defaultLandingForRole(roleCtx.role, roleCtx.impersonating);
  const sectionDefs = useTenantTree ? tenantSections : platformSections;
  const preferenceKey = user?.id
    ? `parallly:sidebar:v2:${user.id}:${useTenantTree ? `tenant:${user.tenantId || "unknown"}` : "platform"}`
    : null;

  useEffect(() => {
    const updateBadges = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || typeof detail !== "object") return;
      const next: Record<string, number> = {};
      for (const [href, rawCount] of Object.entries(detail)) {
        const count = Math.max(0, Number(rawCount) || 0);
        if (count > 0) next[href] = count;
      }
      setRouteBadgeCounts(next);
    };
    window.addEventListener("navigation:badge-counts", updateBadges);
    return () => window.removeEventListener("navigation:badge-counts", updateBadges);
  }, []);

  useEffect(() => {
    const defaultSections = getDefaultSectionState(sectionDefs);
    setLoadedPreferenceKey(null);
    setHovered(false);

    if (!preferenceKey) {
      setCollapsed(false);
      setExpandedSections(defaultSections);
      setExpandedAccordions(defaultAccordionState);
      return;
    }

    try {
      const raw = localStorage.getItem(preferenceKey);
      const saved = raw ? JSON.parse(raw) as Record<string, unknown> : null;
      const savedSections = asBooleanRecord(saved?.expandedSections);
      const savedAccordions = asBooleanRecord(saved?.expandedAccordions);

      setCollapsed(typeof saved?.collapsed === "boolean" ? saved.collapsed : false);
      setExpandedSections({ ...defaultSections, ...(savedSections || {}) });
      setExpandedAccordions({ ...defaultAccordionState, ...(savedAccordions || {}) });
    } catch {
      setCollapsed(false);
      setExpandedSections(defaultSections);
      setExpandedAccordions(defaultAccordionState);
    } finally {
      setLoadedPreferenceKey(preferenceKey);
    }
  }, [preferenceKey, sectionDefs]);

  useEffect(() => {
    if (!preferenceKey || loadedPreferenceKey !== preferenceKey) return;
    try {
      localStorage.setItem(preferenceKey, JSON.stringify({
        collapsed,
        expandedSections,
        expandedAccordions,
      }));
    } catch {
      // Storage may be unavailable in privacy mode; navigation still works in memory.
    }
  }, [collapsed, expandedAccordions, expandedSections, loadedPreferenceKey, preferenceKey]);

  useEffect(() => {
    if (!useTenantTree) return;
    const revealTourTargets = () => {
      setExpandedSections((previous) => ({
        ...previous,
        aiGrowth: true,
        operation: true,
        insights: true,
        administration: true,
      }));
    };

    try {
      if (canRunProductTourAtWidth(window.innerWidth)
        && localStorage.getItem("parallly:tour:pending") === "true") revealTourTargets();
    } catch {
      // The tour remains optional when storage is unavailable.
    }

    window.addEventListener("parallly:prepare-tour", revealTourTargets);
    return () => window.removeEventListener("parallly:prepare-tour", revealTourTargets);
  }, [useTenantTree]);

  // --- Novedades (Dynamic System Updates) ---
  const [changelogItems, setChangelogItems] = useState<any[]>([]);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const changelogScrollRef = useRef<HTMLDivElement>(null);
  const changelogRestoreFocusRef = useRef<HTMLElement | null>(null);
  const [hasUnreadChangelog, setHasUnreadChangelog] = useState(false);

  // --- Active critical incidents badge (super_admin platform mode) ---
  const [criticalCount, setCriticalCount] = useState(0);

  useEffect(() => {
    if (useTenantTree) return; // only the platform tree shows the incidents badge
    let alive = true;
    async function loadIncidentCount() {
      try {
        const res = await api.getIncidentsSummary();
        if (alive && res.success) setCriticalCount(Number((res.data as any)?.activeCritical) || 0);
      } catch { /* ignore */ }
    }
    loadIncidentCount();
    const id = setInterval(loadIncidentCount, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [useTenantTree]);

  useEffect(() => {
    if (!useTenantTree) return; // Only tenant users see system release announcements in popup/sidebar

    async function loadChangelog() {
      try {
        const result = await api.getSystemUpdates();
        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          const activeUpdates = result.data;
          setChangelogItems(activeUpdates);
          
          const latestUpdate = activeUpdates[0];
          const lastReadId = localStorage.getItem("lastReadChangelogId");

          if (!lastReadId) {
            // Cuenta nueva / primera sesión: NO mostramos novedades (para ellos todo es nuevo).
            // Los dejamos "al día" en silencio para que solo vean FUTURAS publicaciones —
            // sin auto-abrir el popup ni marcar indicador.
            localStorage.setItem("lastReadChangelogId", latestUpdate.id);
          } else if (lastReadId !== latestUpdate.id) {
            // Hay una novedad nueva desde la última visita → solo el indicador (no auto-abrir).
            // Al abrirla (openChangelogModal) se marca leída y deja de aparecer.
            setHasUnreadChangelog(true);
          }
        }
      } catch {
        // Silent catch on network failure
      }
    }
    loadChangelog();
  }, [useTenantTree]);

  const openChangelogModal = (event: ReactMouseEvent<HTMLButtonElement>) => {
    changelogRestoreFocusRef.current = event.currentTarget;
    if (onMobileClose) onMobileClose();
    setChangelogOpen(true);
    if (changelogItems.length > 0) {
      const latestUpdate = changelogItems[0];
      localStorage.setItem("lastReadChangelogId", latestUpdate.id);
      setHasUnreadChangelog(false);
    }
  };


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
  const verticalDashboard = resolveVerticalDashboard(verticalConfig);

  const resolveLogoUrl = useCallback((raw: string) => {
    if (!raw) return "";
    if (raw.startsWith("http")) return raw;
    const base = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/api\/v1\/?$/, "");
    return base + raw;
  }, []);

  useEffect(() => {
    if (!user?.tenantId || !useTenantTree) return;
    (async () => {
      try {
        const res = await api.getBusinessInfo(user.tenantId!);
        if (res.success && res.data?.logoUrl) {
          setCompanyLogoUrl(resolveLogoUrl(res.data.logoUrl));
        }
      } catch { /* non-critical */ }
    })();
  }, [user?.tenantId, useTenantTree, resolveLogoUrl]);

  useEffect(() => {
    const onLogoChanged = (e: Event) => {
      const url = (e as CustomEvent).detail?.logoUrl;
      setCompanyLogoUrl(url ? resolveLogoUrl(url) : "");
    };
    window.addEventListener("logo-changed", onLogoChanged);
    return () => window.removeEventListener("logo-changed", onLogoChanged);
  }, [resolveLogoUrl]);

  const toggleAccordion = (key: string, mode: "desktop" | "mobile") => {
    if (mode === "desktop" && collapsed) setHovered(true);
    setExpandedAccordions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const checkCapability = (cap?: keyof ReturnType<typeof useRole>): boolean => {
    if (!cap) return true;
    return Boolean(roleCtx[cap]);
  };

  const checkVertical = (item?: VerticalDashboardItem): boolean => {
    if (!item) return true;
    return hasVerticalDashboardItem(verticalDashboard, item);
  };

  /**
   * Una opción que el plan no incluye no se esconde: se muestra con candado y
   * lleva a Facturación.
   *
   * Esconderla haría que el dueño no se entere de que existe; dejarla como
   * está la hace terminar en un 403 que se lee como que la aplicación falla.
   * El destino cambia, así que la promesa del menú se cumple siempre.
   */
  const applyPlanGate = <T extends { href: string }>(item: T): T & { planLocked?: boolean } => {
    if (navigationPlanDecision(item.href, planFeatures) !== 'locked') return item;
    // Se cuenta la opción que el plan cierra. No es un dead end —lleva a
    // Facturación— pero es la medida de cuánta gente choca con el techo de su
    // plan, que es justo lo que el candado existe para hacer visible.
    recordNavigationEvent(user?.tenantId, {
      event: 'navigation.plan_locked',
      route: item.href,
      reason: 'plan',
      requirement: planFeatureForPath(item.href) || undefined,
    });
    return { ...item, href: '/admin/settings/billing', planLocked: true };
  };

  const canNavigatePath = (href: string): boolean => Boolean(roleCtx.role) && (
    canAccessDashboardNavigationPath(
      href,
      roleCtx.role!,
      roleCtx.impersonating,
      verticalConfig,
    )
  );

  const getItemLabel = (key: string) => {
    const translationKey = `items.${key}`;
    if (tNav.has(translationKey)) {
      return resolveNavigationDisplayLabel(key, tNav(translationKey), locale, labelOverrides);
    }
    const language = locale.split("-")[0];
    return resolveNavigationDisplayLabel(
      key,
      itemLabelFallbacks[key]?.[language] || itemLabelFallbacks[key]?.es || key,
      locale,
      labelOverrides,
    );
  };

  const filteredSections = sectionDefs.map(s => {
    const filteredItems = s.items.reduce<NavItemDef[]>((visibleItems, item) => {
      if (hiddenItems?.includes(item.labelKey)) return visibleItems;
      if (!checkVertical(item.verticalItem)) return visibleItems;
      if (!checkCapability(item.capability)) return visibleItems;
      if (item.href && !canNavigatePath(item.href)) return visibleItems;

      const children = item.children
        ?.filter(child => !hiddenItems?.includes(child.labelKey))
        ?.filter(child => checkCapability(child.capability))
        ?.filter(child => canNavigatePath(child.href))
        ?.map(applyPlanGate);

      // A destination remains useful even when all of its optional children are gated.
      if (item.children && !item.href && children?.length === 0) return visibleItems;
      visibleItems.push({ ...applyPlanGate(item as NavItemDef & { href: string }), children });
      return visibleItems;
    }, []);

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
      ...s,
      items: filteredItems,
    };
  }).filter((section) => section.items.length > 0);

  const availableHrefs = filteredSections.flatMap((section) =>
    section.items.flatMap((item) => [
      ...(item.href ? [item.href] : []),
      ...(item.children?.map((child) => child.href) || []),
    ]),
  );
  const activeHref = resolveActiveNavHref(pathname, availableHrefs);

  const sections: ResolvedNavSection[] = filteredSections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const children = item.children?.map((child) => ({
        ...child,
        label: getItemLabel(child.labelKey),
        active: child.href === activeHref,
      }));
      const linkActive = item.href === activeHref;
      return {
        ...item,
        label: getItemLabel(item.labelKey),
        children,
        linkActive,
        active: linkActive || Boolean(children?.some((child) => child.active)),
      };
    }),
  }));

  const visibleItemsByHref = new Map<string, ResolvedNavItem>();
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href && !visibleItemsByHref.has(item.href)) {
        visibleItemsByHref.set(item.href, item);
      }
      for (const child of item.children || []) {
        if (!visibleItemsByHref.has(child.href)) {
          visibleItemsByHref.set(child.href, {
            labelKey: child.labelKey,
            href: child.href,
            icon: item.icon,
            accent: item.accent,
            label: child.label,
            active: false,
            linkActive: false,
          });
        }
      }
    }
  }

  const favoriteItems = resolveVisibleFavoriteRoutes(favorites, availableHrefs)
    .reduce<ResolvedNavItem[]>((items, { routeId, href }) => {
      const source = visibleItemsByHref.get(href);
      if (!source) return items;
      items.push({
        ...source,
        labelKey: `favorite-${routeId}`,
        children: undefined,
        active: false,
        linkActive: false,
      });
      return items;
    }, []);

  const settingsNavigationHref = buildSettingsNavigationHref(currentNavigationLocation);

  const desktopExpanded = !collapsed || hovered;

  const handleNavClick = useCallback(() => {
    if (onMobileClose) onMobileClose();
  }, [onMobileClose]);

  const openHelp = useCallback(() => {
    window.dispatchEvent(new CustomEvent("parallly:open-copilot"));
    if (onMobileClose) onMobileClose();
  }, [onMobileClose]);

  const activeSectionKey = sections.find((section) =>
    section.items.some((item) => item.active),
  )?.titleKey;
  const activeAccordionKeys = sections.flatMap((section) =>
    section.items
      .filter((item) => item.children?.some((child) => child.active))
      .map((item) => item.labelKey),
  );
  const activeAccordionKeySignature = activeAccordionKeys.join("|");

  useEffect(() => {
    if (activeSectionKey && sectionDefs.some((section) => section.titleKey === activeSectionKey && section.collapsible)) {
      setExpandedSections((previous) => previous[activeSectionKey]
        ? previous
        : { ...previous, [activeSectionKey]: true });
    }
    const accordionKeys = activeAccordionKeySignature
      ? activeAccordionKeySignature.split("|")
      : [];
    if (accordionKeys.length > 0) {
      setExpandedAccordions((previous) => {
        const missing = accordionKeys.filter((key) => !previous[key]);
        return missing.length === 0
          ? previous
          : { ...previous, ...Object.fromEntries(missing.map((key) => [key, true])) };
      });
    }
  }, [pathname, activeAccordionKeySignature, activeSectionKey, sectionDefs]);

  const getSectionLabel = (key: string) => {
    const translationKey = `sections.${key}`;
    if (tNav.has(translationKey)) return tNav(translationKey);
    const language = locale.split("-")[0];
    return sectionLabelFallbacks[key]?.[language]
      || sectionLabelFallbacks[key]?.es
      || key.replace(/([a-z])([A-Z])/g, "$1 $2");
  };

  const renderNavItem = (
    item: ResolvedNavItem,
    mode: "desktop" | "mobile",
    expanded: boolean,
  ) => {
    const Icon = item.icon;
    const accordionExpanded = Boolean(expandedAccordions[item.labelKey]);
    const submenuId = `sidebar-${mode}-submenu-${item.labelKey}`;
    const tourId = mode === "desktop" ? `tour-${item.labelKey}` : `tour-mobile-${item.labelKey}`;
    const accordionLabel = `${accordionExpanded ? tNav("collapseSidebar") : tNav("expandSidebar")}: ${item.label}`;
    const qualityBadgeCount = getQualityAttentionCount(qualityHealthSummary);
    const badgeCount = item.labelKey.startsWith("favorite-") || !item.href
      ? 0
      : item.labelKey === "agentQuality"
        ? qualityBadgeCount
        : routeBadgeCounts[item.href] || 0;
    const criticalQualityBadge = item.labelKey === "agentQuality" && (qualityHealthSummary?.openCritical || 0) > 0;
    const primaryClassName = cn(
      "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
      mode === "mobile" && "min-h-11",
      !expanded && "justify-center px-0",
      expanded && item.children && item.href && "pr-10",
      item.linkActive
        ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
        : item.active
          ? "bg-indigo-50/40 text-indigo-700 dark:bg-indigo-500/5 dark:text-indigo-300"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-foreground dark:text-neutral-400 dark:hover:bg-neutral-800/80",
    );
    const primaryContents = (
      <>
        <span className="relative shrink-0">
          <Icon
            size={17}
            className={cn(
              item.active
                ? "text-indigo-600 dark:text-indigo-400"
                : item.accent || "text-neutral-400 dark:text-neutral-500",
            )}
          />
          {!expanded && item.labelKey === "incidents" && criticalCount > 0 && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background" />
          )}
          {!expanded && badgeCount > 0 && (
            <span className={cn("absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-background", criticalQualityBadge ? "bg-red-500" : "bg-orange-500")} />
          )}
        </span>
        {expanded && <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>}
        {/* El candado dice por qué el destino no es el que el nombre promete:
            el plan no la incluye, así que el enlace lleva a Facturación en vez
            de a un 403. */}
        {expanded && item.planLocked && (
          <Lock size={12} aria-label={tNav("planLocked")} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
        )}
        {expanded && item.labelKey === "incidents" && criticalCount > 0 && (
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {criticalCount}
          </span>
        )}
        {expanded && badgeCount > 0 && (
          <span
            aria-label={item.labelKey === "agentQuality"
              ? tQualityHealth("navBadge", { count: badgeCount })
              : tNavigation("badge.unread", { count: badgeCount, label: item.label })}
            className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white", criticalQualityBadge ? "bg-red-600" : item.labelKey === "agentQuality" ? "bg-orange-500" : "bg-indigo-600")}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </>
    );

    const primary = item.href ? (
      <Link
        href={item.href}
        onClick={handleNavClick}
        className={primaryClassName}
        aria-current={item.linkActive ? "page" : undefined}
        aria-label={!expanded ? item.label : undefined}
      >
        {primaryContents}
      </Link>
    ) : (
      <button
        type="button"
        className={primaryClassName}
        onClick={() => toggleAccordion(item.labelKey, mode)}
        aria-expanded={accordionExpanded}
        aria-controls={submenuId}
        aria-label={!expanded ? accordionLabel : undefined}
      >
        {primaryContents}
        {expanded && (accordionExpanded
          ? <ChevronDown size={14} aria-hidden="true" />
          : <ChevronRight size={14} aria-hidden="true" />)}
      </button>
    );

    return (
      <li key={item.labelKey} id={tourId} className="relative">
        {expanded ? (
          <div className="relative">
            {primary}
            {item.href && item.children && (
              <button
                type="button"
                onClick={() => toggleAccordion(item.labelKey, mode)}
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-neutral-700/70"
                aria-label={accordionLabel}
                aria-expanded={accordionExpanded}
                aria-controls={submenuId}
              >
                {accordionExpanded
                  ? <ChevronDown size={14} aria-hidden="true" />
                  : <ChevronRight size={14} aria-hidden="true" />}
              </button>
            )}
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{primary}</TooltipTrigger>
            <TooltipContent side="right">
              <span className="font-semibold">{item.label}</span>
            </TooltipContent>
          </Tooltip>
        )}

        {item.children && (
          <div id={submenuId}>
            <AnimatePresence initial={false}>
              {accordionExpanded && expanded && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeInOut" }}
                  className="mt-0.5 space-y-0.5 overflow-hidden"
                >
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        onClick={handleNavClick}
                        aria-current={child.active ? "page" : undefined}
                        className={cn(
                          "flex min-h-9 items-center rounded-md py-1.5 pl-9 pr-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
                          mode === "mobile" && "min-h-11",
                          child.active
                            ? "bg-indigo-50/70 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                            : "text-neutral-500 hover:bg-neutral-50 hover:text-foreground dark:text-neutral-400 dark:hover:bg-neutral-800/50",
                        )}
                      >
                        <span className="truncate">{child.label}</span>
                      </Link>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
      </li>
    );
  };

  const renderSidebarContent = (mode: "desktop" | "mobile") => {
    // A mobile drawer is always a full navigation surface. It never inherits the
    // desktop icon-rail preference.
    const expanded = mode === "mobile" ? true : desktopExpanded;
    const configItem = sections.find((section) => section.titleKey === "config")?.items[0];
    const mainSections = sections.filter((section) => section.titleKey !== "config");

    return (
      <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
        <div className={cn(
          "flex h-14 shrink-0 items-center border-b border-border/50 px-4 transition-all duration-200",
          expanded ? "justify-between" : "justify-center",
        )}>
          {expanded && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <Link
                href={roleHomeHref}
                onClick={handleNavClick}
                aria-label="Parallly"
                className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <Image src="/parallly-logo-black.svg" alt="Parallly" width={112} height={28} className="h-7 w-auto dark:hidden" priority />
                <Image src="/parallly-logo-white.svg" alt="Parallly" width={112} height={28} className="hidden h-7 w-auto dark:block" priority />
              </Link>
            </motion.div>
          )}
          {mode === "desktop" && (
            <button
              type="button"
              onClick={() => {
                setCollapsed((current) => !current);
                setHovered(false);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
              title={collapsed ? tNav("expandSidebar") : tNav("collapseSidebar")}
              aria-label={collapsed ? tNav("expandSidebar") : tNav("collapseSidebar")}
              aria-expanded={!collapsed}
            >
              {collapsed ? <PanelLeft size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
          )}
        </div>

        {expanded && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="shrink-0 border-b border-border/30 px-3 py-3">
            <Link
              href={roleHomeHref}
              onClick={handleNavClick}
              className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <span className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border",
                useTenantTree && companyLogoUrl
                  ? "border-neutral-200 bg-white dark:border-neutral-600 dark:bg-neutral-800"
                  : useTenantTree
                    ? "border-indigo-100 bg-indigo-50 dark:border-indigo-500/20 dark:bg-indigo-500/10"
                    : "border-amber-100 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10",
              )}>
                {useTenantTree && companyLogoUrl ? (
                  <Image src={companyLogoUrl} alt="" width={36} height={36} unoptimized className="h-full w-full object-contain p-0.5" />
                ) : (
                  <Building2 size={16} className={useTenantTree
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-amber-600 dark:text-amber-400"} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-foreground">
                  {useTenantTree
                    ? (user?.tenantName || user?.firstName || "Parallly")
                    : tNav("platformConsole")}
                </span>
                {/* Sin plan no se inventa uno: el `|| "starter"` que había acá
                    le mostraba STARTER a todo el mundo, porque el campo nunca
                    venía en la sesión. Una sesión vieja no lo trae hasta el
                    próximo login, y ahí es mejor no decir nada que mentir. */}
                {(!useTenantTree || user?.plan) && (
                  <span className="block truncate text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    {useTenantTree ? user?.plan : tNav("superAdminMode")}
                  </span>
                )}
              </span>
            </Link>
          </motion.div>
        )}

        <TooltipProvider delayDuration={200}>
          <nav aria-label={tTopbar("menu")} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-2 py-3 custom-scrollbar">
              {favoriteItems.length > 0 && (
                <section
                  aria-labelledby={expanded ? `sidebar-${mode}-favorites-label` : undefined}
                  className="mb-3"
                >
                  {expanded && (
                    <p
                      id={`sidebar-${mode}-favorites-label`}
                      className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
                    >
                      {tCommand("favorites")}
                    </p>
                  )}
                  <ul className="space-y-0.5">
                    {favoriteItems.map((item) => renderNavItem(item, mode, expanded))}
                  </ul>
                </section>
              )}

              {mainSections.map((section) => {
                const sectionExpanded = !section.collapsible || Boolean(expandedSections[section.titleKey]);
                const sectionContentId = `sidebar-${mode}-section-${section.titleKey}`;
                const sectionLabel = getSectionLabel(section.titleKey);
                const sectionQualityBadge = section.titleKey === "insights" && !sectionExpanded
                  ? getQualityAttentionCount(qualityHealthSummary)
                  : 0;
                const sectionHasCriticalQuality = section.titleKey === "insights"
                  && (qualityHealthSummary?.openCritical || 0) > 0;

                return (
                  <section key={section.titleKey} aria-labelledby={expanded ? `${sectionContentId}-label` : undefined} className="mt-3 first:mt-0">
                    {expanded && (section.collapsible ? (
                      <button
                        id={`${sectionContentId}-label`}
                        type="button"
                        onClick={() => toggleSection(section.titleKey)}
                        aria-expanded={sectionExpanded}
                        aria-controls={sectionContentId}
                        className="mb-1 flex min-h-7 w-full items-center justify-between rounded-md px-2 text-left text-[10px] font-bold uppercase tracking-wider text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
                      >
                        <span className="min-w-0 flex-1 truncate">{sectionLabel}</span>
                        {sectionQualityBadge > 0 && (
                          <span
                            aria-label={tQualityHealth("navBadge", { count: sectionQualityBadge })}
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white",
                              sectionHasCriticalQuality ? "bg-red-600" : "bg-orange-500",
                            )}
                          >
                            {sectionQualityBadge > 99 ? "99+" : sectionQualityBadge}
                          </span>
                        )}
                        {sectionExpanded
                          ? <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
                          : <ChevronRight size={13} className="shrink-0" aria-hidden="true" />}
                      </button>
                    ) : (
                      <p id={`${sectionContentId}-label`} className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                        {sectionLabel}
                      </p>
                    ))}
                    <div id={sectionContentId}>
                      <AnimatePresence initial={false}>
                        {sectionExpanded && (
                          <motion.ul
                            initial={section.collapsible ? { height: 0, opacity: 0 } : false}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: "easeInOut" }}
                            className="space-y-0.5 overflow-hidden"
                          >
                            {section.items.map((item) => renderNavItem(item, mode, expanded))}
                          </motion.ul>
                        )}
                      </AnimatePresence>
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="shrink-0 space-y-1 border-t border-border/40 p-2">
              {expanded ? (
                <button
                  type="button"
                  onClick={openHelp}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800/80",
                    mode === "mobile" && "min-h-11",
                  )}
                >
                  <LifeBuoy size={17} aria-hidden="true" />
                  <span className="truncate">{tNav("items.help")}</span>
                </button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={openHelp}
                      aria-label={tNav("items.help")}
                      className="flex min-h-10 w-full items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    >
                      <LifeBuoy size={17} aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{tNav("items.help")}</TooltipContent>
                </Tooltip>
              )}

              {useTenantTree && changelogItems.length > 0 && (expanded ? (
                <button
                  type="button"
                  onClick={openChangelogModal}
                  aria-haspopup="dialog"
                  aria-expanded={changelogOpen}
                  aria-controls="parallly-changelog-dialog"
                  className={cn(
                    "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                    mode === "mobile" && "min-h-11",
                    changelogOpen
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/80",
                  )}
                >
                  <span className="relative shrink-0">
                    <Sparkles size={17} aria-hidden="true" />
                    {hasUnreadChangelog && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-background" />}
                  </span>
                  <span className="truncate">{tNav("novedades")}</span>
                </button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={openChangelogModal}
                      aria-haspopup="dialog"
                      aria-expanded={changelogOpen}
                      aria-controls="parallly-changelog-dialog"
                      aria-label={tNav("novedades")}
                      className="relative flex min-h-10 w-full items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    >
                      <Sparkles size={17} aria-hidden="true" />
                      {hasUnreadChangelog && <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-background" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{tNav("novedades")}</TooltipContent>
                </Tooltip>
              ))}

              {configItem && (
                <ul className="space-y-0.5">
                  {renderNavItem(
                    { ...configItem, href: settingsNavigationHref },
                    mode,
                    expanded,
                  )}
                </ul>
              )}
            </div>
          </nav>
        </TooltipProvider>

        {expanded ? (
          <div className="shrink-0 border-t border-border/30 px-3 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
                <span className="text-[11px] font-semibold uppercase text-neutral-600 dark:text-neutral-300">
                  {(user?.firstName?.[0] || "") + (user?.lastName?.[0] || "")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-foreground">{user?.firstName} {user?.lastName}</p>
                <p className="truncate text-[10px] font-medium text-neutral-500 dark:text-neutral-400">{roleLabel}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 justify-center border-t border-border/30 py-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
                    <span className="text-[11px] font-semibold uppercase text-neutral-600 dark:text-neutral-300">
                      {(user?.firstName?.[0] || "") + (user?.lastName?.[0] || "")}
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
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "relative hidden h-screen shrink-0 transition-[width] duration-300 ease-in-out md:block",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          onMouseEnter={() => { if (collapsed) setHovered(true); }}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            "absolute inset-y-0 left-0 z-40 overflow-hidden border-r border-neutral-200 bg-white transition-[width,box-shadow] duration-300 ease-in-out dark:border-neutral-800 dark:bg-neutral-950",
            desktopExpanded ? "w-64" : "w-16",
            collapsed && hovered && "shadow-2xl shadow-black/15 dark:shadow-black/40",
          )}
        >
          {renderSidebarContent("desktop")}
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={(open) => { if (!open && onMobileClose) onMobileClose(); }}>
        <SheetContent
          side="left"
          showCloseButton={true}
          onCloseAutoFocus={(event) => {
            const trigger = document.getElementById("dashboard-mobile-menu-trigger");
            const mainHeading = document.querySelector<HTMLElement>("#main-content h1");
            const mainContent = document.getElementById("main-content");
            const target = trigger instanceof HTMLElement && trigger.getClientRects().length > 0
              ? trigger
              : mainHeading ?? mainContent;
            if (!target) return;
            event.preventDefault();
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus();
          }}
          className="flex w-[min(88vw,280px)] flex-col bg-white p-0 dark:bg-neutral-950 sm:w-[280px]"
        >
          <SheetTitle className="sr-only">{tTopbar("menu")}</SheetTitle>
          {renderSidebarContent("mobile")}
        </SheetContent>
      </Sheet>

      {/* Dynamic Novedades dialog: Radix owns focus, Escape, scroll lock and restoration. */}
      {changelogItems.length > 0 && (
      <Dialog.Root open={changelogOpen} onOpenChange={setChangelogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
          <Dialog.Content
            id="parallly-changelog-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              changelogScrollRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              const remembered = changelogRestoreFocusRef.current;
              const fallback = document.getElementById("dashboard-mobile-menu-trigger");
              const mainContent = document.getElementById("main-content");
              const isVisible = (candidate: HTMLElement | null | undefined): candidate is HTMLElement => (
                Boolean(candidate?.isConnected && candidate.getClientRects().length > 0)
              );
              const target = isVisible(remembered)
                ? remembered
                : isVisible(fallback)
                  ? fallback
                  : mainContent;
              changelogRestoreFocusRef.current = null;
              if (!target) return;
              event.preventDefault();
              target.focus();
            }}
            className="fixed left-1/2 top-1/2 z-[9999] flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 select-none flex-col overflow-hidden rounded-2xl border border-neutral-200/50 bg-white shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 dark:border-neutral-800/50 dark:bg-neutral-900"
          >
              {/* Header Gradient */}
              <div className="relative bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 p-6 text-white shrink-0">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label={getCtaLabel(locale.split('-')[0])}
                    className="absolute right-4 top-4 rounded-full bg-white/10 p-1.5 text-white/80 transition-all duration-150 hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </Dialog.Close>
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-white/20 backdrop-blur-md px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wider uppercase">
                    {changelogItems[0].version}
                  </div>
                  <span className="text-white/60 text-xs font-semibold">
                    • {new Date(changelogItems[0].date).toLocaleDateString(locale === "es" ? "es-ES" : locale, { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <Dialog.Title className="flex items-center gap-2 text-xl font-extrabold tracking-tight md:text-2xl">
                  <Sparkles size={20} className="shrink-0 animate-pulse animate-duration-1000 text-amber-300" aria-hidden="true" />
                  <span className="truncate">{changelogItems[0].title[locale] || changelogItems[0].title['es'] || ''}</span>
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm font-medium leading-relaxed text-white/90">
                  {changelogItems[0].description[locale] || changelogItems[0].description['es'] || ''}
                </Dialog.Description>
              </div>

              {/* Scrollable Features List */}
              <div
                ref={changelogScrollRef}
                role="region"
                tabIndex={0}
                aria-label={tNav("novedades")}
                className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-neutral-50/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:bg-neutral-900/30"
              >
                {changelogItems[0].features && Array.isArray(changelogItems[0].features) && (
                  changelogItems[0].features.map((feature: any, idx: number) => {
                    const featTitle = feature.title?.[locale] || feature.title?.[locale.split('-')[0]] || feature.title?.['es'] || '';
                    const featDesc = feature.desc?.[locale] || feature.desc?.[locale.split('-')[0]] || feature.desc?.['es'] || '';
                    const badgeText = getCategoryLabel(feature.type, locale.split('-')[0]);
                    
                    return (
                      <div key={idx} className="flex gap-4 items-start border-b border-neutral-100 dark:border-neutral-800/40 pb-5 last:border-0 last:pb-0">
                        <div className="shrink-0 mt-0.5">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                            feature.type === 'new' && "bg-indigo-50 text-indigo-700 border border-indigo-200/50 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-800/30",
                            feature.type === 'improved' && "bg-emerald-50 text-emerald-700 border border-emerald-200/50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-800/30",
                            feature.type === 'fixed' && "bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-800/30"
                          )}>
                            {badgeText}
                          </span>
                        </div>
                        <div className="flex-1 space-y-2">
                          <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                            {featTitle}
                          </h4>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed font-medium">
                            {featDesc}
                          </p>
                          {feature.image && (
                            <div className="relative mt-3 rounded-lg overflow-hidden border border-neutral-200/40 dark:border-neutral-800/50 shadow-sm max-w-md group select-none">
                              <Image
                                src={feature.image.startsWith('/') ? `${process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, '') || 'https://api.parallly-chat.cloud'}${feature.image}` : feature.image}
                                alt={featTitle}
                                width={640}
                                height={360}
                                unoptimized
                                className="w-full h-auto object-cover max-h-56 transform group-hover:scale-[1.02] transition-transform duration-300"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom Close Button */}
              <div className="p-4 border-t border-neutral-100 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 flex justify-end shrink-0">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/10 transition-all duration-150 hover:bg-indigo-500 hover:shadow-indigo-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:scale-[0.98]"
                  >
                    {getCtaLabel(locale.split('-')[0])}
                  </button>
                </Dialog.Close>
              </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      )}
    </>
  );
}

