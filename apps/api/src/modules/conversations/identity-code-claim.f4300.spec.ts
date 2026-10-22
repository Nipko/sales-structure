import { claimsIdentityCodeSent, identityCodeSendBacked } from '../../common/utils/outcome-claim.util';
import { guardIdentityCodeClaim, identityCodeHonestText } from './identity-code-claim';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { ChatIdentityService } from './chat-identity.service';
import { runTransition, type TransitionIO } from './transition-engine';
import { containsHumanOffer } from './human-offer';

/**
 * F4300-02 (production, dental QA tenant on Telegram, 2026-10-22): «¿cuándo es mi próxima cita?» → list_customer_appointments
 * answered identity_verification_required → the reply asked for «el código de 6 dígitos que le fue enviado a su correo o
 * teléfono». No code had left: the contact had a phone and no e-mail, SMS is retired, every send was refused and the guard
 * reported «verification in progress». The customer could never complete it.
 *
 * Fixed at three points: SMS is not chosen while it cannot deliver (no channel → said honestly); every identity answer carries
 * `codeSent` (and where it went, when it went); and the reply guard refuses a «code sent» claim no provider backed.
 */
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

const PRODUCTION_ES = 'Para revisar su próxima cita necesito verificar su identidad. Por favor, ¿puede proporcionarme el código de 6 dígitos que le fue enviado a su correo o teléfono?';
const PRODUCTION_EN = 'For security, I need to verify your identity before checking your appointments. Please provide the 6-digit code sent to your email or phone to continue.';
const PRODUCTION_EN_2 = 'No problem. When you have the 6-digit code sent to your email or phone, please provide it, and I will help you check your appointments.';

describe('claimsIdentityCodeSent', () => {
    it.each([
        PRODUCTION_ES, PRODUCTION_EN, PRODUCTION_EN_2,
        'Le envié un código a j***@example.com; escríbalo aquí para continuar.',
        'Ya le enviamos un código de verificación a su correo.',
        'Se le envió un código de 6 dígitos por SMS.',
        'Escriba el código que recibió por correo.',
        'I sent you a verification code by email.',
        'Enviei um código para o seu e-mail; escreva-o aqui.',
        'Je vous ai envoyé un code de vérification par e-mail.',
        'Saisissez le code envoyé à votre adresse e-mail.',
    ])('claims a sent code: %s', text => expect(claimsIdentityCodeSent(text)).toBe(true));

    it.each([
        '¿Desea que le envíe un código de verificación a su correo?',
        '¿Quiere que le mande un código?',
        'Would you like me to send you a verification code?',
        'Para revisar sus citas necesito verificar su identidad.',
        'No se envió ningún código.',
        'Todavía no le he enviado ningún código de verificación.',
        'Su cita es el martes a las 10:00 (Ref. AE3D0C86).',
        ...(['es', 'en', 'pt', 'fr'] as const).flatMap(lang => (['unverifiable', 'pending', 'not_sent'] as const)
            .map(situation => identityCodeHonestText(situation, lang, true))),
    ])('does not claim a sent code: %s', text => expect(claimsIdentityCodeSent(text)).toBe(false));
});

describe('identityCodeSendBacked', () => {
    it('only a provider-accepted code backs the claim', () => {
        expect(identityCodeSendBacked([{ name: 'request_identity_code', result: { sent: true, via: 'email', sentTo: 'j***@example.com' } }])).toBe(true);
        expect(identityCodeSendBacked([{ name: 'list_customer_appointments', result: { error: 'identity_verification_required', codeSent: true, channel: 'email', maskedDestination: 'j***@example.com' } }])).toBe(true);
        expect(identityCodeSendBacked([{ name: 'list_customer_appointments', result: { error: 'identity_verification_required', challengeSent: false, codeSent: false } }])).toBe(false);
        expect(identityCodeSendBacked([{ name: 'request_identity_code', result: { pending: true, codeSent: false } }])).toBe(false);
        expect(identityCodeSendBacked([{ name: 'list_customer_appointments', result: { error: 'identity_unverifiable', codeSent: false } }])).toBe(false);
        expect(identityCodeSendBacked(undefined)).toBe(false);
    });
});

