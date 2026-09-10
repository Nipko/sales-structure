"use client";

import { useParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import { isSupervisor } from "@/lib/roles";
import { LearningWorkspace } from "@/components/learning/LearningWorkspace";

export default function AgentLearningPage() {
    const { agentId } = useParams<{ agentId: string }>();
    const { activeTenantId } = useTenant();
    const { user } = useAuth();
    const t = useTranslations("agentLearning");
    if (!isSupervisor(user?.role)) return <p className="p-6">{t("accessRequired")}</p>;
    if (!activeTenantId) return <p className="p-6">{t("selectTenant")}</p>;
    return <LearningWorkspace key={`${activeTenantId}:${agentId}`} tenantId={activeTenantId} agentId={agentId} />;
}
