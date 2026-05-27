'use client';

import { useTranslations } from 'next-intl';

interface Viewer {
    agentId: string;
    agentName: string;
}

export function ViewersIndicator({ viewers, currentAgentId }: { viewers: Viewer[]; currentAgentId: string }) {
    const t = useTranslations('inbox');
    const others = viewers.filter(v => v.agentId !== currentAgentId);
    if (others.length === 0) return null;

    return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-xs text-amber-700 dark:text-amber-300">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            {others.length === 1
                ? t('viewerSingle', { name: others[0].agentName })
                : t('viewerMultiple', { count: others.length })}
        </div>
    );
}
