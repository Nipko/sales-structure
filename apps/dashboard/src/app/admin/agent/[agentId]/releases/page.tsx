'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { isSupervisor } from '@/lib/roles';
import { AgentReleaseWorkspace } from '@/components/quality/AgentReleaseWorkspace';

export default function AgentReleasesPage() {
    const { agentId } = useParams<{ agentId: string }>();
    const { activeTenantId } = useTenant(), { user } = useAuth();
    const t = useTranslations('agentReleases');
    if (!isSupervisor(user?.role)) return <p className="p-6">{t('accessRequired')}</p>;
    if (!activeTenantId) return <p className="p-6">{t('selectTenant')}</p>;
    return <AgentReleaseWorkspace key={`${activeTenantId}:${agentId}`} tenantId={activeTenantId} agentId={agentId} role={user?.role} />;
}
