"use client";

import { useState, useEffect, useRef } from "react";
import AppSidebar from "@/components/layout/AppSidebar";
import TopBar from "@/components/layout/TopBar";
import TrialCountdownBanner from "@/components/TrialCountdownBanner";
import SuspendedScreen from "@/components/SuspendedScreen";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { FiscalBanner } from "@/components/FiscalBanner";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { HelpAssistant } from "@/components/HelpAssistant";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { TenantProvider } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useRouter, usePathname } from "next/navigation";
import {
  canAccessDashboardNavigationPath,
  resolveAccessDeniedNavigation,
} from "@/lib/navigation-access";
import { OnbordaProvider, Onborda } from "onborda";
import { TourCard, useProductTourSteps, TourLauncher, TourBoundary } from "@/components/tour/ProductTour";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { ShieldAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import NavigationCommandPalette from "@/components/layout/NavigationCommandPalette";
import { NavigationPageProvider } from "@/contexts/NavigationPageContext";
import { QualityHealthProvider } from "@/contexts/QualityHealthContext";
import QualityAttentionBanner from "@/components/quality/QualityAttentionBanner";

export type RestrictionLevel = "none" | "warning" | "soft_lock" | "hard_lock";

export interface RestrictionInfo {
  level: RestrictionLevel;
  daysElapsed: number;
  daysRemaining: number;
  status: string;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading, user, verticalConfig, isVerticalConfigLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { role, impersonating } = useRole();
  const tNavigation = useTranslations("navigation");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accessNotice, setAccessNotice] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPathnameRef = useRef(pathname);
  const [restriction, setRestriction] = useState<RestrictionInfo>({
    level: "none",
    daysElapsed: 0,
    daysRemaining: 7,
    status: "active",
  });
  const tourSteps = useProductTourSteps();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeMobileNavigation = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setMobileOpen(false);
    };
    closeMobileNavigation(desktop);
    desktop.addEventListener("change", closeMobileNavigation);
    return () => desktop.removeEventListener("change", closeMobileNavigation);
  }, []);

  useEffect(() => {
    if (isLoading || isVerticalConfigLoading || !isAuthenticated || !role) return;
    if (!pathname || !pathname.startsWith("/admin")) return;
    if (canAccessDashboardNavigationPath(pathname, role, impersonating, verticalConfig)) return;
    const landing = resolveAccessDeniedNavigation(pathname, role, impersonating, verticalConfig);
    if (pathname !== landing) {
      try { sessionStorage.setItem("navigation:access-denied", "1"); } catch { /* optional notice */ }
      router.replace(landing);
    }
  }, [pathname, role, impersonating, isLoading, isVerticalConfigLoading, isAuthenticated, router, verticalConfig]);

  useEffect(() => {
    if (isVerticalConfigLoading || !role || !canAccessDashboardNavigationPath(pathname, role, impersonating, verticalConfig)) return;
    let shouldShow = false;
    try {
      shouldShow = sessionStorage.getItem("navigation:access-denied") === "1";
      if (shouldShow) sessionStorage.removeItem("navigation:access-denied");
    } catch { /* storage can be unavailable in hardened browsers */ }
    if (!shouldShow) return;
    setAccessNotice(true);
    const timer = window.setTimeout(() => setAccessNotice(false), 6500);
    return () => window.clearTimeout(timer);
  }, [pathname, role, impersonating, isVerticalConfigLoading, verticalConfig]);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    const frame = window.requestAnimationFrame(() => {
      const target = mainRef.current?.querySelector<HTMLElement>("h1") ?? mainRef.current;
      if (!target) return;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    // While impersonating, the session carries the tenant's role — but an
    // operator must still be able to work on a suspended tenant, which is
    // exactly when support is needed.
    if (!user?.tenantId || user.role === "super_admin" || impersonating) return;

    async function checkRestriction() {
      try {
        const result = await api.getRestrictionStatus(user!.tenantId!);
        if (result.success && result.data) {
          setRestriction(result.data as RestrictionInfo);
        }
      } catch {
        // Don't block access on network errors
      }
    }

    checkRestriction();
  }, [impersonating, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
        <div className="text-center">
          <div className="w-10 h-10 border-[3px] border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Cargando...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (restriction.level === "hard_lock" && !impersonating) {
    const isBillingPage = pathname === "/admin/settings/billing";
    if (!isBillingPage) {
      return <SuspendedScreen restriction={restriction} />;
    }
  }

  const content = (
    <TenantProvider>
      <QualityHealthProvider>
      <NavigationPageProvider>
      <div className="flex h-screen bg-white dark:bg-neutral-950">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
        >
          {tNavigation("skipToContent")}
        </a>
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <MaintenanceBanner />
          <ImpersonationBanner />
          <TopBar onMobileMenuToggle={() => setMobileOpen(true)} />
          <TrialCountdownBanner restriction={restriction} />
          <EmailVerificationBanner />
          <FiscalBanner />
          <QualityAttentionBanner />
          <div className="flex-1 flex overflow-hidden">
            <main id="main-content" ref={mainRef} tabIndex={-1} className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
          </div>
        </div>
      </div>
      {accessNotice && (
        <div
          role="alert"
          className="fixed right-4 top-4 z-[100] flex max-w-sm items-start gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-neutral-700 shadow-xl dark:border-amber-900/70 dark:bg-neutral-950 dark:text-neutral-200"
        >
          <ShieldAlert className="mt-0.5 shrink-0 text-amber-500" size={18} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{tNavigation("accessDeniedTitle")}</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{tNavigation("accessDeniedDescription")}</p>
          </div>
          <button
            type="button"
            onClick={() => setAccessNotice(false)}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label={tNavigation("dismiss")}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <InstallPrompt />
      <OfflineIndicator />
      <NavigationCommandPalette />
      <HelpAssistant />
      </NavigationPageProvider>
      </QualityHealthProvider>
    </TenantProvider>
  );

  // Tour guiado (Onborda) envolviendo el contenido. TourBoundary aísla fallas:
  // si Onborda rompe en render, cae a `content` sin tour (no white-screen).
  return (
    <TourBoundary fallback={content}>
      <OnbordaProvider>
        <Onborda steps={tourSteps} cardComponent={TourCard} shadowRgb="0,0,0" shadowOpacity="0.5">
          {content}
          <TourLauncher />
        </Onborda>
      </OnbordaProvider>
    </TourBoundary>
  );
}
