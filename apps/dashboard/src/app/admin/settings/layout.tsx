"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Menu, Search, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import {
    getActiveSettingHref,
    getVisibleSections,
    normalizeSettingsSearch,
    resolveSettingsReturnTo,
    SETTINGS_HUB_HREF,
    withSettingsReturnTo,
} from "./_settings-config";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const role = useRole();
    const t = useTranslations("settings");
    const [search, setSearch] = useState("");
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [preservedReturnTo, setPreservedReturnTo] = useState<string | null>(null);
    const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
    const mobileDrawerRef = useRef<HTMLDivElement>(null);

    const sections = useMemo(() => getVisibleSections({
        canManageBilling: role.canManageBilling,
        isSupervisor: role.isSupervisor,
        canManagePlatform: role.canManagePlatform,
        isSuperAdminPlatformMode: role.isSuperAdmin && !role.impersonating,
    }), [
        role.canManageBilling,
        role.canManagePlatform,
        role.impersonating,
        role.isSuperAdmin,
        role.isSupervisor,
    ]);

    const filteredSections = useMemo(() => {
        const q = normalizeSettingsSearch(search);
        if (!q) return sections;

        return sections
            .map((section) => {
                const sectionTitle = t(`sections.${section.key}.title`, {
                    defaultValue: section.key,
                });
                const sectionDescription = t(`sections.${section.key}.description`, {
                    defaultValue: "",
                });

                if (
                    normalizeSettingsSearch(sectionTitle).includes(q)
                    || normalizeSettingsSearch(sectionDescription).includes(q)
                ) return section;

                return {
                    ...section,
                    items: section.items.filter((item) => {
                        const label = t(`items.${item.key}.label`, {
                            defaultValue: item.key,
                        });
                        const description = t(`items.${item.key}.description`, {
                            defaultValue: "",
                        });
                        return normalizeSettingsSearch(label).includes(q)
                            || normalizeSettingsSearch(description).includes(q);
                    }),
                };
            })
            .filter((section) => section.items.length > 0);
    }, [search, sections, t]);

    const requestedReturnTo = searchParams.get("returnTo");
    const validatedReturnTo = resolveSettingsReturnTo(
        requestedReturnTo,
        role.canAccess,
        pathname,
    );

    // Nested Next layouts remain mounted while moving between Settings pages.
    // Remember the validated origin so hub-card navigation cannot lose it.
    useEffect(() => {
        if (requestedReturnTo) setPreservedReturnTo(validatedReturnTo);
    }, [requestedReturnTo, validatedReturnTo]);

    const returnTo = requestedReturnTo
        ? validatedReturnTo
        : preservedReturnTo ?? SETTINGS_HUB_HREF;
    const isHub = pathname === SETTINGS_HUB_HREF;
    const activeHref = getActiveSettingHref(pathname, sections);
    const activeItem = sections
        .flatMap((section) => section.items)
        .find((item) => item.href === activeHref);
    const settingsHomeHref = withSettingsReturnTo(SETTINGS_HUB_HREF, returnTo);
    const showBackLink = !isHub || returnTo !== SETTINGS_HUB_HREF;
    const backLabel = returnTo === SETTINGS_HUB_HREF
        ? t("backToSettings")
        : t("backToPrevious", { defaultValue: t("backToSettings") });

    useEffect(() => {
        setMobileNavOpen(false);
    }, [pathname]);

    useEffect(() => {
        const desktop = window.matchMedia("(min-width: 1024px)");
        const closeMobileNavigation = (event: MediaQueryListEvent | MediaQueryList) => {
            if (event.matches) setMobileNavOpen(false);
        };
        closeMobileNavigation(desktop);
        desktop.addEventListener("change", closeMobileNavigation);
        return () => desktop.removeEventListener("change", closeMobileNavigation);
    }, []);

    useEffect(() => {
        if (!mobileNavOpen) return;

        const previousOverflow = document.body.style.overflow;
        const returnFocusTo = mobileNavButtonRef.current;
        document.body.style.overflow = "hidden";

        const drawer = mobileDrawerRef.current;
        const focusableSelector = [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "[tabindex]:not([tabindex='-1'])",
        ].join(",");
        const firstFocusable = drawer?.querySelector<HTMLElement>(focusableSelector);
        firstFocusable?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setMobileNavOpen(false);
                return;
            }

            if (event.key !== "Tab" || !drawer) return;
            const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector))
                .filter((element) => !element.hasAttribute("disabled"));
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleKeyDown);
            if (returnFocusTo?.getClientRects().length) {
                returnFocusTo.focus();
            } else {
                document.querySelector<HTMLElement>("[data-settings-desktop-navigation] a")?.focus();
            }
        };
    }, [mobileNavOpen]);

    const renderNavigation = (idPrefix: string, onNavigate?: () => void) => (
        <>
            <div className="px-3 pb-1 pt-3 shrink-0">
                <label htmlFor={`${idPrefix}-settings-search`} className="sr-only">
                    {t("searchSettings")}
                </label>
                <div className="relative">
                    <Search
                        size={16}
                        aria-hidden="true"
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <input
                        id={`${idPrefix}-settings-search`}
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("searchSettings")}
                        className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-700 placeholder:text-neutral-400 transition-all focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                </div>
            </div>

            <nav
                aria-label={t("navigationLabel", { defaultValue: t("title") })}
                className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-2 pb-6 pt-3"
            >
                {filteredSections.length === 0 ? (
                    <p role="status" className="px-3 py-6 text-center text-xs text-neutral-400">
                        {t("noResults")}
                    </p>
                ) : (
                    filteredSections.map((section) => {
                        const sectionTitleId = `${idPrefix}-${section.key}-title`;
                        return (
                            <section key={section.key} aria-labelledby={sectionTitleId}>
                                <h3
                                    id={sectionTitleId}
                                    className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500"
                                >
                                    {t(`sections.${section.key}.title`, {
                                        defaultValue: section.key,
                                    })}
                                </h3>
                                <ul className="space-y-0.5">
                                    {section.items.map((item) => {
                                        const active = activeHref === item.href;
                                        const Icon = item.icon;
                                        return (
                                            <li key={item.key}>
                                                <Link
                                                    href={withSettingsReturnTo(item.href, returnTo)}
                                                    aria-current={active ? "page" : undefined}
                                                    onClick={onNavigate}
                                                    className={cn(
                                                        "relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
                                                        active
                                                            ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200/60 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-800/60"
                                                            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200",
                                                    )}
                                                >
                                                    <Icon
                                                        size={16}
                                                        aria-hidden="true"
                                                        className={cn("shrink-0", active && "text-indigo-500")}
                                                    />
                                                    <span className="truncate">
                                                        {t(`items.${item.key}.label`, {
                                                            defaultValue: item.key,
                                                        })}
                                                    </span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        );
                    })
                )}
            </nav>
        </>
    );

    return (
        <div className="relative -m-4 min-w-0 overflow-x-hidden md:-m-6 lg:flex lg:h-[calc(100%+3rem)] lg:overflow-hidden">
            <aside data-settings-desktop-navigation className="hidden h-full w-[280px] shrink-0 flex-col overflow-hidden border-r border-neutral-200 bg-neutral-50/50 dark:border-neutral-800 dark:bg-neutral-950/50 lg:flex">
                <div className="shrink-0 border-b border-neutral-200/60 p-4 pb-3 dark:border-neutral-800/60">
                    {showBackLink && (
                        <Link
                            href={returnTo}
                            className="mb-3 inline-flex min-h-8 items-center gap-1.5 rounded-md pr-2 text-xs text-neutral-500 transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400"
                        >
                            <ArrowLeft size={14} aria-hidden="true" />
                            <span>{backLabel}</span>
                        </Link>
                    )}
                    <Link
                        href={settingsHomeHref}
                        className="flex w-fit items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 ring-1 ring-inset ring-indigo-200/60 dark:bg-indigo-500/15 dark:ring-indigo-800/40">
                            <Settings size={18} aria-hidden="true" className="text-indigo-600 dark:text-indigo-400" />
                        </span>
                        <span>
                            <span className="block text-[15px] font-bold text-neutral-900 dark:text-neutral-100">{t("title")}</span>
                            <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{t("sidebarSubtitle")}</span>
                        </span>
                    </Link>
                </div>
                {renderNavigation("desktop")}
            </aside>

            <div className="min-w-0 flex-1 lg:overflow-y-auto">
                <div className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 lg:hidden">
                    <button
                        ref={mobileNavButtonRef}
                        type="button"
                        aria-expanded={mobileNavOpen}
                        aria-controls="settings-mobile-navigation"
                        aria-label={t("navigationLabel", { defaultValue: t("title") })}
                        onClick={() => setMobileNavOpen(true)}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                        <Menu size={19} aria-hidden="true" />
                    </button>
                    <Link href={settingsHomeHref} className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                        <span className="block text-xs font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</span>
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {activeItem
                                ? t(`items.${activeItem.key}.label`, { defaultValue: activeItem.key })
                                : t("sidebarSubtitle")}
                        </span>
                    </Link>
                    {showBackLink && (
                        <Link
                            href={returnTo}
                            aria-label={backLabel}
                            className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        >
                            <ArrowLeft size={18} aria-hidden="true" />
                        </Link>
                    )}
                </div>

                <div className={cn("min-w-0 p-4 sm:p-6", isHub && "mx-auto w-full max-w-6xl")}>{children}</div>
            </div>

            {mobileNavOpen && (
                <div
                    className="fixed inset-0 z-[80] bg-black/45 lg:hidden"
                    onMouseDown={(event) => {
                        if (event.currentTarget === event.target) setMobileNavOpen(false);
                    }}
                >
                    <div
                        ref={mobileDrawerRef}
                        id="settings-mobile-navigation"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-mobile-navigation-title"
                        className="flex h-full w-[min(22rem,calc(100vw-2rem))] max-w-full flex-col overflow-hidden border-r border-neutral-200 bg-neutral-50 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
                    >
                        <div className="flex min-h-16 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
                            <Settings size={19} aria-hidden="true" className="text-indigo-600 dark:text-indigo-400" />
                            <h2 id="settings-mobile-navigation-title" className="font-semibold text-neutral-900 dark:text-neutral-100">
                                {t("title")}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setMobileNavOpen(false)}
                                aria-label={t("closeNavigation", { defaultValue: t("title") })}
                                className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                            >
                                <X size={19} aria-hidden="true" />
                            </button>
                        </div>
                        {renderNavigation("mobile", () => setMobileNavOpen(false))}
                    </div>
                </div>
            )}
        </div>
    );
}
