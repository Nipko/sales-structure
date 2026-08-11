"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import {
  ArrowRight,
  CalendarPlus,
  Clock3,
  Command,
  ContactRound,
  Megaphone,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigationPreferences } from "@/hooks/useNavigationPreferences";
import { useCurrentNavigationLocation } from "@/hooks/useCurrentNavigationLocation";
import {
  getNavigationRoute,
  NAVIGATION_ROUTES,
  navigationItemKeyFromTitleKey,
  normalizeNavigationPath,
  resolveNavigationDisplayLabel,
  sanitizeInternalReturnTo,
  type NavigationRouteDefinition,
} from "@/lib/navigation-contract";
import { canAccessDashboardNavigationPath } from "@/lib/navigation-access";
import { cn } from "@/lib/utils";

const OPEN_NAVIGATION_COMMAND_EVENT = "navigation:command-open";

interface PaletteDestination {
  kind: "destination";
  id: string;
  href: string;
  label: string;
  route: NavigationRouteDefinition;
}

interface PaletteAction {
  kind: "action";
  id: string;
  href: string;
  label: string;
  icon: typeof Plus;
}

type PaletteItem = PaletteDestination | PaletteAction;

interface PaletteSection {
  id: string;
  label: string;
  items: PaletteItem[];
}

interface OpenNavigationCommandDetail {
  restoreFocus?: HTMLElement | null;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function NavigationCommandPalette() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const currentNavigationLocation = useCurrentNavigationLocation();
  const role = useRole();
  const { verticalConfig } = useAuth();
  const { favorites, recents, isFavorite, toggleFavorite } = useNavigationPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const labelOverrides = verticalConfig?.sidebar?.labelOverrides as
    | Record<string, Record<string, string>>
    | undefined;
  const isPathVisible = useCallback((href: string) => (
    Boolean(role.role) && canAccessDashboardNavigationPath(
      href,
      role.role!,
      role.impersonating,
      verticalConfig,
    )
  ), [role, verticalConfig]);

  const getLabel = useCallback((route: NavigationRouteDefinition) => (
    resolveNavigationDisplayLabel(
      navigationItemKeyFromTitleKey(route.titleKey),
      t(route.titleKey),
      locale,
      labelOverrides,
    )
  ), [labelOverrides, locale, t]);

  const destinations = useMemo<PaletteDestination[]>(() => {
    return NAVIGATION_ROUTES
      .filter((route) => !route.pattern.includes(":"))
      .filter((route) => route.discoverable !== false)
      .filter((route) => isPathVisible(route.pattern))
      .map((route) => ({
        kind: "destination" as const,
        id: `route:${route.id}`,
        href: route.pattern,
        label: getLabel(route),
        route,
      }));
  }, [getLabel, isPathVisible]);

  const quickActions = useMemo<PaletteAction[]>(() => [
    isPathVisible("/admin/contacts") && {
      kind: "action" as const,
      id: "action:new-contact",
      href: "/admin/contacts?create=contact",
      label: t("navigation.quickCreate.contact"),
      icon: ContactRound,
    },
    isPathVisible("/admin/appointments") && {
      kind: "action" as const,
      id: "action:new-appointment",
      href: "/admin/appointments?create=appointment",
      label: t("navigation.quickCreate.appointment"),
      icon: CalendarPlus,
    },
    isPathVisible("/admin/broadcast") && {
      kind: "action" as const,
      id: "action:new-campaign",
      href: "/admin/broadcast?create=campaign",
      label: t("navigation.quickCreate.campaign"),
      icon: Megaphone,
    },
  ].filter((item): item is PaletteAction => Boolean(item)), [isPathVisible, t]);

  const favoriteDestinations = useMemo(() => favorites
    .map((routeId) => destinations.find((entry) => entry.route.id === routeId))
    .filter((entry): entry is PaletteDestination => Boolean(entry)), [destinations, favorites]);

  const recentDestinations = useMemo(() => recents
    .map((recent) => {
      const definition = getNavigationRoute(recent.routeId);
      if (!definition || definition.discoverable === false || definition.pattern.includes(":") || !isPathVisible(recent.href)) return null;
      return {
        kind: "destination" as const,
        id: `recent:${definition.id}`,
        href: recent.href,
        label: getLabel(definition),
        route: definition,
      };
    })
    .filter((entry): entry is PaletteDestination => Boolean(entry)), [getLabel, isPathVisible, recents]);

