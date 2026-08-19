import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    getMissingToolControls,
    getToolPolicy,
    STATIC_TOOL_NAMES,
    TOOL_POLICY_REGISTRY,
    toolBatchRequiresSequentialExecution,
    toolRequiresSequentialExecution,
} from './tool-policy-registry';

function extractAll(input: string, pattern: RegExp): string[] {
    return Array.from(input.matchAll(pattern), match => match[1]);
}

describe('canonical AI tool policy registry', () => {
    it('serializes mixed writer/read batches and parallelizes only pure reads', () => {
        expect(toolBatchRequiresSequentialExecution(['create_appointment', 'check_availability'])).toBe(true);
        expect(toolBatchRequiresSequentialExecution(['check_availability', 'list_services'])).toBe(false);
    });

    const toolsDirectory = join(__dirname, 'tools');
    const definitionNames = readdirSync(toolsDirectory)
        .filter(file => file.endsWith('.ts'))
        .flatMap(file => extractAll(
            readFileSync(join(toolsDirectory, file), 'utf8'),
            /\bname:\s*'([^']+)'/g,
        ));
    const executorNames = extractAll(
        readFileSync(join(__dirname, 'ai-tool-executor.service.ts'), 'utf8'),
        /\bcase\s+'([^']+)'/g,
    );

    it('covers exactly the 95 definitions and 95 executor branches', () => {
        const expected = [...new Set(definitionNames)].sort();
        const executed = [...new Set(executorNames)].sort();
        const registered = [...STATIC_TOOL_NAMES].sort();

        expect(definitionNames).toHaveLength(95);
        expect(expected).toHaveLength(95);
        expect(executed).toHaveLength(95);
        expect(registered).toHaveLength(95);
        expect(registered).toEqual(expected);
        expect(registered).toEqual(executed);
    });

    it('makes every Agent Test tool an explicit static read-only execution policy', () => {
        const safe = STATIC_TOOL_NAMES
            .map(name => [name, TOOL_POLICY_REGISTRY[name]] as const)
            .filter(([, policy]) => policy.agentTestAllowed);
        const contextNeutralizedWriters = new Set([
            'search_faqs',
            'get_policy',
            'search_knowledge_base',
            'recommend_products',
            'triage_pet_emergency',
            'check_policy_status',
            'list_my_claims',
        ]);

        expect(safe.length).toBeGreaterThan(0);
        for (const [name, policy] of safe) {
            expect(name.startsWith('mcp__')).toBe(false);
            expect(policy.effect).not.toBe('write');
            if (policy.effect === 'conditional_write') {
                expect(contextNeutralizedWriters.has(name)).toBe(true);
            } else {
                expect(policy.externalEffect).not.toBe('provider_write');
                expect(policy.externalEffect).not.toBe('channel_write');
                expect(policy.externalEffect).not.toBe('opaque');
                expect(policy.idempotency).toBe('not_applicable');
            }
        }
        expect([...contextNeutralizedWriters].sort()).toEqual(
            safe.filter(([, policy]) => policy.effect === 'conditional_write').map(([name]) => name).sort(),
        );
    });

    it('serializes every write, outbound effect, unknown name and opaque MCP tool', () => {
        for (const name of STATIC_TOOL_NAMES) {
            const policy = TOOL_POLICY_REGISTRY[name];
            if (policy.effect !== 'read'
                || policy.externalEffect === 'provider_write'
                || policy.externalEffect === 'channel_write') {
                expect(toolRequiresSequentialExecution(name)).toBe(true);
            }
        }

        expect(toolRequiresSequentialExecution('not_registered')).toBe(true);
        expect(toolRequiresSequentialExecution('mcp__erp__create_order')).toBe(true);
        expect(getToolPolicy('mcp__erp__create_order')).toMatchObject({
            effect: 'write',
            assurance: 'A4',
            assuranceEnforcement: 'missing',
            externalEffect: 'opaque',
            agentTestAllowed: false,
        });
    });

    it('classifies writers that the former hand-maintained list missed', () => {
        for (const name of [
            'calculate_quote',
            'get_placement_test_link',
            'request_identity_code',
            'verify_identity_code',
            'send_product_image',
            'send_property_image',
            'send_listing_image',
            'send_vehicle_image',
            'send_portfolio',
        ]) {
            expect(TOOL_POLICY_REGISTRY[name].effect).toBe('write');
            expect(toolRequiresSequentialExecution(name)).toBe(true);
        }
    });

    it('closes every static gap through the central runtime boundary', () => {
        const gaps = new Map(getMissingToolControls().map(item => [item.name, item.missing]));

        expect(gaps.size).toBe(0);
        expect(getToolPolicy('create_appointment')).toMatchObject({
            idempotency: 'central_ledger',
            confirmation: 'runtime_enforced',
        });
        expect(getToolPolicy('file_claim')).toMatchObject({
            assurance: 'A2',
            idempotency: 'central_ledger',
            confirmation: 'runtime_enforced',
        });
        // A1, not A2: the step-up identity tools that satisfy A2 are only
        // published with the insurance toolset, so A2 made payment by chat
        // unreachable for every other tenant. The central guard, resource
        // ownership and the signed confirmation turn remain enforced.
        expect(getToolPolicy('create_payment_link')).toMatchObject({
            assurance: 'A1',
            assuranceEnforcement: 'central_guard',
            ownership: 'resource_owner',
            externalEffect: 'provider_write',
            confirmation: 'runtime_enforced',
        });
        expect(getToolPolicy('get_payment_status')).toMatchObject({
            assurance: 'A1',
            effect: 'read',
            ownership: 'resource_owner',
            externalEffect: 'provider_read',
        });
        for (const name of ['refund_payment', 'apply_discount']) {
            expect(getToolPolicy(name)).toMatchObject({
                assurance: 'A4',
                assuranceEnforcement: 'central_guard',
                humanApproval: 'runtime_enforced',
            });
        }
        for (const name of ['create_payment_link', 'refund_payment', 'apply_discount']) {
            expect(getToolPolicy(name)?.ownership).not.toBe('none');
        }
    });

    it('requires A2 step-up for clinical, professional-case and physical-access reads', () => {
        for (const name of [
            'get_treatment_plan',
            'list_upcoming_sessions',
            'get_vaccination_status',
            'get_case_status',
            'get_check_in_instructions',
            'get_appointment_details',
            'list_customer_appointments',
        ]) {
            expect(getToolPolicy(name)).toMatchObject({
                assurance: 'A2',
                assuranceEnforcement: 'step_up',
                dataClassification: 'sensitive',
            });
        }

        // A pet list contains a basic contact-scoped profile, not medical detail.
        expect(getToolPolicy('list_pets_for_contact')).toMatchObject({
            assurance: 'A1',
            assuranceEnforcement: 'contact_context',
        });
    });
});
