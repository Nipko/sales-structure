/**
 * A money authority that says yes, for specs that are about something else.
 *
 * The outbound processor now REQUIRES one: a deployment with a WhatsApp sender
 * and no spend authority is the configuration that produced unmeasured sends,
 * so Nest refuses to build the module instead. That makes every spec that
 * constructs the processor supply one, which is the point — and a shared double
 * keeps the dozen specs that do not care about money from each growing their own
 * slightly different opinion about what an admission looks like.
 *
 * Deliberately permissive and deliberately COMPLETE: it grants a transmission
 * right, because `permitted` without one never meant "you may send", and a
 * double that omitted it would let a spec pass against a sink that never asked.
 */
export function permissiveSpendGate(overrides: Record<string, unknown> = {}) {
    const admission = {
        permitted: true,
        effectKey: 'spec-effect-key',
        reservationId: 'spec-reservation',
        enforcement: 'observe' as const,
        pressure: 'clear' as const,
        transmit: {
            effectKey: 'spec-effect-key',
            token: '00000000-0000-4000-8000-000000000000',
            expiresAt: new Date(Date.now() + 900_000),
        },
    };
    return {
        admit: jest.fn(async () => admission),
        admitBySchema: jest.fn(async () => admission),
        beginTransmission: jest.fn(async () => true),
        abandon: jest.fn(async () => undefined),
        record: jest.fn(async () => undefined),
        tenantForSchema: jest.fn(async () => '11111111-1111-4111-8111-111111111111'),
        ...overrides,
    } as any;
}

/**
 * An authority that cannot answer.
 *
 * For the specs that exist to prove the platform DEFERS rather than sending
 * unmeasured — which is the whole reason the injection stopped being optional.
 */
export function unavailableSpendGate() {
    return permissiveSpendGate({
        admit: jest.fn(async () => { throw new Error('meter down'); }),
        admitBySchema: jest.fn(async () => { throw new Error('meter down'); }),
    });
}

/**
 * A Prisma double that can name a tenant's schema.
 *
 * Every send path now resolves the schema before it can ask about money, so a
 * `{}` standing in for Prisma is no longer a Prisma: it makes the lane defer.
 * Transport specs that are not about money use this so the deferral they get is
 * the real one — a meter that answered — and not an artefact of the double.
 */
export function schemaNamingPrisma(overrides: Record<string, unknown> = {}) {
    return {
        getTenantSchemaName: jest.fn(async () => 'tenant_spec'),
        ...overrides,
    } as any;
}