  const normalizedQuery = normalizeSearch(query.trim());
  const filteredDestinations = useMemo(() => {
    if (!normalizedQuery) return destinations;
    return destinations.filter((entry) => normalizeSearch(
      `${entry.label} ${entry.route.id} ${entry.route.pattern.replaceAll("-", " ")}`,
    ).includes(normalizedQuery));
  }, [destinations, normalizedQuery]);

  const displaySections = useMemo<PaletteSection[]>(() => {
    if (normalizedQuery) {
      return [{ id: "results", label: t("navigation.command.results"), items: filteredDestinations }];
    }
    const used = new Set<string>();
    const unique = (items: PaletteItem[]): PaletteItem[] => items.filter((item) => {
      const identity = item.kind === "destination" ? item.route.id : item.id;
      if (used.has(identity)) return false;
      used.add(identity);
      return true;
    });
    const sections: PaletteSection[] = [
      { id: "actions", label: t("navigation.command.quickActions"), items: unique(quickActions) },
      { id: "favorites", label: t("navigation.command.favorites"), items: unique(favoriteDestinations) },
      { id: "recent", label: t("navigation.command.recent"), items: unique(recentDestinations) },
      { id: "all", label: t("navigation.command.allDestinations"), items: unique(destinations) },
    ];
    return sections.filter((section) => section.items.length > 0);
  }, [destinations, favoriteDestinations, filteredDestinations, normalizedQuery, quickActions, recentDestinations, t]);

  const visibleItems = useMemo(
    () => displaySections.flatMap((section) => section.items),
    [displaySections],
  );
  const activeItem = visibleItems[Math.min(activeIndex, Math.max(visibleItems.length - 1, 0))];

  const navigate = useCallback((item: PaletteItem) => {
    setOpen(false);
    setQuery("");
    let href = item.href;
    const destinationPath = normalizeNavigationPath(href);
    const currentPath = normalizeNavigationPath(currentNavigationLocation);
    if (
      destinationPath
      && currentPath
      && destinationPath.startsWith("/admin/settings")
      && !currentPath.startsWith("/admin/settings")
    ) {
      const returnTo = sanitizeInternalReturnTo(currentNavigationLocation);
      if (returnTo) {
        const destination = new URL(href, "https://navigation.parallly.invalid");
        destination.searchParams.set("returnTo", returnTo);
        href = `${destination.pathname}${destination.search}${destination.hash}`;
      }
    }
    router.push(href);
  }, [currentNavigationLocation, router]);

