"use client";

import { useState, useEffect } from "react";
// Setup wizard renders as a modal overlay on the dashboard
import AppSidebar from "@/components/layout/AppSidebar";
import TopBar from "@/components/layout/TopBar";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import TrialCountdownBanner from "@/components/TrialCountdownBanner";
import SuspendedScreen from "@/components/SuspendedScreen";
import { useAuth } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);

  // Setup wizard renders as modal overlay on top of dashboard

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // Check if tenant account is suspended
  useEffect(() => {
    if (!user?.tenantId || user.role === "super_admin") return;

    async function checkSuspension() {
      try {
        const result = await api.getOffboardingStatus(user!.tenantId!);
        if (result.success && result.data) {
          const { subscriptionStatus, currentPeriodEnd } = result.data;
          const isExpiredOrCancelled =
            subscriptionStatus === "expired" || subscriptionStatus === "cancelled";
          const periodEnded = currentPeriodEnd
            ? new Date(currentPeriodEnd) < new Date()
            : true;
          setIsSuspended(isExpiredOrCancelled && periodEnded);
        }
      } catch {
        // Silently fail — don't block access on network errors
      }
    }

    checkSuspension();
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

  if (isSuspended) {
    return <SuspendedScreen />;
  }

  return (
    <TenantProvider>
      <div className="flex h-screen bg-white dark:bg-neutral-950">
        <AppSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar onMobileMenuToggle={() => setMobileOpen(true)} />
          <TrialCountdownBanner />
          <div className="flex-1 flex overflow-hidden">
            <main className="flex-1 overflow-auto p-6">{children}</main>
            <OnboardingChecklist />
          </div>
        </div>
      </div>
    </TenantProvider>
  );
}
