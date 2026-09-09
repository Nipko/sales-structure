"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChannelCertificationMatrix,
    type ChannelCertificationSummary, type ChannelRow } from "@/components/channels/ChannelCertificationMatrix";

/**
 * What each channel can actually be said to do.
 *
 * The API has computed this since `cb310c0e` and nothing ever asked for it: the
 * endpoint had no client in the dashboard or the mobile app, so the only way to
 * read the matrix was curl. A number nobody can see is a number nobody checks,
 * which is how `complete` came to count a channel whose capabilities were merely
 * declared.
 *
 * The page fetches; the matrix renders. A failed read shows as a failed read —
 * an empty table would claim every channel has nothing, which is a different and
 * false statement.
 */
export default function ChannelCertificationPage() {
    const t = useTranslations("channelCertification");
    const [rows, setRows] = useState<ChannelRow[] | null>(null);
    const [summary, setSummary] = useState<ChannelCertificationSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await api.getChannelCertification();
        if (!result?.success || !result?.data) {
            setRows(null);
            setSummary(null);
            setError(t("unreadable"));
        } else {
            setRows(result.data.channels ?? []);
            setSummary(result.data.summary ?? null);
        }
        setLoading(false);
    }, [t]);

    useEffect(() => { void load(); }, [load]);

    return (
        <div className="space-y-6 p-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl text-foreground">{t("title")}</h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
                    {t("refresh")}
                </button>
            </header>

            {error && (
                <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}

            {rows && <ChannelCertificationMatrix rows={rows} summary={summary} />}
        </div>
    );
}
