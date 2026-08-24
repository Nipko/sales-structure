import { SUBTYPE_EXPERIENCE_PROFILES } from '@parallext/shared';
import {
    DERIVABLE_ALERTS,
    businessWritersForProfile,
    deriveNativeBacklog,
    deriveNativeBacklogAll,
    securityEvidenceForProfile,
    summariseNativeBacklog,
    summariseNativeBacklogDetailed,
    summariseNativeBacklogResponsibility,
} from './native-backlog';

const BUILD_AND_HYBRID = Object.entries(SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)
    .filter(([, profile]) => profile.strategy === 'build' || profile.strategy === 'hybrid');

describe('native backlog scope and state model', () => {
    it('covers exactly every build/hybrid profile and no blocked integration slice', () => {
        const backlog = deriveNativeBacklogAll();
        expect(backlog).toHaveLength(BUILD_AND_HYBRID.length);
        expect(backlog).toHaveLength(54);
        expect(backlog.map(entry => entry.profileId)).not.toContain('finanzas/fintech');
        expect(backlog.map(entry => entry.profileId)).not.toContain('salud/medica_general');
        expect(deriveNativeBacklog('rubro/inventado')).toBeNull();
    });

    it('has no generic needs_review state or untyped finding', () => {
        for (const entry of deriveNativeBacklogAll()) {
            expect(entry.openCodeWork).toEqual(expect.any(Array));
            for (const item of entry.items) {
                expect(['open', 'stale', 'external_gate', 'decision_gate', 'expert_gate'])
                    .toContain(item.state);
                expect(item.state).not.toBe('needs_review');
                expect(item.detail.length).toBeGreaterThan(20);
                expect(item.nextAction.length).toBeGreaterThan(20);
                expect(item.evidence.length).toBeGreaterThan(0);
                expect(item.gates.length).toBeGreaterThan(0);
                for (const fact of item.evidence) {
                    expect(fact.key.length).toBeGreaterThan(3);
                    expect(['verified', 'missing', 'required']).toContain(fact.status);
                    expect(fact.detail.length).toBeGreaterThan(10);
                }
            }
        }
        expect(Object.keys(summariseNativeBacklog())).not.toContain('needs_review');
    });

    it('derives each internal family from code-backed evidence', () => {
        expect(DERIVABLE_ALERTS).toEqual([
            'WRITER', 'CAP', 'LIVE', 'UX', 'SEC', 'SOR', 'PAY', 'E2E',
        ]);
        for (const entry of deriveNativeBacklogAll()) {
            for (const item of entry.items.filter(item =>
                ['WRITER', 'CAP', 'LIVE', 'UX', 'SEC'].includes(item.alert))) {
                expect(item.responsibility).toBe('internal');
                expect(item.gates).toEqual([expect.objectContaining({ kind: 'internal' })]);
                expect(item.evidence.every(fact => fact.source !== 'external_evidence')).toBe(true);
                if (item.state === 'open') {
                    expect(item.openCodeWork.length).toBeGreaterThan(0);
                    expect(item.evidence.some(fact => fact.status === 'missing')).toBe(true);
                } else {
                    expect(item.state).toBe('stale');
                    expect(item.openCodeWork).toEqual([]);
                    expect(item.evidence.every(fact => fact.status === 'verified')).toBe(true);
                }
            }
        }
    });
});