  useEffect(() => {
    const openPalette = (event: Event) => {
      const requestedTarget = (event as CustomEvent<OpenNavigationCommandDetail>).detail?.restoreFocus;
      const activeTarget = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      restoreFocusRef.current = requestedTarget?.isConnected
        ? requestedTarget
        : activeTarget?.isConnected
          ? activeTarget
          : null;
      setOpen(true);
    };
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent<OpenNavigationCommandDetail>(
          OPEN_NAVIGATION_COMMAND_EVENT,
          { detail: { restoreFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null } },
        ));
        return;
      }
      if (open || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (!event.altKey || !["1", "2", "3"].includes(event.key)) return;
      const shortcuts = role.isSuperAdmin && !role.impersonating
        ? ["/admin/tenants", "/admin/incidents", "/admin/ops"]
        : role.canSeeGlobalAnalytics
          ? ["/admin", "/admin/inbox", "/admin/contacts"]
          : role.canHandleConversations
            ? ["/admin/inbox", "/admin/contacts", "/admin/pipeline"]
            : ["/admin/settings/profile", "/admin/settings/security", "/admin/settings/appearance"];
      const href = shortcuts[Number(event.key) - 1];
      if (!href || !role.canAccess(href)) return;
      event.preventDefault();
      router.push(href);
    };
    window.addEventListener(OPEN_NAVIGATION_COMMAND_EVENT, openPalette);
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener(OPEN_NAVIGATION_COMMAND_EVENT, openPalette);
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, [open, role, router]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open || !activeItem) return;
    document.getElementById(`navigation-command-${activeItem.id}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeItem, open]);

  const handleListKeyboard = (event: React.KeyboardEvent) => {
    if (event.target !== inputRef.current) return;
    if (!visibleItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + visibleItems.length) % visibleItems.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigate(visibleItems[Math.min(activeIndex, visibleItems.length - 1)]);
    }
  };

  let itemIndex = -1;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setQuery("");
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          aria-describedby="navigation-command-description"
          onKeyDown={handleListKeyboard}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const remembered = restoreFocusRef.current;
            restoreFocusRef.current = null;
            const mainContent = document.getElementById("main-content");
            const isVisible = (candidate: HTMLElement | null | undefined): candidate is HTMLElement => (
              Boolean(candidate?.isConnected && candidate.getClientRects().length > 0)
            );
            const target = isVisible(remembered) ? remembered : mainContent;
            if (!target) return;
            event.preventDefault();
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus();
          }}
          className="fixed left-1/2 top-[10vh] z-[91] flex max-h-[80vh] w-[calc(100vw-1.5rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl outline-none dark:border-neutral-800 dark:bg-neutral-950 sm:top-[14vh]"
        >
          <div className="flex items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
            <Search className="shrink-0 text-neutral-400" size={20} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("navigation.command.placeholder")}
              aria-label={t("navigation.command.placeholder")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls="navigation-command-results"
              aria-activedescendant={visibleItems[activeIndex] ? `navigation-command-${visibleItems[activeIndex].id}` : undefined}
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-neutral-400"
            />
            <span className="hidden rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-semibold text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 sm:inline-flex">
              Esc
            </span>
            <Dialog.Close
              aria-label={t("navigation.command.close")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-neutral-800 sm:hidden"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <Dialog.Title className="sr-only">{t("navigation.command.title")}</Dialog.Title>
          <Dialog.Description id="navigation-command-description" className="sr-only">
            {t("navigation.command.description")}
          </Dialog.Description>

          <div id="navigation-command-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleItems.length === 0 ? (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center">
                <Search size={26} className="text-neutral-300 dark:text-neutral-700" aria-hidden="true" />
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("navigation.command.noResults")}</p>
              </div>
            ) : displaySections.map((section) => (
              <section key={section.id} role="group" aria-labelledby={`navigation-command-section-${section.id}`} className="mb-3 last:mb-0">
                <h2 id={`navigation-command-section-${section.id}`} className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  {section.label}
                </h2>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    itemIndex += 1;
                    const currentIndex = itemIndex;
                    const active = currentIndex === activeIndex;
                    const Icon = item.kind === "action" ? item.icon : section.id === "recent" ? Clock3 : Command;
                    return (
                      <div
                        key={`${section.id}:${item.id}`}
                        id={`navigation-command-${item.id}`}
                        role="option"
                        aria-selected={active}
                        className={cn(
                          "group flex min-h-11 items-center gap-1 rounded-xl px-1 transition-colors",
                          active ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-neutral-50 dark:hover:bg-neutral-900",
                        )}
                        onMouseEnter={() => setActiveIndex(currentIndex)}
                        onClick={() => navigate(item)}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left">
                          <span className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                            item.kind === "action"
                              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                          )}>
                            <Icon size={16} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{item.label}</span>
                            {item.kind === "destination" && (
                              <span className="block truncate text-[11px] text-neutral-400">{item.href}</span>
                            )}
                          </span>
                          <ArrowRight size={15} className="shrink-0 text-neutral-300 group-hover:text-indigo-500 dark:text-neutral-700" aria-hidden="true" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className={cn(
            "items-center justify-between gap-3 border-t border-neutral-200 px-4 py-2 text-[11px] text-neutral-400 dark:border-neutral-800",
            activeItem?.kind === "destination" ? "flex" : "hidden sm:flex",
          )}>
            <span className="hidden sm:inline">{t("navigation.command.keyboardHelp")}</span>
            {activeItem?.kind === "destination" && (
              <button
                type="button"
                onClick={() => toggleFavorite(activeItem.route.id)}
                aria-label={t(isFavorite(activeItem.route.id) ? "navigation.command.unfavorite" : "navigation.command.favorite", { label: activeItem.label })}
                className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-neutral-500 hover:bg-neutral-100 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Star size={14} fill={isFavorite(activeItem.route.id) ? "currentColor" : "none"} aria-hidden="true" />
                <span className="hidden max-w-48 truncate sm:inline">{activeItem.label}</span>
              </button>
            )}
            <span className="hidden items-center gap-3 sm:inline-flex">
              <span className="inline-flex items-center gap-1"><Command size={12} aria-hidden="true" /> K</span>
              <span>{t("navigation.command.primaryShortcuts")}</span>
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
