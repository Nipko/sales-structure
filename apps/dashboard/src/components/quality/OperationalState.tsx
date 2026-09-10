"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, ClipboardCheck, FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AGENT_OPERATIONAL_STATES, type AgentOperationalState } from '@parallext/shared';
import { cn } from '@/lib/utils';

/**
 * The other half of the shared vocabulary.
 *
 * `packages/shared/src/agent-operational-state.ts` decides the six words and the
 * server computes them; this file decides how they look, once. The moment a
 * second component writes its own `switch` over the state, "desconocido" starts
 * reading as "pendiente" on one screen and as a failure on the next — which is
 * the drift the shared vocabulary exists to end.
 *
 * The icon and the word carry the state; the tone only reinforces it. A
 * completion review flagged status expressed only through Tailwind classes, so
 * the six are told apart in greyscale — question mark, dashed circle,
 * clipboard, flask, tick, warning triangle — and the word is always spelled out
 * beside the icon rather than implied by it.
 */
const PRESENTATION: Readonly<Record<AgentOperationalState, { icon: typeof CheckCircle2; tone: string }>> = Object.freeze({
    // Violet and a question mark, never grey: grey is how a screen says "you did
    // not do this yet", and "nobody could read it" is a different answer with a
    // different thing to do about it.
    unknown: { icon: CircleHelp, tone: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300' },
    pending: { icon: CircleDashed, tone: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
    prepared: { icon: ClipboardCheck, tone: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300' },
    tested: { icon: FlaskConical, tone: 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300' },
    operating: { icon: CheckCircle2, tone: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' },
    degraded: { icon: AlertTriangle, tone: 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' },
});

/** The states actually on screen, deduplicated and in the ladder's order. */
export function operationalStatesPresent(states: readonly (AgentOperationalState | null | undefined)[]): AgentOperationalState[] {
    return AGENT_OPERATIONAL_STATES.filter(state => states.includes(state));
}

/** One state, said in words. The tone is decoration; the label is the answer. */
export function OperationalStateBadge({ state, size = 'sm', className }: { state: AgentOperationalState; size?: 'sm' | 'lg'; className?: string }) {
    const t = useTranslations('agentOperationalState');
    const { icon: Icon, tone } = PRESENTATION[state];
    return <span className={cn('inline-flex items-center gap-1.5 rounded-full border font-semibold', tone,
        size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs', className)}>
        <Icon size={size === 'lg' ? 16 : 13} aria-hidden="true" />
        {/* Read out as "Estado: Preparado": on its own the word is a chip with no
            subject, and the rows it sits in are already dense. */}
        <span className="sr-only">{`${t('srPrefix')} `}</span>{t(`states.${state}.label`)}
    </span>;
}

/**
 * What the words on this screen mean, for the states that are on it.
 *
 * Six badges with no definitions is a legend a tenant has to guess at, and
 * guessing is how "probado" and "operativo" collapse into "green". Only the
 * states present are listed: a definition for a state nothing is in is noise.
 */
export function OperationalStateLegend({ states, className }: { states: readonly (AgentOperationalState | null | undefined)[]; className?: string }) {
    const t = useTranslations('agentOperationalState');
    const present = operationalStatesPresent(states);
    if (!present.length) return null;
    return <div className={className}>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('legendTitle')}</h4>
        <dl className="mt-2 space-y-1.5">{present.map(state => <div key={state} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt><OperationalStateBadge state={state} /></dt>
            <dd className="text-xs text-neutral-600 dark:text-neutral-400">{t(`states.${state}.meaning`)}</dd>
        </div>)}</dl>
    </div>;
}

/**
 * The agent as a whole, in the word the server rolled up.
 *
 * Shared by the assessment panel and the quality centre so that the two surfaces
 * cannot disagree: both render this from `assessment.state`, and neither of them
 * recomputes it from the parts.
 */
export function AgentOperationalStateSummary({ state, className }: { state: AgentOperationalState; className?: string }) {
    const t = useTranslations('agentOperationalState');
    return <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
        <OperationalStateBadge state={state} size="lg" />
        <p className="text-sm">{t(`agent.${state}`)}</p>
    </div>;
}