describe('mixed gates do not hide internal work behind providers or pilots', () => {
    it('SOR, PAY and E2E always expose separate internal and external gates', () => {
        for (const entry of deriveNativeBacklogAll()) {
            for (const item of entry.items.filter(item => ['SOR', 'PAY', 'E2E'].includes(item.alert))) {
                expect(item.responsibility).toBe('mixed');
                expect(item.gates.map(gate => gate.kind)).toEqual(['internal', 'external']);
                expect(item.gates[1]).toMatchObject({ status: 'required' });
                expect(item.evidence.some(fact => fact.source === 'external_evidence')).toBe(true);
                if (item.gates[0].status === 'open') {
                    expect(item.state).toBe('open');
                    expect(item.openCodeWork.length).toBeGreaterThan(0);
                } else {
                    expect(item.state).toBe('external_gate');
                    expect(item.openCodeWork).toEqual([]);
                }
            }
        }
    });

    it('a conditional-provider SOR closes code while retaining the external validation gate', () => {
        const realEstate = deriveNativeBacklog('inmobiliaria/venta')!;
        const sor = realEstate.items.find(item => item.alert === 'SOR')!;
        expect(sor.state).toBe('external_gate');
        expect(sor.gates).toEqual([
            expect.objectContaining({ kind: 'internal', status: 'verified' }),
            expect.objectContaining({ kind: 'external', status: 'required' }),
        ]);
        expect(sor.openCodeWork).toEqual([]);
        expect(sor.evidence).toContainEqual(expect.objectContaining({
            key: 'runtime_sor_boundary',
            status: 'verified',
            detail: expect.stringContaining('conditional_provider'),
        }));
    });

    it('a native SOR can close its internal boundary without claiming provider evidence', () => {
        const retail = deriveNativeBacklog('retail/moda')!;
        const sor = retail.items.find(item => item.alert === 'SOR')!;
        expect(sor.state).toBe('external_gate');
        expect(sor.gates[0]).toMatchObject({ kind: 'internal', status: 'verified' });
        expect(sor.gates[1]).toMatchObject({ kind: 'external', status: 'required' });
    });

    it('payment code may be verified while credentials and transactions remain unclaimed', () => {
        const item = deriveNativeBacklog('turismo/tours')!.items.find(entry => entry.alert === 'PAY')!;
        expect(item.evidence.map(fact => fact.key)).toEqual(expect.arrayContaining([
            'payment_plan_gate', 'payment_runtime_policy', 'payment_async_gate', 'pay_external_gate',
        ]));
        expect(item.gates[1].detail).toMatch(/credenciales|evidencia transaccional/);
        expect(item.gates[1].status).toBe('required');
    });
});

describe('concrete CAP, LIVE, UX and SEC evidence', () => {
    it('reuses executable capacity contracts for boarding and home-service dispatch', () => {
        const boarding = deriveNativeBacklog('pet_services/guarderia')!
            .items.find(item => item.alert === 'CAP')!;
        expect(boarding.state).toBe('stale');
        expect(boarding.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'primary_object_readiness', status: 'verified' }),
            expect.objectContaining({ key: 'capacity_read_write_pair', status: 'verified' }),
            expect.objectContaining({ key: 'primary_object_surface', status: 'verified' }),
        ]));

        const plumbing = deriveNativeBacklog('servicios_hogar/plomeria')!
            .items.find(item => item.alert === 'CAP')!;
        expect(plumbing.state).toBe('stale');
        expect(plumbing.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'primary_object_readiness', status: 'verified' }),
            expect.objectContaining({
                key: 'capacity_read_write_pair',
                status: 'verified',
                detail: expect.stringContaining('home-service-capacity.contract.spec.ts'),
            }),
            expect.objectContaining({ key: 'primary_object_surface', status: 'verified' }),
        ]));
    });

    it('closes restaurant, delivery/installation and photography with named atomic contracts', () => {
        const restaurant = deriveNativeBacklog('restaurantes/casual_dining')!
            .items.find(item => item.alert === 'CAP')!;
        const retail = deriveNativeBacklog('retail/hogar')!
            .items.find(item => item.alert === 'CAP')!;
        const photography = deriveNativeBacklog('fotografia/bodas')!
            .items.find(item => item.alert === 'CAP')!;
        for (const item of [restaurant, retail, photography]) {
            expect(item.state).toBe('stale');
            expect(item.openCodeWork).toEqual([]);
        }
        for (const item of [restaurant, retail]) {
            expect(item.evidence).toContainEqual(expect.objectContaining({
                key: 'capacity_read_write_pair',
                status: 'verified',
                detail: expect.stringContaining('appointment-capacity.util.spec.ts'),
            }));
        }
        expect(photography.evidence).toContainEqual(expect.objectContaining({
            key: 'capacity_read_write_pair',
            status: 'verified',
            detail: expect.stringContaining('photography-date-capacity.contract.spec.ts'),
        }));
    });

    it('leaves no historical CAP alert open after resolving every profile contract', () => {
        const capacityItems = deriveNativeBacklogAll()
            .flatMap(entry => entry.items.filter(item => item.alert === 'CAP'));
        expect(capacityItems).toHaveLength(35);
        for (const item of capacityItems) {
            expect(item.state).toBe('stale');
            expect(item.openCodeWork).toEqual([]);
        }
    });

    it('recognizes appointment capacity for grooming and walking profiles', () => {
        for (const id of ['pet_services/peluqueria', 'pet_services/paseos', 'pet_services/adiestramiento']) {
            const item = deriveNativeBacklog(id)!.items.find(entry => entry.alert === 'CAP')!;
            expect(item.state).toBe('stale');
            expect(item.evidence).toContainEqual(expect.objectContaining({
                key: 'capacity_read_write_pair', status: 'verified',
                detail: expect.stringContaining('check_availability'),
            }));
        }
    });

    it('closes LIVE code with a resource-binding fail-closed boundary', () => {
        const item = deriveNativeBacklog('automotriz/concesionario')!
            .items.find(entry => entry.alert === 'LIVE')!;
        expect(item.state).toBe('stale');
        expect(item.openCodeWork).toEqual([]);
        expect(item.evidence).toContainEqual(expect.objectContaining({
            key: 'source_freshness_boundary',
            status: 'verified',
            detail: expect.stringContaining('binding_authoritative_fail_closed'),
        }));
    });

    it('leaves no historical LIVE alert open after typed freshness boundaries', () => {
        const liveItems = deriveNativeBacklogAll()
            .flatMap(entry => entry.items.filter(item => item.alert === 'LIVE'));
        expect(liveItems).toHaveLength(30);
        expect(liveItems.every(item => item.state === 'stale')).toBe(true);
        expect(liveItems.every(item => item.openCodeWork.length === 0)).toBe(true);
    });

    it('verifies the direct operational register and repair CTA for tourism', () => {
        const item = deriveNativeBacklog('turismo/tours')!
            .items.find(entry => entry.alert === 'UX')!;
        expect(item.state).toBe('stale');
        expect(item.evidence).toContainEqual(expect.objectContaining({
            key: 'primary_object_direct_route', status: 'verified',
            detail: expect.stringContaining('/admin/tours'),
        }));
        expect(item.evidence).toContainEqual(expect.objectContaining({
            key: 'repair_cta_reachability', status: 'verified',
        }));
    });

    it('audits security for any profile even before one declares SEC', () => {
        const result = securityEvidenceForProfile('seguros/broker');
        expect(result).not.toBeNull();
        expect(result!.evidence.map(fact => fact.key)).toEqual([
            'tool_policy_coverage', 'central_controls', 'sensitive_ownership', 'manifest_assurance',
        ]);
        expect(result!.evidence.every(fact => fact.status === 'verified')).toBe(true);
        expect(securityEvidenceForProfile('rubro/inventado')).toBeNull();
    });
});

