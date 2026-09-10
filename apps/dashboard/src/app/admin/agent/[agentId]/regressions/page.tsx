"use client";
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { isSupervisor } from '@/lib/roles';
import { RegressionWorkspace } from '@/components/quality/RegressionWorkspace';
export default function AgentRegressionsPage(){
    const {agentId}=useParams<{agentId:string}>(),{activeTenantId}=useTenant(),{user}=useAuth(),t=useTranslations('qualityRegressions');
    if(!isSupervisor(user?.role))return <p className="p-6">{t('accessRequired')}</p>;
    if(!activeTenantId)return <p className="p-6">{t('selectTenant')}</p>;
    return <RegressionWorkspace key={`${activeTenantId}:${agentId}`} tenantId={activeTenantId} agentId={agentId}/>;
}
