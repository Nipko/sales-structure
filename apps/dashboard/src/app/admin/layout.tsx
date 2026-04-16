"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import AppSidebar from "@/components/layout/AppSidebar";
import TopBar from "@/components/layout/TopBar";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { useAuth } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Setup wizard is full-page — no sidebar/topbar
  const isSetupWizard = pathname === "/admin/setup-wizard";

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

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

  // Setup wizard renders without sidebar/topbar
  if (isSetupWizard) {
    return <TenantProvider>{children}</TenantProvider>;
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
          <div className="flex-1 flex overflow-hidden">
            <main className="flex-1 overflow-auto p-6">{children}</main>
            <OnboardingChecklist />
          </div>
        </div>
      </div>
    </TenantProvider>
  );
}
