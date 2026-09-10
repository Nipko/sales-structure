import {
    buildDomainContractDraft, composeSubtypeEvalPack, listCanonicalSubtypeExperienceProfileIds,
    resolveSubtypeExperienceProfile,
} from '@parallext/shared';
import { EVAL_WRITER_SANDBOX_FAMILIES, type EvalWriterSandboxFamily } from '../conversations/agent-test-tool-policy';
import { staticToolsForAgentConfig } from '../conversations/agent-tool-registry';
import { isBusinessWriteTool } from '../conversations/tool-policy-registry';

/**
 * ═══ LA MATRIZ, CALCULADA EN VEZ DE TRANSCRITA ═══
 *
 * «76 perfiles, 268 tareas, 146 transaccionales, 32 sin positivo propio, 10 sin
 * verificador» vivía únicamente en la prosa de las auditorías, regenerada a mano
 * cada vez y sin nada que la comprobara. Un número así envejece en silencio: un
 * perfil nuevo, un intent renombrado o un verificador que pasa de pendiente a
 * auditado lo mueven sin que nadie se entere, y el documento sigue afirmando lo
 * de antes. Peor: el hueco se puede *contar* pero no *enumerar*, así que nadie
 * sabe cuál de las 32 tareas le falta el positivo.
 *
 * Esto lo deriva de las mismas fuentes que usa el runtime —los perfiles
 * canónicos, el contrato de dominio de cada uno, su pack de evaluación y el
 * registro de writers auditados—, de modo que la cifra sea una consecuencia y no
 * una afirmación, y los huecos salgan con nombre y apellido.
 *
 * No certifica nada por sí misma. Dice qué tiene cada tarea y qué le falta;
 * ejecutar los escenarios contra un modelo por idioma y canal sigue siendo otra
 * cosa, y ningún perfil hereda certificación por parecerse a otro.
 */

/** Cómo se llama el escenario que cubre positivamente una tarea. */
const POSITIVE_VARIANTS = ['happy_path', 'canonical_complete'] as const;
/** Y los que la cubren por el lado negativo: lo que NO debe pasar. */
const NEGATIVE_VARIANTS = [
    'missing_slot', 'unconfirmed', 'tool_failed', 'repeat_request',
    'canonical_repeat', 'canonical_handoff', 'canonical_recovery', 'canonical_cancel',
    'canonical_correction', 'canonical_reschedule', 'canonical_update',
    'canonical_foreign_pet', 'canonical_missing_species', 'canonical_question',
] as const;

export type TaskVerifierStatus = EvalWriterSandboxFamily['status'] | 'none' | 'not_transactional';

export interface TaskCertificationRow {
    readonly profileId: string;
    readonly taskKey: string;
    /** True when completing it commits the business, as its contract declares. */
    readonly transactional: boolean;
    /** Tool families this profile must have enabled for the task to exist at all. */
    readonly capabilities: readonly string[];
    /** The slots the task cannot proceed without. */
    readonly requiredData: readonly string[];
    /** Every tool the plan may need, in order — the dependencies of the task. */
    readonly dependencies: readonly string[];
    /** The writer(s) that actually commit it. Empty for a read-only task. */
    readonly commands: readonly string[];
    /**
     * `audited` only when a family in the eval writer registry owns one of this
     * task's commands and is executable through the isolated adapter.
     */
    readonly verifier: TaskVerifierStatus;
    readonly verifierFamily: string | null;
    readonly hasOwnPositive: boolean;
    readonly hasOwnNegative: boolean;
}

export interface TaskCertificationSummary {
    readonly profiles: number;
    readonly tasks: number;
    readonly transactional: number;
    readonly withoutOwnPositive: readonly string[];
    readonly withoutOwnNegative: readonly string[];
    readonly withoutVerifier: readonly string[];
    /**
     * Tasks that will never have an effect verifier, because they are not meant
     * to reach a domain writer at all: `file_claim` exists in an evaluation only
     * to prove the identity step-up refuses it, and it never sends an OTP from a
     * run. Counting those as a gap would ask for a verifier for something whose
     * whole contract is that nothing gets written.
     */
    readonly deliberatelyUnverifiable: readonly string[];
    /** Zero until scenarios are executed per model, language and channel. */
    readonly certifiedProfiles: number;
}

