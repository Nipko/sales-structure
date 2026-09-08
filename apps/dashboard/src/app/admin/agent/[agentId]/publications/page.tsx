'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { isAdmin } from '@/lib/roles';
import { AgentPublicationWorkspace } from '@/components/quality/AgentPublicationWorkspace';

export default function AgentPublicationsPage() {
    const { agentId } = useParams<{ agentId: string }>();
    const { activeTenantId } = useTenant();
    const { user } = useAuth();
    const t = useTranslations('agentPublications');
    // Publication is what customers get. The API allows a supervisor to read
    // the history, but the whole point of this screen is the decision, and the
    // agent area is administrator territory.
    if (!isAdmin(user?.role)) return <p className="p-6 text-sm text-muted-foreground">{t('accessRequired')}</p>;
    if (!activeTenantId) return <p className="p-6 text-sm text-muted-foreground">{t('selectTenant')}</p>;
    return <AgentPublicationWorkspace key={`${activeTenantId}:${agentId}`} tenantId={activeTenantId} agentId={agentId} role={user?.role} />;
}
