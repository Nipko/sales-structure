import { IdentityService } from './identity.service';

describe('IdentityService serialized profile resolution', () => {
    const schemaName = 'tenant_identity_test';
    const contactA = '11111111-1111-4111-8111-111111111111';
    const contactB = '22222222-2222-4222-8222-222222222222';
    const profileA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const profileB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    function harness(seed?: {
        profiles?: Array<{ id: string; phone: string | null; email: string | null }>;
        identities?: Array<{ contactId: string; profileId: string; isPrimary: boolean }>;
    }) {
        const contacts = new Set([contactA, contactB]);
        const profiles = [...(seed?.profiles || [])];
        const identities = new Map<string, { profileId: string; isPrimary: boolean }>();
        for (const identity of seed?.identities || []) {
            identities.set(identity.contactId, {
                profileId: identity.profileId,
                isPrimary: identity.isPrimary,
            });
        }
        const suggestions: any[][] = [];
        const calls: Array<{ sql: string; params: any[] }> = [];
        const lockTails = new Map<string, Promise<void>>();

        const query = jest.fn(async (sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('SELECT id FROM contacts')) {
                return contacts.has(params[0]) ? [{ id: params[0] }] : [];
            }
            if (sql.includes('FROM contact_identities') && sql.includes('contact_id = $1::uuid')
                && sql.includes('customer_profile_id') && !sql.includes('customer_profile_id =')) {
                const identity = identities.get(params[0]);
                return identity ? [{ customer_profile_id: identity.profileId }] : [];
            }
            if (sql.includes('FROM customer_profiles') && sql.includes('(phone = $1 OR phone = $2)')) {
                return profiles
                    .filter(profile => profile.phone === params[0] || profile.phone === params[1])
                    .map(profile => ({ ...profile }));
            }
            if (sql.includes('FROM customer_profiles') && sql.includes('LOWER(email) = $1')) {
                return profiles.filter(profile => profile.email?.toLowerCase() === params[0]);
            }
            if (sql.includes('INSERT INTO customer_profiles')) {
                const id = profiles.length === 0 ? profileA : profileB;
                profiles.push({ id, phone: params[1], email: params[2] });
                return [{ id }];
            }
            if (sql.includes('INSERT INTO contact_identities')) {
                if (identities.has(params[1])) return [];
                identities.set(params[1], { profileId: params[0], isPrimary: sql.includes('true)') });
                return [{ customer_profile_id: params[0] }];
            }
            if (sql.includes('UPDATE customer_profiles')) return [];
            if (sql.includes('DELETE FROM customer_profiles')) {
                const index = profiles.findIndex(profile => profile.id === params[0]);
                if (index >= 0) profiles.splice(index, 1);
                return [];
            }
            if (sql.includes('FROM contact_identities') && sql.includes('customer_profile_id = $1::uuid')) {
                const entry = [...identities.entries()].find(([, identity]) => (
                    identity.profileId === params[0] && identity.isPrimary
                ));
                return entry ? [{ contact_id: entry[0] }] : [];
            }
            if (sql.includes('SELECT id FROM merge_suggestions')) return [];
            if (sql.includes('INSERT INTO merge_suggestions')) {
                const referencedProfiles = [params[0], params[1]];
                if (referencedProfiles.some(id => !profiles.some(profile => profile.id === id))) {
                    const fk = Object.assign(new Error('foreign key violation'), { code: '23503' });
                    throw fk;
                }
                suggestions.push(params);
                return [];
            }
            return [];
        });
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => {
                const releases: Array<() => void> = [];
                const transactionQuery = async (sql: string, params: any[] = []) => {
                    if (!sql.includes('pg_advisory_xact_lock')) return query(sql, params);

                    calls.push({ sql, params });
                    const key = String(params[0]);
                    const predecessor = lockTails.get(key) || Promise.resolve();
                    let release!: () => void;
                    const gate = new Promise<void>(resolveGate => { release = resolveGate; });
                    lockTails.set(key, predecessor.then(() => gate));
                    await predecessor;
                    releases.push(release);
                    return [];
                };
                try {
                    return await callback(transactionQuery);
                } finally {
                    for (const release of releases.reverse()) release();
                }
            }),
        };
        const redis = {
            get: jest.fn().mockResolvedValue(schemaName),
            set: jest.fn().mockResolvedValue(undefined),
        };
        const service = new IdentityService(prisma as any, redis as any);
        return { service, prisma, profiles, identities, suggestions, calls };
    }

    it('creates one profile for two serialized channel contacts with the same phone', async () => {
        const h = harness();
        await Promise.all([
            h.service.resolveOrCreateProfile('tenant-id', {
                id: contactA,
                phone: '+57 300 111 2233',
                name: 'Cliente',
                channelType: 'whatsapp',
                externalId: '573001112233',
            }),
            h.service.resolveOrCreateProfile('tenant-id', {
                id: contactB,
                phone: '3001112233',
                name: 'Cliente',
                channelType: 'public_booking',
                externalId: '+573001112233',
            }),
        ]);

        expect(h.profiles).toHaveLength(1);
        expect(h.identities.get(contactA)?.profileId).toBe(profileA);
        expect(h.identities.get(contactB)?.profileId).toBe(profileA);
        expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(2);
        expect(h.calls.filter(call => call.sql.includes('INSERT INTO customer_profiles'))).toHaveLength(1);
        expect(h.calls.filter(call => call.sql.includes('identity:phone:'))).toHaveLength(0);
        expect(h.calls.some(call => (
            call.sql.includes('pg_advisory_xact_lock')
            && call.params[0] === 'identity:phone:+573001112233'
        ))).toBe(true);
        expect(h.calls.some(call => call.sql.includes('DELETE FROM customer_profiles'))).toBe(false);
    });

    it('keeps both profiles live and creates a pending suggestion for an ambiguous phone', async () => {
        const h = harness({
            profiles: [{ id: profileA, phone: '+573001112233', email: null }],
            identities: [{ contactId: contactA, profileId: profileA, isPrimary: true }],
        });

        await expect(h.service.resolveOrCreateProfile('tenant-id', {
            id: contactB,
            phone: '+573001112233',
            name: 'Otra persona',
            channelType: 'public_booking',
            externalId: '+573001112233',
            allowPhoneAutoLink: false,
        })).resolves.toBeUndefined();

        expect(h.profiles.map(profile => profile.id)).toEqual([profileA, profileB]);
        expect(h.identities.get(contactB)?.profileId).toBe(profileB);
        expect(h.suggestions).toHaveLength(1);
        expect(h.suggestions[0].slice(0, 4)).toEqual([profileA, profileB, contactA, contactB]);
        expect(h.suggestions[0][4]).toBe('ambiguous_phone_match');
        expect(h.calls.some(call => call.sql.includes('DELETE FROM customer_profiles'))).toBe(false);
    });
});
