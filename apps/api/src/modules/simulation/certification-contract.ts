import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { LLM_MODEL_CATALOGUE } from '../ai/router/llm-router.service';
import type { CertificationSubject } from './certification-ledger';

/**
 * The boundary of the certification executor: who may operate it, what a request
 * may contain, and which of its two runners is being asked for.
 *
 * It exists as its own file for the reason the release contract does — the
 * guards have to be readable next to each other rather than scattered through a
 * service — and because one of them is not a convention but a spending control:
 * a live run costs money, so asking for one is a different request from asking
 * for a rehearsal, and the difference is typed rather than a boolean somebody
 * can forget to check.
 */

export const CERTIFICATION_QUEUE = 'agent-certification';
export const CERTIFICATION_TABLES = Object.freeze([
    'agent_certification_runs', 'agent_certification_subjects', 'agent_certification_cases',
]);

export const CERTIFICATION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/**
 * How a case is executed.
 *
 *  · `dry_run` — no provider is contacted and nothing is billed. It exercises
 *    the entire path from the entrypoint to the ledger so the wiring can be
 *    proven before anybody is asked for a credential;
 *  · `live` — the real agent runtime against a real model. Refused unless the
 *    caller says so explicitly AND a budget is set, because "I forgot to pass
 *    the flag" must never be the reason a catalogue run starts spending.
 */
export const CERTIFICATION_MODES = ['dry_run', 'live'] as const;
export type CertificationMode = (typeof CERTIFICATION_MODES)[number];

export interface CertificationActor { id: string; role: string }

export interface PlanCertificationRequest {
    /** Idempotency: the same key returns the same run instead of planning a second. */
    requestKey: string;
    mode: CertificationMode;
    profiles?: string[];
    languages?: string[];
    channels: string[];
    models: string[];
    k?: number;
    budgetUsdCents?: number;
    deadlineAt?: string | null;
    /** Required when the plan covers more than one profile. */
    subjects?: Record<string, CertificationSubject>;
    /** The default subject, for a single-profile plan. */
    agentId?: string;
    configHash?: string;
    dependencyRevision?: string;
}

/**
 * Operating a certification run is a platform action, not a tenant one: it
 * spends a shared budget and it produces the evidence the product's claims rest
 * on. Reading is wider than writing, as everywhere else here.
 */
export function assertCertificationActor(actor: CertificationActor, write = true): void {
    const allowed = write ? ['super_admin'] : ['super_admin', 'tenant_admin'];
    if (!actor || !CERTIFICATION_UUID.test(actor.id ?? '') || !allowed.includes(actor.role)) {
        throw new ForbiddenException({ error: 'certification_role_required' });
    }
}

export function assertCertificationId(...ids: string[]): void {
    if (ids.some(id => typeof id !== 'string' || !CERTIFICATION_UUID.test(id))) {
        throw new BadRequestException({ error: 'certification_scope_invalid' });
    }
}

export function assertCertificationRequestKey(value: string): void {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
        throw new BadRequestException({ error: 'certification_request_invalid' });
    }
}

/**
 * Validates the request and returns it normalised, or refuses with the exact
 * reason. Nothing here is a warning: a plan built from an unchecked body is a
 * plan that spends money on the wrong thing.
 */
export function assertPlanCertificationRequest(body: PlanCertificationRequest): PlanCertificationRequest {
    assertCertificationRequestKey(body?.requestKey);
    if (!CERTIFICATION_MODES.includes(body?.mode as CertificationMode)) {
        throw new BadRequestException({ error: 'certification_mode_required', modes: CERTIFICATION_MODES });
    }
    const canonical = listCanonicalSubtypeExperienceProfileIds();
    const profiles = body.profiles?.length ? [...new Set(body.profiles)] : canonical;
    const unknownProfiles = profiles.filter(profile => !canonical.includes(profile));
    if (unknownProfiles.length) {
        throw new BadRequestException({ error: 'certification_profile_unknown', profiles: unknownProfiles.sort() });
    }
    const channels = [...new Set(body.channels ?? [])];
    if (!channels.length || channels.some(channel => !(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel))) {
        throw new BadRequestException({ error: 'certification_channel_invalid' });
    }
    const languages = body.languages?.length ? [...new Set(body.languages)] : [...EVAL_LANGUAGES];
    if (languages.some(language => !(EVAL_LANGUAGES as readonly string[]).includes(language))) {
        throw new BadRequestException({ error: 'certification_language_invalid' });
    }
    const catalogue = new Set(LLM_MODEL_CATALOGUE.map(model => model.id));
    const models = [...new Set(body.models ?? [])];
    if (!models.length || models.some(model => !catalogue.has(model))) {
        throw new BadRequestException({ error: 'certification_model_unknown' });
    }
    // A live run without a ceiling is a blank cheque. The dry run has nothing to
    // cap, so it is not asked for one.
    if (body.mode === 'live' && !(Number(body.budgetUsdCents) > 0)) {
        throw new BadRequestException({ error: 'certification_budget_required' });
    }
    // Every profile needs a subject once there is more than one, and the ledger
    // refuses otherwise; saying so here turns a thrown error into a 400 that
    // names the profiles.
    if (profiles.length > 1) {
        const named = new Set(Object.keys(body.subjects ?? {}));
        const missing = profiles.filter(profile => !named.has(profile));
        if (missing.length) {
            throw new BadRequestException({ error: 'certification_subject_required', profiles: missing.sort() });
        }
    }
    for (const [profile, subject] of Object.entries(body.subjects ?? {})) {
        if (!subject || !CERTIFICATION_UUID.test(subject.agentId ?? '')
            || typeof subject.configHash !== 'string' || !subject.configHash
            || typeof subject.dependencyRevision !== 'string' || !subject.dependencyRevision) {
            throw new BadRequestException({ error: 'certification_subject_invalid', profile });
        }
    }
    return { ...body, profiles, languages, channels, models };
}