describe('the reply guard (the two production transcripts and the no-channel case)', () => {
    const never = async () => false;

    it('code NOT requested: the reply never claims a sent code — the honest text, with a person offered', async () => {
        const out = await guardIdentityCodeClaim({
            reply: PRODUCTION_ES, lang: 'es', canOfferPerson: true, delivered: never,
            executed: [{ name: 'list_customer_appointments', result: { error: 'identity_verification_required', needsVerification: true, challengeSent: false, codeSent: false } }],
        });
        expect(out.replaced).toBe(true);
        expect(out.situation).toBe('not_sent');
        expect(claimsIdentityCodeSent(out.text)).toBe(false);
        expect(out.text).toContain('todavía no le he enviado ningún código');
        expect(containsHumanOffer(out.text)).toBe(true);
    });

    it('the English transcript is refused the same way', async () => {
        const out = await guardIdentityCodeClaim({
            reply: PRODUCTION_EN, lang: 'en', canOfferPerson: true, delivered: never,
            executed: [{ name: 'list_customer_appointments', result: { error: 'identity_verification_required', codeSent: false, codeDeliveryPending: true } }],
        });
        expect(out).toMatchObject({ replaced: true, situation: 'pending' });
        expect(claimsIdentityCodeSent(out.text)).toBe(false);
    });

    it('code ACTUALLY requested this turn: the reply may say where it went', async () => {
        const reply = 'Le envié un código a j***@example.com; escríbalo aquí para continuar.';
        const out = await guardIdentityCodeClaim({
            reply, lang: 'es', canOfferPerson: true, delivered: never,
            executed: [
                { name: 'list_customer_appointments', result: { error: 'identity_verification_required', codeSent: false, challengeSent: false } },
                { name: 'request_identity_code', result: { sent: true, codeSent: true, via: 'email', sentTo: 'j***@example.com' } },
            ],
        });
        expect(out).toEqual({ text: reply, replaced: false });
    });

    it('the guard sent the code itself (codeSent on the gated read): the reply stands', async () => {
        const out = await guardIdentityCodeClaim({
            reply: PRODUCTION_ES, lang: 'es', canOfferPerson: true, delivered: never,
            executed: [{ name: 'list_customer_appointments', result: { error: 'identity_verification_required', codeSent: true, channel: 'email', maskedDestination: 'j***@example.com', sentVia: 'email', sentTo: 'j***@example.com' } }],
        });
        expect(out.replaced).toBe(false);
    });

    it('a code delivered in an earlier turn and still live backs «escriba el código que le envié»', async () => {
        const delivered = jest.fn(async () => true);
        const out = await guardIdentityCodeClaim({ reply: 'Escriba aquí el código que le envié a su correo.', lang: 'es', canOfferPerson: true, delivered, executed: [] });
        expect(out.replaced).toBe(false);
        expect(delivered).toHaveBeenCalledTimes(1);
    });

    it('no deliverable channel (Telegram, no e-mail, SMS retired): says it cannot verify here, never a code', async () => {
        const out = await guardIdentityCodeClaim({
            reply: PRODUCTION_ES, lang: 'es', canOfferPerson: true, delivered: never,
            executed: [{ name: 'list_customer_appointments', result: { error: 'identity_unverifiable', codeSent: false, shouldHandoff: true } }],
        });
        expect(out).toMatchObject({ replaced: true, situation: 'unverifiable' });
        expect(out.text).toContain('por este chat no puedo hacerlo');
        expect(claimsIdentityCodeSent(out.text)).toBe(false);
        expect(containsHumanOffer(out.text)).toBe(true);
    });

    it('without a person available the honest text offers none', async () => {
        const out = await guardIdentityCodeClaim({ reply: PRODUCTION_ES, lang: 'es', canOfferPerson: false, delivered: never, executed: [] });
        expect(out.replaced).toBe(true);
        expect(containsHumanOffer(out.text)).toBe(false);
    });

    it('a delivery check that fails counts as «not delivered»', async () => {
        const out = await guardIdentityCodeClaim({ reply: PRODUCTION_ES, lang: 'es', canOfferPerson: true, delivered: async () => { throw new Error('db down'); }, executed: [] });
        expect(out.replaced).toBe(true);
    });
});

