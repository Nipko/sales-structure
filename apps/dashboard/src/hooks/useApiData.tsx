import { useState, useEffect, useCallback, useRef } from "react";
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
 * Returns a badge indicating if data is live or demo.
 */
export function DataSourceBadge({ isLive }: { isLive: boolean }) {
    return (
        <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 600,
            background: isLive ? "rgba(46, 204, 113, 0.15)" : "rgba(241, 196, 15, 0.15)",
            color: isLive ? "#2ecc71" : "#f1c40f",
        }}>
            {isLive ? "● LIVE" : "● DEMO"}
        </span>
    );
}

