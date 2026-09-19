"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAgentToolConfiguration } from '@/contexts/AgentToolConfigurationContext';
import { useTenant } from '@/contexts/TenantContext';
import { useAgentReviewMode } from '@/hooks/useAgentReviewMode';
import { useRole } from '@/hooks/useRole';
import { agentReviewModeCopyKey, withinNamespace } from '@/lib/agent-review-mode';
import { agentToolFamiliesForRoute, agentToolModuleState } from '@/lib/agent-tool-navigation';

export function AgentToolNavigationStatus({ href, descriptionId }: { href: string; descriptionId?: string }) {
  const t = useTranslations('agentToolNavigation');
  const { summary, loading } = useAgentToolConfiguration();
  const families = agentToolFamiliesForRoute(href);
  if (!families.length) return null;
  const state = loading ? 'loading' : agentToolModuleState(summary, families);
  // When nested in a link, announce this through aria-describedby instead of
  // changing the link's accessible name whenever configuration is refreshed.
  return <span id={descriptionId} aria-hidden={descriptionId ? true : undefined} className="block truncate text-[10px] font-normal text-neutral-500 dark:text-neutral-400">{t(`status.${state}`)}</span>;
}

/**
 * The "how it works" line used to say "save the draft and complete its
 * publication" to every tenant, while the default mode applies a save at once.
 * The mode is read only when someone opens "Cómo funciona": this notice sits on
 * every module page, and a request per page view for a folded sentence is not
 * worth it. Until then, and for roles that cannot read the mode, the sentence
 * is one that is true in both modes.
 */
export function AgentToolModuleNotice() {
  const pathname = usePathname();
  const { activeTenantId } = useTenant();
  const { canAccess } = useRole();
  const { summary, loading, refresh } = useAgentToolConfiguration();
  const t = useTranslations('agentToolNavigation');
  const [scopeOpen, setScopeOpen] = useState(false);
  const canReadMode = canAccess('/admin/agent');
  const reviewMode = useAgentReviewMode(activeTenantId, scopeOpen && canReadMode);
  const families = agentToolFamiliesForRoute(pathname);
  if (!activeTenantId || !families.length || !canAccess(pathname)) return null;
  const state = loading ? 'loading' : agentToolModuleState(summary, families);
  return <aside aria-label={t('title')} className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium">{t('title')}: {t(`status.${state}`)}</p>
      <div className="flex flex-wrap items-center gap-3">
        {canAccess('/admin/agent') && <Link className="underline" href="/admin/agent">{t('manage')}</Link>}
        <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-8 rounded px-2 underline disabled:opacity-50">{t('refresh')}</button>
      </div>
    </div>
    <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{t(`description.${state}`)}</p>
    <details className="mt-2 text-xs text-neutral-600 dark:text-neutral-300"
      onToggle={(event) => setScopeOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">{t('scopeTitle')}</summary>
      <p className="mt-1">{t('manualScope')}</p>
      <p className="mt-1">{t('runtimeScope')}</p>
      <p className="mt-1" data-review-mode={reviewMode}>{t(withinNamespace(agentReviewModeCopyKey('toolModuleScope', reviewMode), 'agentToolNavigation'))}</p>
    </details>
  </aside>;
}
