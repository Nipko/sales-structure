import {
    CREDENTIAL_TYPE_BY_CHANNEL,
    ChannelCredentialHealth,
    credentialRecordHealth,
    expiryHealth,
    hasRealToken,
    isCredentialFailure,
    isCredentialWarning,
    resolveCredentialHealth,
    worstCredentialHealth,
} from './channel-credential-health.util';

const NOW = new Date('2026-09-04T12:00:00.000Z').getTime();
const IN_TWO_DAYS = '2026-09-06T12:00:00.000Z';
const IN_A_MONTH = '2026-10-04T12:00:00.000Z';
const YESTERDAY = '2026-09-03T12:00:00.000Z';

type Case = {
    name: string;
    input: Partial<Parameters<typeof resolveCredentialHealth>[0]> & { channelType: string };
    expected: ChannelCredentialHealth;
};

const base = {
    hasAccountToken: false,
    metadata: null as Record<string, unknown> | null,
    latestCredential: null as { rotationState?: string | null; expiresAt?: Date | string | null } | null,
    lookupAvailable: true,
    hasLegacyWhatsAppToken: false,
    now: NOW,
};

describe('channel-credential-health util', () => {
    describe('resolveCredentialHealth', () => {
        const cases: Case[] = [
            // The widget has no credential of its own: active means healthy.
            { name: 'web widget is healthy with no credential at all', input: { channelType: 'web_widget' }, expected: 'ok' },
            {
                name: 'web widget ignores a broken tenant credential',
                input: { channelType: 'web_widget', latestCredential: { rotationState: 'revoked' } },
                expected: 'ok',
            },

            // WhatsApp: tenant-wide system user token, with the legacy rescue.
            {
                name: 'whatsapp with an active system-user token',
                input: { channelType: 'whatsapp', latestCredential: { rotationState: 'active', expiresAt: null } },
                expected: 'ok',
            },
            {
                name: 'whatsapp with no credential row and no legacy token',
                input: { channelType: 'whatsapp' },
                expected: 'missing',
            },
            {
                name: 'whatsapp with no credential row but a legacy per-number token',
                input: { channelType: 'whatsapp', hasLegacyWhatsAppToken: true },
                expected: 'ok',
            },
            {
                name: 'whatsapp when the credential table cannot be read',
                input: { channelType: 'whatsapp', lookupAvailable: false },
                expected: 'unknown',
            },
            {
                name: 'whatsapp when the lookup fails but a legacy token exists',
                input: { channelType: 'whatsapp', lookupAvailable: false, hasLegacyWhatsAppToken: true },
                expected: 'ok',
            },
            {
                name: 'whatsapp with a revoked credential is NOT rescued by a legacy token',
                input: { channelType: 'whatsapp', hasLegacyWhatsAppToken: true, latestCredential: { rotationState: 'revoked' } },
                expected: 'revoked',
            },
            {
                name: 'whatsapp with an errored credential',
                input: { channelType: 'whatsapp', latestCredential: { rotationState: 'error' } },
                expected: 'error',
            },
            {
                name: 'whatsapp with a credential in an unrecognised rotation state',
                input: { channelType: 'whatsapp', latestCredential: { rotationState: 'rotating' } },
                expected: 'unknown',
            },
            {
                name: 'whatsapp with an expired credential',
                input: { channelType: 'whatsapp', latestCredential: { rotationState: 'active', expiresAt: YESTERDAY } },
                expected: 'expired',
            },
            {
                name: 'whatsapp with a credential expiring inside a week',
                input: { channelType: 'whatsapp', latestCredential: { rotationState: 'active', expiresAt: IN_TWO_DAYS } },
                expected: 'expiring',
            },
            {
                name: 'whatsapp with a credential expiring far away',
                input: { channelType: 'whatsapp', latestCredential: { rotationState: 'active', expiresAt: IN_A_MONTH } },
                expected: 'ok',
            },

            // Instagram: the per-account token owns its own expiry.
            {
                name: 'instagram account token expiring inside a week',
                input: { channelType: 'instagram', hasAccountToken: true, metadata: { tokenExpiresAt: IN_TWO_DAYS } },
                expected: 'expiring',
            },
            {
                name: 'instagram account token already expired',
                input: { channelType: 'instagram', hasAccountToken: true, metadata: { tokenExpiresAt: YESTERDAY } },
                expected: 'expired',
            },
            {
                name: 'instagram account token with no expiry recorded',
                input: { channelType: 'instagram', hasAccountToken: true, metadata: {} },
                expected: 'unknown',
            },
            {
                name: 'instagram account token with an unparseable expiry',
                input: { channelType: 'instagram', hasAccountToken: true, metadata: { tokenExpiresAt: 'soon' } },
                expected: 'unknown',
            },
            {
                name: 'instagram account token healthy does not consult the tenant credential',
                input: {
                    channelType: 'instagram',
                    hasAccountToken: true,
                    metadata: { tokenExpiresAt: IN_A_MONTH },
                    latestCredential: { rotationState: 'revoked' },
                },
                expected: 'ok',
            },
            {
                name: 'instagram without an account token falls back to the tenant credential',
                input: { channelType: 'instagram', latestCredential: { rotationState: 'revoked' } },
                expected: 'revoked',
            },

            // Other channels: own token wins, otherwise the per-type credential.
            {
                name: 'telegram with its own account token',
                input: { channelType: 'telegram', hasAccountToken: true },
                expected: 'ok',
            },
            {
                name: 'telegram without an account token and no credential row',
                input: { channelType: 'telegram' },
                expected: 'missing',
            },
            {
                name: 'messenger without an account token uses its per-type credential',
                input: { channelType: 'messenger', latestCredential: { rotationState: 'error' } },
                expected: 'error',
            },
            {
                name: 'an unmapped channel without a token cannot be judged',
                input: { channelType: 'email' },
                expected: 'unknown',
            },
            {
                name: 'an unmapped channel with its own token is usable',
                input: { channelType: 'email', hasAccountToken: true },
                expected: 'ok',
            },
        ];

        it.each(cases)('$name', ({ input, expected }) => {
            expect(resolveCredentialHealth({ ...base, ...input })).toBe(expected);
        });

        it('defaults `now` to the current clock', () => {
            const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
            expect(resolveCredentialHealth({
                ...base,
                now: undefined,
                channelType: 'whatsapp',
                latestCredential: { rotationState: 'active', expiresAt: soon },
            })).toBe('expiring');
        });
    });

    describe('classification', () => {
        it.each([
            ['missing', true],
            ['error', true],
            ['revoked', true],
            ['expired', true],
            ['unknown', false],
            ['expiring', false],
            ['ok', false],
        ] as const)('isCredentialFailure(%s) is %s', (health, expected) => {
            expect(isCredentialFailure(health)).toBe(expected);
        });

        it.each([
            ['unknown', true],
            ['expiring', true],
            ['ok', false],
            ['missing', false],
            ['error', false],
            ['revoked', false],
            ['expired', false],
        ] as const)('isCredentialWarning(%s) is %s', (health, expected) => {
            expect(isCredentialWarning(health)).toBe(expected);
        });

        it('never classifies a value as both a failure and a warning', () => {
            const all: ChannelCredentialHealth[] = ['ok', 'expiring', 'unknown', 'missing', 'error', 'revoked', 'expired'];
            for (const health of all) {
                expect(isCredentialFailure(health) && isCredentialWarning(health)).toBe(false);
            }
        });
    });

    describe('worstCredentialHealth', () => {
        it('keeps the worst account instead of the first or the healthiest', () => {
            expect(worstCredentialHealth(['ok', 'expiring', 'ok'])).toBe('expiring');
            expect(worstCredentialHealth(['ok', 'expired'])).toBe('expired');
            expect(worstCredentialHealth(['revoked', 'expired'])).toBe('expired');
            expect(worstCredentialHealth(['unknown', 'missing'])).toBe('missing');
            expect(worstCredentialHealth(['ok', 'ok'])).toBe('ok');
        });

        it('treats "no account at all" as missing, not healthy', () => {
            expect(worstCredentialHealth([])).toBe('missing');
        });
    });

    describe('token and expiry helpers', () => {
        it.each([
            ['a real token', 'EAAG...', true],
            ['an empty string', '', false],
            ['the encrypted_ref placeholder', 'encrypted_ref', false],
            ['the credential_ref placeholder', 'credential_ref', false],
            ['whitespace around a placeholder', '  credential_ref  ', false],
            ['null', null, false],
            ['undefined', undefined, false],
        ])('hasRealToken(%s)', (_name, value, expected) => {
            expect(hasRealToken(value)).toBe(expected);
        });

        it('reports an absent expiry as unknown rather than healthy', () => {
            expect(expiryHealth(null, NOW)).toBe('unknown');
            expect(expiryHealth(undefined, NOW)).toBe('unknown');
        });

        it('accepts a Date as well as an ISO string', () => {
            expect(expiryHealth(new Date(YESTERDAY), NOW)).toBe('expired');
            expect(expiryHealth(new Date(IN_A_MONTH), NOW)).toBe('ok');
        });

        it('reads an unreadable credential table as unknown, never as missing', () => {
            expect(credentialRecordHealth(null, false, NOW)).toBe('unknown');
            expect(credentialRecordHealth(null, true, NOW)).toBe('missing');
        });
    });

    it('maps every conversational channel to its credential type', () => {
        expect(CREDENTIAL_TYPE_BY_CHANNEL).toEqual({
            whatsapp: 'system_user_token',
            instagram: 'instagram_token',
            messenger: 'messenger_token',
            telegram: 'telegram_token',
        });
    });
});
