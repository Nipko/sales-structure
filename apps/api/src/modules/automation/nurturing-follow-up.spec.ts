import { NurturingService } from './nurturing.service';

/**
 * ═══ THE FOLLOW-UP THAT SAID IT SENT A TEMPLATE AND SENT A TEXT ═══
 *
 * Attempt 2 fires a day after the customer stopped replying, so it is outside
 * WhatsApp's 24-hour window almost by definition — and outside that window Meta
 * accepts approved templates and nothing else.
 *
 * It built its own outbound and put a free-form text on the queue, bypassing,
 * in order: the opt-out check, the allowed-channel list, the one-per-day cap
 * and the window check that attempts 1 and 3 both use. Then it logged
 * "Attempt 2: Template sent". Its catch fell back to another text, which failed
 * the same way. The conversation history recorded all of it as `delivered`.
 *
 * The configuration for the real template — `whatsappTemplateName`, documented
 * as "to use outside 24h window" — already existed, and nothing had ever read
 * it. That is the shape: the decision was made, written down, and unreachable.
 */
describe('a nurturing follow-up outside the 24-hour window', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const contact = { id: 'contact-1', name: 'Ana', phone: '+573001112233' };

    function harness(options: {
        withinWindow?: boolean; templateName?: string | null;
        optedOut?: boolean; sentToday?: boolean;
    } = {}) {
        const rows: Array<{ sql: string; params: any[] }> = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
                rows.push({ sql, params });
                if (sql.includes('sent_today')) return [{ sent_today: Boolean(options.sentToday) }];
                if (sql.includes('FROM conversations')) {
                    return [{ id: conversationId, channel_type: 'whatsapp',
                        channel_account_id: 'phone-1', contact_id: 'contact-1', status: 'active' }];
                }
                return [];
            }),
            // The config is read with a tagged template, not through the
            // Prisma model — so the double has to answer `$queryRaw` the way
            // the client does.
            $queryRaw: jest.fn(async () => [{ settings: { nurturing: {
                enabled: true, allowedChannels: ['whatsapp'], maxPerDay: 1,
                whatsappTemplateName: options.templateName === null
                    ? '' : (options.templateName ?? 'seguimiento_ana'),
            } } }]),
        };
        // The lane, doubled at its edge. The follow-up no longer calls a
        // provider or a queue: it commits a row and the processor sends it, so
        // what this suite reads is what the lane was asked to write.
        const dispatched: any[] = [];
        const proactive: any = {
            send: jest.fn(async (_tenantId: string, input: any) => {
                dispatched.push(input);
                return { kind: 'prepared', originId: 'origin' };
            }),
            conversationFor: jest.fn(async () => conversationId),
            policyAuthority: jest.fn(async (_schema: string, input: any) => ({
                kind: 'proactive_policy', ...input, entityRevision: 'a'.repeat(64),
                policyVersion: 1, schemaName: 'tenant_acme',
            })),
        };
        const compliance = { isBlocked: jest.fn(async () => Boolean(options.optedOut)) };
        // The resolver that refuses to pick a number. This suite's tenant has
        // one, so it answers; the refusal path is proven beside the resolver.
        const connections = {
            resolve: jest.fn(async () => ({ accessToken: 't', accountId: 'phone-1' })),
        };
        // queue, prisma, redis, persona, llmRouter, channelToken, connections,
        // compliance, proactive, cronLock, pipeline.
        const service = new NurturingService(
            {} as any, prisma,
            { del: jest.fn(), getJson: jest.fn(async () => null), setJson: jest.fn() } as any,
            {} as any, {} as any,
            { getChannelToken: jest.fn(async () => ({ accessToken: 't', accountId: 'phone-1' })) } as any,
            connections as any, compliance as any, proactive as any,
            {} as any, {} as any,
        );
        jest.spyOn((service as any), 'isWithinMessagingWindow')
            .mockResolvedValue(options.withinWindow ?? false);
        jest.spyOn((service as any), 'resolveFollowUpLanguage').mockResolvedValue('pt');
        jest.spyOn((service as any), 'tenantSchema').mockResolvedValue('tenant_acme');
        jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'debug').mockImplementation(() => undefined);
        return { service, prisma, proactive, dispatched, compliance, connections, rows };
    }

    const attempt2 = (h: ReturnType<typeof harness>) =>
        (h.service as any).executeAttempt2(tenantId, 'tenant_acme', conversationId, contact);

    it('sends the tenant’s approved template, not a free-form text', async () => {
        const h = harness();
        await attempt2(h);

        expect(h.dispatched).toHaveLength(1);
        // A TEMPLATE item, not a text one: a free-form message outside the
        // window is refused by Meta, and committing one is how the follow-up
        // silently never happened.
        expect(h.dispatched[0].items).toEqual([
            { kind: 'template', payload: expect.objectContaining({ templateName: 'seguimiento_ana' }) },
        ]);
    });

    it('sends it in the conversation’s own language, not always Spanish', async () => {
        // Meta refuses a template in a language it was not approved in, and
        // `'es'` was hardcoded while every other line of this follow-up already
        // resolved the conversation's language.
        const h = harness();
        await attempt2(h);
        expect(h.dispatched[0].items[0].payload.language).toBe('pt');
    });

    it('sends it from the number this conversation belongs to', async () => {
        // A tenant with two numbers would otherwise open the follow-up from
        // whichever number resolved first — one the customer has never seen.
        const h = harness();
        await attempt2(h);
        expect(h.dispatched[0].channelAccountId).toBe('phone-1');
        // And the authority names the same account, or the admission refuses it.
        expect(h.proactive.policyAuthority).toHaveBeenCalledWith('tenant_acme',
            expect.objectContaining({ channelAccountId: 'phone-1', producer: 'nurturing_followup' }));
    });

    it('sends nothing at all when no template is configured', async () => {
        // The honest answer. A text here would be refused by Meta and recorded
        // as delivered, which is worse than not sending: an agent reading the
        // history concludes the customer was contacted and ignored them.
        const h = harness({ templateName: null });
        await attempt2(h);
        expect(h.dispatched).toEqual([]);
    });

    it('never contacts somebody who opted out', async () => {
        const h = harness({ optedOut: true });
        await attempt2(h);
        expect(h.compliance.isBlocked).toHaveBeenCalledWith(tenantId, contact.phone);
        expect(h.dispatched).toEqual([]);
    });

    it('respects the one-a-day cap it used to skip entirely', async () => {
        const h = harness({ sentToday: true });
        await attempt2(h);
        expect(h.dispatched).toEqual([]);
    });

    it('sends free-form text when the window is genuinely open', async () => {
        // The control. Without it every test above would pass against an
        // attempt that had simply stopped sending anything.
        const h = harness({ withinWindow: true });
        await attempt2(h);
        expect(h.dispatched).toHaveLength(1);
        expect(h.dispatched[0].items[0].kind).toBe('text');
    });

    it('writes no history row of its own any more', async () => {
        // It used to insert one itself, as `delivered`, before anything had
        // been sent. The lane writes that row inside the transaction that
        // commits the effect, as `pending`, so a second writer here would be a
        // second, unreconciled story about the same message.
        const h = harness({ withinWindow: true });
        await attempt2(h);
        expect(h.rows.find(row => row.sql.includes('INSERT INTO messages'))).toBeUndefined();
    });

    it('marks the conversation as nudged today only over a durable effect', async () => {
        // The once-a-day cap used to count history rows carrying
        // `metadata.source = 'nurturing'`. The lane writes that row without any
        // metadata of ours, so the cap needed a mark of its own — and it is
        // written only when a row exists.
        const h = harness({ withinWindow: true });
        await attempt2(h);
        expect(h.rows.some(row => row.sql.includes("'{nurturing_last_sent_at}'"))).toBe(true);

        const refused = harness({ withinWindow: true });
        refused.proactive.send = jest.fn(async () => ({ kind: 'deferred', reason: 'busy' }));
        await attempt2(refused);
        expect(refused.rows.some(row => row.sql.includes("'{nurturing_last_sent_at}'"))).toBe(false);
    });
});
