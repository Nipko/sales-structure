import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

/**
 * Hook for fetching API data with loading/error states and mock fallback.
 * 
 * Usage:
 *   const { data, loading, error, refetch } = useApiData(
 *     () => api.getKanban("tenant-id"),
 *     mockData  // optional fallback
 *   );
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

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetcher();
            if (result.success && result.data !== undefined) {
                setData(result.data as T);
                setIsLive(true);
            } else {
                // API failed → use fallback
                if (fallback) {
                    setData(fallback);
                    setIsLive(false);
                } else {
                    setError(result.error || "Error al cargar datos");
                }
            }
        } catch {
            if (fallback) {
                setData(fallback);
                setIsLive(false);
            } else {
                setError("Error de conexión");
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