describe('the central guard says whether a code left', () => {
    function guard(start: any) {
        const chatIdentity = { isVerified: jest.fn(async () => false), startVerification: jest.fn(async () => start) };
        const service = new ToolExecutionControlService(
            { tenant: { findUnique: jest.fn(async () => ({ industry: 'salud', settings: { verticalConfig: { industry: 'salud', subType: 'consultorio' } } })) } } as any,
            { get: () => 'unit-signing-secret-at-least-32-bytes' } as any, chatIdentity as any, {} as any);
        return (extra: Record<string, unknown> = {}) => service.preflight({ schemaName: 'tenant_x', tenantId, contactId, conversationId, channelType: 'telegram',
            toolName: 'list_customer_appointments', args: {}, ...extra } as any);
    }

    it('sent: codeSent, the channel and the masked destination', async () => {
        const decision: any = await guard({ status: 'sent', via: 'email', hint: 'j***@example.com' })();
        expect(decision.allowed).toBe(false);
        expect(decision.result).toMatchObject({ error: 'identity_verification_required', codeSent: true, channel: 'email', maskedDestination: 'j***@example.com' });
    });

    it('pending (no provider accepted it): codeSent false and the model is told not to claim it', async () => {
        const decision: any = await guard({ status: 'pending' })();
        expect(decision.result).toMatchObject({ error: 'identity_verification_required', codeSent: false, codeDeliveryPending: true });
        expect(decision.result.message).toMatch(/No digas que se envió/);
        expect(decision.result).not.toHaveProperty('sentTo');
    });

    it('no channel: identity_unverifiable, codeSent false', async () => {
        const decision: any = await guard({ status: 'no_channel' })();
        expect(decision.result).toMatchObject({ error: 'identity_unverifiable', codeSent: false, shouldHandoff: true });
    });

    it('identityChallenge none: nothing sent, the next step is named', async () => {
        const decision: any = await guard({ status: 'sent', via: 'email', hint: 'x' })({ identityChallenge: 'none' });
        expect(decision.result).toMatchObject({ error: 'identity_verification_required', challengeSent: false, codeSent: false, nextStep: 'request_identity_code' });
    });
});

describe('ChatIdentityService does not choose SMS while SMS cannot deliver', () => {
    function service(smsAvailable: boolean, contact: { email: string | null; phone: string | null }) {
        const statements: string[] = [];
        const query = jest.fn(async (sql: string) => {
            statements.push(sql);
            if (/FROM contacts c WHERE c\.id/.test(sql)) return [{ ...contact, phone_normalized: contact.phone, erased: false }];
            return [];
        });
        const prisma = { $queryRawUnsafe: jest.fn(async () => []), transactionInTenantSchema: jest.fn(async (_s: string, fn: any) => fn(query)) };
        const sms = { isAvailable: jest.fn(async () => smsAvailable), send: jest.fn() };
        return { identity: new ChatIdentityService(prisma as any, {} as any, sms as any), sms, statements };
    }

    it('phone only, SMS retired → no_channel: no challenge row, no send', async () => {
        const s = service(false, { email: null, phone: '+573001112233' });
        await expect(s.identity.startVerification(tenantId, 'tenant_x', contactId, conversationId, 'telegram')).resolves.toEqual({ status: 'no_channel' });
        expect(s.sms.send).not.toHaveBeenCalled();
        expect(s.statements.some(sql => /INSERT INTO public\.chat_identity_challenges/.test(sql))).toBe(false);
    });

    it('phone only, SMS available → a challenge is issued for SMS', async () => {
        const s = service(true, { email: null, phone: '+573001112233' });
        await s.identity.startVerification(tenantId, 'tenant_x', contactId, conversationId, 'telegram').catch(() => undefined);
        expect(s.statements.some(sql => /INSERT INTO public\.chat_identity_challenges/.test(sql))).toBe(true);
    });

    it('an availability check that throws fails closed', async () => {
        const s = service(true, { email: null, phone: '+573001112233' });
        s.sms.isAvailable.mockRejectedValue(new Error('redis down'));
        await expect(s.identity.startVerification(tenantId, 'tenant_x', contactId, conversationId, 'telegram')).resolves.toEqual({ status: 'no_channel' });
    });
});

describe('the transition engine never says «ya le envié un código» for a code no provider accepted', () => {
    it('request_identity_code → pending: the honest text, the request kept, no «sent» window opened', async () => {
        const calls: string[] = [];
        const io: TransitionIO = {
            execute: async name => {
                calls.push(name);
                if (name === 'list_customer_appointments') return { error: 'identity_verification_required', needsVerification: true, challengeSent: false };
                if (name === 'request_identity_code') return { pending: true, codeSent: false };
                return { error: 'unexpected_tool' };
            },
            interpretTarget: async () => null, todayIso: '2026-10-09', language: 'es', form: 'usted', now: () => Date.parse('2026-10-09T10:00:00Z'),
        };
        const out = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', io);
        expect(out.handled).toBe(true);
        expect(claimsIdentityCodeSent(out.text)).toBe(false);
        expect(out.text).toContain('todavía no puedo confirmar que el código de verificación haya salido');
        expect(out.awaitingIdentity).toMatchObject({ stage: 'awaiting_code' });
        expect(out.awaitingIdentity).not.toHaveProperty('codeSentAt');
        expect(calls.filter(name => name === 'request_identity_code')).toHaveLength(1);
    });
});
