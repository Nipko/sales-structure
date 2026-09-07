"use client";
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { OperationalNoticeWorkspace } from '@/components/operational-notices/OperationalNoticeWorkspace';
function Workspace(){
    const t=useTranslations('operationalNotices'),{user}=useAuth(),{activeTenantId,isLoading}=useTenant(),query=useSearchParams();
    if(isLoading)return <p role="status">{t('loading')}</p>;
    if(!activeTenantId)return <p>{t('tenantRequired')}</p>;
    const conversationId=query.get('conversationId')||undefined;
    return <OperationalNoticeWorkspace key={`${activeTenantId}:${conversationId||''}`} tenantId={activeTenantId} role={user?.role} conversationId={conversationId}/>;
}
export default function Page(){return <Suspense><Workspace/></Suspense>;}
