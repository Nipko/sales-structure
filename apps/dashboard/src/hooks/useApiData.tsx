import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

/**
 * Hook for fetching API data with loading/error states and mock fallback.
 *
 * isLive stays true once data is successfully loaded — it only goes
 * back to false if a fallback is used (mock data). This prevents the
 * badge from flipping to "DEMO" when the user sits on a page and the
 * session token refreshes or a background refetch temporarily fails.
 */
export function useApiData<T>(
    fetcher: () => Promise<{ success: boolean; data?: T; error?: string }>,
    fallback?: T,
    deps: any[] = [],
) {
    const [data, setData] = useState<T | null>(fallback || null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);
    const hasLoadedLive = useRef(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetcher();
            if (result.success && result.data !== undefined) {
                setData(result.data as T);
                setIsLive(true);
                hasLoadedLive.current = true;
            } else {
                // API failed → use fallback if available, but keep isLive if we had real data before
                if (fallback && !hasLoadedLive.current) {
                    setData(fallback);
                    setIsLive(false);
                } else if (!hasLoadedLive.current) {
                    setError(result.error || "Error loading data");
                }
                // If we previously loaded live data, keep showing it (stale is better than mock)
            }
        } catch {
            if (fallback && !hasLoadedLive.current) {
                setData(fallback);
                setIsLive(false);
            } else if (!hasLoadedLive.current) {
                setError("Connection error");
            }
        }
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { data, loading, error, isLive, refetch: fetchData };
}

/**
 * Where the numbers on this screen came from.
 *
 * This used to be a boolean whose false branch said "DEMO". No screen in this
 * dashboard has ever rendered demo data — `useApiData` above is the only thing
 * that can produce a mock fallback and it has no callers — so "DEMO" was never
 * describing the data. It was describing three different situations at once:
 * the read had not finished, the read failed, or nobody wired the flag up. In
 * all three the badge asserted a provenance that was simply not true, next to
 * figures the tenant was reading as their own account.
 *
 * So the state is named instead of inferred, and the false claim is gone:
 *
 * - `live` — a read came back and these are that account's numbers.
 * - `unavailable` — a read failed. What is on screen is not an answer.
 * - `unverified` — we have not confirmed the source; still loading, or the
 *   screen has no failure signal to give us. Never claims the data is fake.
 *
 * The dot is decorative, so the meaning is carried by an accessible label
 * rather than by the colour.
 */
export type DataSourceState = "live" | "unverified" | "unavailable";

/**
 * Tones that survive a light background.
 *
 * These were three saturated hexes picked against the dark theme — `#2ecc71` on
 * its own 15% wash comes out at 1.86:1, and the amber was worse. Read on a
 * laptop in daylight, the badge that says whether the numbers on the page are
 * real was the least readable thing on it.
 *
 * Tailwind pairs instead of fixed hexes, so each theme gets its own value: the
 * dark side keeps the bright tone it was designed for, and the light side gets
 * one dark enough to read.
 */
const BADGE_TONE: Record<DataSourceState, string> = {
    live: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    unverified: "bg-neutral-100 text-neutral-700 dark:bg-neutral-500/15 dark:text-neutral-300",
    unavailable: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

export function DataSourceBadge({ state }: { state: DataSourceState }) {
    const t = useTranslations("common");
    const label = t(`dataSource.${state}` as any);
    return (
        <span
            title={t(`dataSourceHint.${state}` as any)}
            aria-label={`${label}: ${t(`dataSourceHint.${state}` as any)}`}
            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${BADGE_TONE[state]}`}
        >
            <span aria-hidden="true">● </span>{label}
        </span>
    );
}