/** command -> the tool families that publish it. Computed once, not per task. */
function commandFamilies(): Map<string, string[]> {
    const families = new Set<string>();
    for (const profileId of listCanonicalSubtypeExperienceProfileIds()) {
        const [industry, subtype] = profileId.split('/');
        for (const group of resolveSubtypeExperienceProfile(industry, subtype).capability.toolGroups) {
            families.add(String(group));
        }
    }
    const map = new Map<string, string[]>();
    for (const family of families) {
        for (const tool of staticToolsForAgentConfig({ [family]: { enabled: true } })) {
            const name = String((tool as any).name);
            map.set(name, [...(map.get(name) ?? []), family]);
        }
    }
    return map;
}

function familyFor(command: string): { key: string; family: EvalWriterSandboxFamily } | null {
    for (const [key, family] of Object.entries(EVAL_WRITER_SANDBOX_FAMILIES)) {
        if (family.tools.includes(command)) return { key, family };
    }
    return null;
}

/** One row per profile and task. Pure: no database, no network, no clock. */
export function buildTaskCertificationMatrix(): readonly TaskCertificationRow[] {
    const published = commandFamilies();
    const rows: TaskCertificationRow[] = [];

    for (const profileId of listCanonicalSubtypeExperienceProfileIds()) {
        const [industry, subtype] = profileId.split('/');
        const contract = buildDomainContractDraft(industry, subtype);
        const enabled = new Set<string>(
            resolveSubtypeExperienceProfile(industry, subtype).capability.toolGroups.map(String));
        // Scenario keys carry their intent: `intent_<task>_<variant>_v<n>`.
        const scenarioKeys = new Set(composeSubtypeEvalPack({ industry, subtype, language: 'es' })
            .map(scenario => scenario.key.replace(/_v\d+$/, '')));

        for (const intent of contract.intents) {
            const dependencies = [...intent.toolPlan];
            const commands = dependencies.filter(name => isBusinessWriteTool(name));
            const capabilities = [...new Set(dependencies
                .flatMap(name => published.get(name) ?? [])
                .filter(family => enabled.has(family)))].sort();

            let verifier: TaskVerifierStatus = intent.commits ? 'none' : 'not_transactional';
            let verifierFamily: string | null = null;
            for (const command of commands) {
                const found = familyFor(command);
                if (!found) continue;
                verifierFamily = found.key;
                verifier = found.family.status;
                if (found.family.status === 'audited') break;
            }

            rows.push(Object.freeze({
                profileId, taskKey: intent.key, transactional: intent.commits,
                capabilities: Object.freeze(capabilities),
                requiredData: Object.freeze(intent.slots.filter(slot => slot.required).map(slot => slot.key)),
                dependencies: Object.freeze(dependencies),
                commands: Object.freeze(commands),
                verifier, verifierFamily,
                hasOwnPositive: POSITIVE_VARIANTS.some(v => scenarioKeys.has(`intent_${intent.key}_${v}`)),
                hasOwnNegative: NEGATIVE_VARIANTS.some(v => scenarioKeys.has(`intent_${intent.key}_${v}`)),
            }));
        }
    }
    return Object.freeze(rows);
}

/** The counts the audits quote, derived from the rows rather than transcribed. */
export function summariseTaskCertificationMatrix(
    rows: readonly TaskCertificationRow[] = buildTaskCertificationMatrix(),
): TaskCertificationSummary {
    const label = (row: TaskCertificationRow) => `${row.profileId}/${row.taskKey}`;
    return Object.freeze({
        profiles: new Set(rows.map(row => row.profileId)).size,
        tasks: rows.length,
        transactional: rows.filter(row => row.transactional).length,
        withoutOwnPositive: Object.freeze(rows.filter(row => !row.hasOwnPositive).map(label).sort()),
        withoutOwnNegative: Object.freeze(rows.filter(row => !row.hasOwnNegative).map(label).sort()),
        // Only a committing task can lack a verifier; a read has nothing to verify.
        withoutVerifier: Object.freeze(rows
            .filter(row => row.transactional && row.verifier === 'none')
            .map(label).sort()),
        deliberatelyUnverifiable: Object.freeze(rows
            .filter(row => row.transactional && row.verifier === 'identity_challenge')
            .map(label).sort()),
        certifiedProfiles: 0,
    });
}
