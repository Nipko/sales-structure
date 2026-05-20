"use client";

import { useState, useEffect } from "react";
import AppSidebar from "@/components/layout/AppSidebar";
import TopBar from "@/components/layout/TopBar";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import TrialCountdownBanner from "@/components/TrialCountdownBanner";
import SuspendedScreen from "@/components/SuspendedScreen";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { TenantProvider } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useRouter, usePathname } from "next/navigation";
import { canAccessPath, defaultLandingForRole } from "@/lib/roles";

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
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { role, impersonating } = useRole();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [restriction, setRestriction] = useState<RestrictionInfo>({
    level: "none",
    daysElapsed: 0,
    daysRemaining: 7,
    status: "active",
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !role) return;
    if (!pathname || !pathname.startsWith("/admin")) return;
    if (canAccessPath(pathname, role, impersonating)) return;
    const landing = defaultLandingForRole(role, impersonating);
    if (pathname !== landing) router.replace(landing);
  }, [pathname, role, impersonating, isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!user?.tenantId || user.role === "super_admin") return;

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
  }, [user]);

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

  if (restriction.level === "hard_lock") {
    const isBillingPage = pathname === "/admin/settings/billing";
    if (!isBillingPage) {
      return <SuspendedScreen restriction={restriction} />;
    }
  }

  return (
    <TenantProvider>
      <div className="flex h-screen bg-white dark:bg-neutral-950">
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <MaintenanceBanner />
          <ImpersonationBanner />
          <TopBar onMobileMenuToggle={() => setMobileOpen(true)} />
          <TrialCountdownBanner restriction={restriction} />
          <div className="flex-1 flex overflow-hidden">
            <main className="flex-1 overflow-auto p-6">{children}</main>
            <OnboardingChecklist />
          </div>
        </div>
      </div>
      <InstallPrompt />
      <OfflineIndicator />
    </TenantProvider>
  );
}