describe('writers and exportable summary', () => {
    it.each([
        ['moda_belleza/spa', 3],
        ['automotriz/alquiler', 3],
        ['pet_services/guarderia', 4],
        ['pet_services/hotel', 4],
    ])('%s retains %i business writers', (id, expected) => {
        const [industry, subtype] = id.split('/');
        expect(businessWritersForProfile(industry, subtype)).toHaveLength(expected);
    });

    it('serializes exact totals and every open code profile with actionable work', () => {
        const report = summariseNativeBacklogDetailed();
        const totalStates = Object.values(report.states).reduce((sum, count) => sum + count, 0);
        const totalResponsibilities = Object.values(report.responsibilities)
            .reduce((sum, count) => sum + count, 0);
        expect(report.generatedFrom.profiles).toBe(54);
        expect(report.generatedFrom.alerts).toBe(totalStates);
        expect(totalResponsibilities).toBe(totalStates);
        expect(report.internalGates.open).toBe(0);
        expect(report.internalGates.verified).toBeGreaterThan(0);
        expect(report.laterGates.external).toBeGreaterThan(0);
        expect(report.profilesWithOpenCode).toEqual([]);
        for (const profile of report.profilesWithOpenCode) {
            expect(profile.alerts.length).toBeGreaterThan(0);
            expect(profile.work.length).toBeGreaterThan(0);
            expect(profile.work.every(work => !/credencial|sandbox|piloto|experto/i.test(work))).toBe(true);
        }
    });

    it('pins the measured 260-item distribution so a registry change requires re-audit', () => {
        const report = summariseNativeBacklogDetailed();
        expect(report.states).toEqual({
            open: 0,
            stale: 82,
            external_gate: 140,
            decision_gate: 17,
            expert_gate: 21,
        });
        expect(report.responsibilities).toEqual({
            internal: 82,
            decision: 17,
            external: 21,
            mixed: 140,
        });
        expect(report.internalGates).toEqual({ verified: 222, open: 0 });
        expect(report.laterGates).toEqual({ external: 140, decision: 17, expert: 21 });
    });

    it('keeps responsibility totals consistent', () => {
        const responsibility = summariseNativeBacklogResponsibility();
        const states = summariseNativeBacklog();
        expect(Object.values(responsibility).reduce((sum, count) => sum + count, 0))
            .toBe(Object.values(states).reduce((sum, count) => sum + count, 0));
        expect(responsibility.internal).toBeGreaterThan(0);
        expect(responsibility.mixed).toBeGreaterThan(0);
        expect(responsibility.external).toBeGreaterThan(0);
    });
});
