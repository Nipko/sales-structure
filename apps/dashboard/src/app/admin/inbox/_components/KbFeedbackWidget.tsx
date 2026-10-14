"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface KbFeedbackWidgetProps {
    tenantId: string;
    conversationId: string;
    messageId: string;
    documentId?: string;
}

export function KbFeedbackWidget({ tenantId, conversationId, messageId, documentId }: KbFeedbackWidgetProps) {
    const t = useTranslations("knowledgeGap");
    const [rating, setRating] = useState<"positive" | "negative" | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [unconfirmed, setUnconfirmed] = useState(false);
    const requestLocked = useRef(false);

    const handleFeedback = async (value: "positive" | "negative") => {
        if (requestLocked.current) return;
        requestLocked.current = true;
        setLoading(true);
        setRating(value);
        try {
            const result = await api.fetch(`/knowledge/${tenantId}/feedback`, {
                method: "POST",
                body: JSON.stringify({
                    conversationId,
                    messageId,
                    documentId,
                    rating: value === "positive" ? 5 : 1,
                    query: "",
                }),
            });
            if (result?.success !== true) throw new Error("feedback_not_confirmed");
            setSubmitted(true);
        } catch {
            setRating(null);
            setUnconfirmed(true);
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div role="status" className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
                <Check size={12} />
                <span>{t("thankYou")}</span>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-1">
            <button
                onClick={() => handleFeedback("positive")}
                disabled={loading || unconfirmed}
                className={cn(
                    "p-1 rounded border-none cursor-pointer transition-colors",
                    rating === "positive"
                        ? "bg-emerald-500/20 text-emerald-500"
                        : "bg-transparent text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
                )}
                title={t("helpful")}
                aria-label={t("helpful")}
            >
                <ThumbsUp size={12} />
            </button>
            <button
                onClick={() => handleFeedback("negative")}
                disabled={loading || unconfirmed}
                className={cn(
                    "p-1 rounded border-none cursor-pointer transition-colors",
                    rating === "negative"
                        ? "bg-red-500/20 text-red-500"
                        : "bg-transparent text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                )}
                title={t("notHelpful")}
                aria-label={t("notHelpful")}
            >
                <ThumbsDown size={12} />
            </button>
            {unconfirmed && <span role="alert" className="text-[11px] text-red-500">{t("feedbackError")}</span>}
        </div>
    );
}
