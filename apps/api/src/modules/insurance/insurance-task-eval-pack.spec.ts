import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildDomainContractDraft, composeSubtypeEvalPack, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { bindCanonicalEvalFixtures, CANONICAL_EVAL_FIXTURE_IDS, resolveCanonicalEvalFixtures } from '../simulation/eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { buildTaskCompetenceMatrix, hasPositiveTaskAssertion } from '../simulation/task-competence-matrix';
import { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';
import { canEvalExecuteWriter, EVAL_SANDBOX_CONTACT_ID, EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';

const fixture = resolveCanonicalEvalFixtures({ capturedAt: '2026-09-07T15:00:00Z', config: { hours: { timezone: 'America/Bogota', schedule: {} } } } as AgentEvaluationSnapshot);
const CASES = ['complete', 'repeat', 'missing_profile', 'question', 'coverage_claim'];
const POSITIVE = new Set(['complete', 'repeat']);

describe('insurance quote competence pack', () => {
    it('declares the quoted and the not-quoted cases for every insurance profile and language', () => {
        let profiles = 0;
        for (const profileId of listCanonicalSubtypeExperienceProfileIds()) {
            const [industry, subtype] = profileId.split('/');
            const task = buildDomainContractDraft(industry, subtype).intents.find(item => item.key === 'quote_policy');
            if (task) profiles++;
            for (const language of EVAL_LANGUAGES) {
                const cases = composeSubtypeEvalPack({ industry, subtype, language })
                    .filter(item => item.key.startsWith('intent_quote_policy_canonical_'));
                expect(cases).toHaveLength(task ? CASES.length : 0);
                for (const scenario of cases) {
                    expect(scenario.profileId).toBe(profileId);
                    expect(scenario.language).toBe(language);
                    // Every token must bind, and no scenario may leak the writer
                    // adapter's own placeholder year into a tenant-facing case.
                    expect(JSON.stringify(bindCanonicalEvalFixtures(scenario, fixture))).not.toMatch(/\{\{fixture\.|2099/);
                    expect(scenario.messages.length).toBeLessThanOrEqual(8);
                }
                if (task) for (const key of CASES) {
                    const scenario = cases.find(item => item.key.endsWith(`_${key}_v1`))!;
                    expect(scenario).toBeDefined();
                    expect(hasPositiveTaskAssertion(task.toolPlan, scenario)).toBe(POSITIVE.has(key));
                }
            }
        }
        expect(profiles).toBeGreaterThan(0);
    });

    it('asserts the columns the writer actually persists, not merely that some row appeared', () => {
        const pack = composeSubtypeEvalPack({ industry: 'seguros', subtype: 'broker', language: 'en' });
        const complete = bindCanonicalEvalFixtures(pack.find(item => item.key === 'intent_quote_policy_canonical_complete_v1')!, fixture);
        const row = complete.expectedActions!.find(item => item.kind === 'db_effect' && item.type === 'row_exists')! as any;
        // `createQuote` hard-codes 'sent', copies the plan currency and stores
        // `calculatePremium` over the flat fixture band (50 monthly → 600 annual).
        expect(row.where).toEqual({
            plan_id: CANONICAL_EVAL_FIXTURE_IDS.insurancePlan, applicant_name: 'Alex Rivera',
            monthly_premium: 50, annual_premium: 600, currency: 'COP', status: 'sent',
        });
        expect(complete.expectedActions).toContainEqual({ kind: 'tool_call', type: 'called', tool: 'calculate_quote' });
        expect(complete.expectedActions).toContainEqual({ kind: 'db_effect', type: 'row_count', family: 'insurance_quotes', table: 'insurance_quotes', count: 1 });
        const repeat = pack.find(item => item.key === 'intent_quote_policy_canonical_repeat_v1')!;
        expect(repeat.expectedActions).toContainEqual({ kind: 'db_effect', type: 'row_count', family: 'insurance_quotes', table: 'insurance_quotes', count: 1 });
        for (const key of ['missing_profile', 'question', 'coverage_claim']) {
            const negative = pack.find(item => item.key === `intent_quote_policy_canonical_${key}_v1`)!;
            expect(negative.expectedActions).toEqual([
                { kind: 'tool_call', type: 'not_called', tool: 'calculate_quote' },
                { kind: 'db_effect', type: 'no_row', family: 'insurance_quotes', table: 'insurance_quotes' },
            ]);
        }
    });

    it('seeds the plan the writer reads before it writes, and keeps the writer namespace-only', () => {
        // The quote is calculated against a real plan. Without this row
        // `calculate_quote` returns `Plan not found` and no positive case could
        // ever pass, whatever the agent said.
        const source = readFileSync(resolve(__dirname, '../simulation/eval-canonical-fixtures.ts'), 'utf8');
        expect(source).toContain("INSERT INTO ${table('insurance_plans')}");
        expect(source).toMatch(/monthly_premium_min,monthly_premium_max[\s\S]*?50,50,'COP'/);
        expect(CANONICAL_EVAL_TOOLS.has('calculate_quote')).toBe(true);
        // Audited does not mean it may write a tenant's real schema.
        expect(canEvalExecuteWriter('calculate_quote', EVAL_SANDBOX_CONTACT_ID)).toBe(false);
        expect(EVAL_WRITER_SANDBOX_FAMILIES.insurance_quotes.canonicalOnly).toBe(true);
        expect(EVAL_WRITER_SANDBOX_FAMILIES.insurance_quotes.contactColumn).toBe('contact_id');
    });

    it('clears the missing-positive gap for quote_policy without claiming the profile was certified', () => {
        const matrix = buildTaskCompetenceMatrix();
        let tasks = 0;
        for (const profile of matrix.profiles) for (const task of profile.tasks.filter(item => item.key === 'quote_policy')) {
            tasks++;
            expect(task.gaps).not.toContain('positive_task_case_missing');
            expect(task.gaps).not.toContain('effect_verifier_missing');
            expect(task.gaps).toContain('profile_execution_evidence_missing');
            expect(profile.certification.certified).toBe(false);
        }
        expect(tasks).toBe(5);
        // `file_claim` keeps its identity-challenge contract: it never reaches a
        // writer, so it must stay counted rather than be closed by weakening it.
        expect(matrix.summary.tasksMissingPositiveCases).toBeGreaterThan(0);
    });
});
