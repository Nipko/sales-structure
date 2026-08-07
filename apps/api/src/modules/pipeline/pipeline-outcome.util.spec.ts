import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveMirroredDealStatus, resolveTerminalOutcome } from './pipeline-outcome.util';
import { VERTICAL_REGISTRY } from '../verticals/vertical-definitions';

describe('resolveTerminalOutcome', () => {
    it('returns null for non-terminal stages', () => {
        expect(resolveTerminalOutcome({ is_terminal: false, default_probability: 100 })).toBeNull();
    });

    it('uses the explicit terminal outcome regardless of slug or probability', () => {
        expect(resolveTerminalOutcome({ is_terminal: true, terminal_outcome: 'won', default_probability: 0 })).toBe('won');
        expect(resolveTerminalOutcome({ is_terminal: true, terminal_outcome: 'lost', default_probability: 100 })).toBe('lost');
    });

    it.each([0, 49, 50, 100])('fails closed without explicit metadata even at probability %s', (probability) => {
        expect(() => resolveTerminalOutcome({ is_terminal: true, default_probability: probability }))
            .toThrow('requires explicit terminal_outcome');
    });

    it('requires an explicit outcome on every terminal stage across all 18 verticals', () => {
        expect(Object.keys(VERTICAL_REGISTRY)).toHaveLength(18);

        for (const definition of Object.values(VERTICAL_REGISTRY)) {
            for (const stage of definition.pipeline.stages) {
                if (stage.isTerminal) {
                    expect(['won', 'lost']).toContain(stage.terminalOutcome);
                } else {
                    expect(stage).not.toHaveProperty('terminalOutcome');
                }
            }

            const outcomes = definition.pipeline.stages
                .filter((stage) => stage.isTerminal)
                .map((stage) => resolveTerminalOutcome({
                    is_terminal: true,
                    terminal_outcome: stage.terminalOutcome,
                    default_probability: stage.probability,
                }));

            expect(outcomes.length).toBeGreaterThan(0);
            expect(outcomes.every((outcome) => outcome === 'won' || outcome === 'lost')).toBe(true);
        }
    });
});

describe('resolveMirroredDealStatus', () => {
    it('keeps a non-terminal stage open', () => {
        expect(resolveMirroredDealStatus({ is_terminal: false })).toBe('open');
    });

    it('uses explicit stage outcomes for every vertical vocabulary', () => {
        expect(resolveMirroredDealStatus({ is_terminal: true, terminal_outcome: 'won' })).toBe('won');
        expect(resolveMirroredDealStatus({ is_terminal: true, terminal_outcome: 'lost' })).toBe('lost');
    });

    it('preserves an exclusive historical opportunity outcome if its old stage cannot be mapped', () => {
        expect(resolveMirroredDealStatus({ is_terminal: false }, { won_at: new Date(), lost_at: null })).toBe('won');
        expect(resolveMirroredDealStatus({ is_terminal: false }, { won_at: null, lost_at: new Date() })).toBe('lost');
    });

    it('falls back to the stage when legacy timestamps are ambiguous', () => {
        expect(resolveMirroredDealStatus(
            { is_terminal: true, terminal_outcome: 'lost' },
            { won_at: new Date(), lost_at: new Date() },
        )).toBe('lost');
    });

    it('does not let historical timestamps bypass missing terminal metadata', () => {
        expect(() => resolveMirroredDealStatus(
            { is_terminal: true, default_probability: 100 },
            { won_at: new Date(), lost_at: null },
        )).toThrow('requires explicit terminal_outcome');
    });

    it('keeps provisioning and startup reconciliation free of probability outcome inference', () => {
        const tenantSchema = readFileSync(
            resolve(__dirname, '../../../prisma/tenant-schema.sql'),
            'utf8',
        );
        const prismaService = readFileSync(
            resolve(__dirname, '../prisma/prisma.service.ts'),
            'utf8',
        );
        for (const source of [tenantSchema, prismaService]) {
            expect(source).not.toMatch(/default_probability\s*>=\s*50/);
            expect(source).not.toMatch(/is_terminal\s*=\s*true\s+THEN\s+'lost'/);
        }
        expect(tenantSchema).toContain('pipeline_stages_terminal_outcome_check');
        expect(prismaService).toContain('o.deal_id IS NULL');
        expect(prismaService).not.toContain('DISTINCT ON (l.contact_id)');
        expect(prismaService).not.toContain("else if (opp.stage === 'listo_para_cierre')");
    });
});
