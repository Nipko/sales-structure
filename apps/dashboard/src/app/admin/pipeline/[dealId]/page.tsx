"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ArrowLeft, DollarSign, User, Clock, Calendar, Tag,
    FileText, TrendingUp, MessageSquare, Loader2,
} from "lucide-react";

const KNOWN_STAGE_KEYS = ['nuevo','contactado','respondio','calificado','tibio','caliente','listo_cierre','ganado','perdido','no_interesado'];
const formatCurrency = (n: number) => `$${n.toLocaleString()}`;

export default function DealDetailPage() {
    const t = useTranslations("pipeline");
    const tc = useTranslations("common");
    const params = useParams();
    const router = useRouter();
    const { activeTenantId } = useTenant();
    const dealId = params.dealId as string;

    const [detail, setDetail] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!activeTenantId || !dealId) return;
        (async () => {
            setLoading(true);
            const res = await api.fetch(`/pipeline/deals/${activeTenantId}/${dealId}`);
            if (res?.success) setDetail(res.data);
            setLoading(false);
        })();
    }, [activeTenantId, dealId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 size={28} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="text-center py-16 text-muted-foreground">
                <p>{t("dealNotFound")}</p>
                <button
                    onClick={() => router.push("/admin/pipeline")}
                    className="mt-3 text-sm text-indigo-500 hover:underline cursor-pointer"
                >
                    {t("backToPipeline")}
                </button>
            </div>
        );
    }

    const deal = detail.deal;
    const stageHistory = detail.stageHistory || [];
    const lead = detail.lead;
    const opp = detail.opportunity;

    const stageName = KNOWN_STAGE_KEYS.includes(deal.stageId)
        ? tc(`stages.${deal.stageId}`)
        : deal.stageName || deal.stageId;

    return (
        <div>
            <button
                onClick={() => router.push("/admin/pipeline")}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 cursor-pointer transition-colors"
            >
                <ArrowLeft size={16} /> {t("backToPipeline")}
            </button>

            <PageHeader
                title={deal.title}
                subtitle={`${deal.contactName || ""} — ${stageName}`}
                icon={TrendingUp}
            />

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="p-4 rounded-xl bg-card border border-border">
                    <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.value")}</div>
                    <div className="text-xl font-semibold text-emerald-500">{formatCurrency(deal.value || 0)}</div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-border">
                    <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.probability")}</div>
                    <div className="text-xl font-semibold">{deal.probability ?? 0}%</div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-border">
                    <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.daysInStage")}</div>
                    <div className={cn("text-xl font-semibold", (deal.daysInStage || 0) > 5 ? "text-red-500" : "")}>
                        {deal.daysInStage ?? 0}d
                    </div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-border">
                    <div className="text-xs text-muted-foreground font-semibold mb-1">{t("dealDetail.score")}</div>
                    <div className="text-xl font-semibold">{deal.score ?? "—"}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Deal Info */}
                <div className="p-5 rounded-xl bg-card border border-border">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <FileText size={16} className="text-muted-foreground" /> {t("dealDetail.info")}
                    </h3>
                    <div className="space-y-2.5 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("dealDetail.stage")}</span>
                            <span className="font-medium">{stageName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t("dealDetail.status")}</span>
                            <span className="font-medium">{deal.status}</span>
                        </div>
                        {deal.expectedCloseDate && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("dealDetail.closeDate")}</span>
                                <span className="font-medium">{new Date(deal.expectedCloseDate).toLocaleDateString()}</span>
                            </div>
                        )}
                        {deal.notes && (
                            <div className="pt-2 border-t border-border">
                                <span className="text-muted-foreground text-xs">{t("dealForm.notes")}</span>
                                <p className="mt-1 text-foreground">{deal.notes}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Contact / Lead Info */}
                <div className="p-5 rounded-xl bg-card border border-border">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <User size={16} className="text-muted-foreground" /> {t("dealDetail.contact")}
                    </h3>
                    <div className="space-y-2.5 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{tc("name")}</span>
                            <span className="font-medium">{deal.contactName || lead?.first_name ? `${lead?.first_name || ""} ${lead?.last_name || ""}`.trim() : "—"}</span>
                        </div>
                        {(deal.contactPhone || lead?.phone) && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{tc("phone")}</span>
                                <span className="font-medium">{deal.contactPhone || lead?.phone}</span>
                            </div>
                        )}
                        {lead?.email && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{tc("email")}</span>
                                <span className="font-medium">{lead.email}</span>
                            </div>
                        )}
                        {lead?.lead_score != null && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("dealDetail.leadScore")}</span>
                                <span className="font-medium">★ {lead.lead_score}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Stage History */}
            {stageHistory.length > 0 && (
                <div className="mt-5 p-5 rounded-xl bg-card border border-border">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Clock size={16} className="text-muted-foreground" /> {t("dealDetail.history")}
                    </h3>
                    <div className="space-y-3">
                        {stageHistory.map((h: any) => {
                            const from = KNOWN_STAGE_KEYS.includes(h.fromStage) ? tc(`stages.${h.fromStage}`) : h.fromStage;
                            const to = KNOWN_STAGE_KEYS.includes(h.toStage) ? tc(`stages.${h.toStage}`) : h.toStage;
                            return (
                                <div key={h.id} className="flex items-center gap-3 text-sm">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                                    <div className="flex-1">
                                        <span className="text-muted-foreground">{from}</span>
                                        <span className="mx-1.5">→</span>
                                        <span className="font-medium">{to}</span>
                                        {h.reason && <span className="text-muted-foreground ml-2">({h.reason})</span>}
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {new Date(h.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
