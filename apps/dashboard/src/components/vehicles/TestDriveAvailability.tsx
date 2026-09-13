"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { SkeletonTable } from "@/components/ui/skeleton-loader";

export type TestDriveLoadState<T = unknown> =
    | { status: "idle" | "loading" | "failed" }
    | { status: "ready"; items: T[] };

/** Only a successful array response establishes that there are no bookings. */
export async function requestTestDrives<T>(
    request: () => Promise<{ success: boolean; data?: unknown }>,
    update: (state: TestDriveLoadState<T>) => void,
): Promise<void> {
    update({ status: "loading" });
    try {
        const response = await request();
        update(response.success && Array.isArray(response.data)
            ? { status: "ready", items: response.data as T[] }
            : { status: "failed" });
    } catch {
        update({ status: "failed" });
    }
}

export function TestDriveAvailability({ state, retry, children }: {
    state: TestDriveLoadState; retry: () => Promise<void>; children?: ReactNode;
}) {
    const t = useTranslations("vehicles");
    const tc = useTranslations("common");
    if (state.status === "idle" || state.status === "loading") return <div role="status" aria-label={tc("loading")} aria-busy="true">
        <SkeletonTable rows={5} cols={5} />
    </div>;
    if (state.status === "failed") return <div role="alert" className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-8 text-center">
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{t("testDrives.loadError")}</p>
        <button type="button" onClick={retry} className="px-4 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
            {t("retry")}
        </button>
    </div>;
    if (state.status === "ready" && state.items.length === 0) return <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-12 text-center">
        <CalendarClock size={40} className="mx-auto text-neutral-400 dark:text-neutral-600 mb-3" />
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("testDrives.empty")}</p>
    </div>;
    return <>{children}</>;
}
