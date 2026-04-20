"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { Lock } from "lucide-react";

/**
 * Wraps a page and hides it from non-super_admin users.
 *
 * - Redirects to /admin/settings after the user context loads.
 * - Renders nothing while the redirect is in flight to avoid flashing
 *   sensitive content (LLM keys, raw channel credentials, etc.).
 * - Falls back to a restricted-access card if the user lands on the
 *   page and hasn't redirected yet.
 */
export function SuperAdminGuard({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const router = useRouter();
    const t = useTranslations("settings.superAdminOnly");
    const isSuperAdmin = user?.role === "super_admin";

    useEffect(() => {
        if (user && !isSuperAdmin) {
            router.replace("/admin/settings");
        }
    }, [user, isSuperAdmin, router]);

    if (!user) return null;
    if (!isSuperAdmin) {
        return (
            <div className="max-w-2xl">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center">
                    <Lock size={32} className="mx-auto text-neutral-400 mb-3" />
                    <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                        {t("title")}
                    </h2>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        {t("description")}
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
