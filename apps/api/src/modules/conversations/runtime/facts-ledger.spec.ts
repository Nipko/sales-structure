import type { TurnContext } from '@parallext/shared';
import { PromptAssemblerService } from '../prompt-assembler.service';
import { ResponseValidatorService, enforceVerifiedPriceReply } from '../response-validator.service';
import { buildTrustedPriceCorpus } from '../trusted-price-context';
import { extractVerifiedFacts } from './facts-extractors';
import { FACT_TTL_MS, liveVerifiedFacts, mergeVerifiedFacts, verifiedFactViews } from './facts-ledger';

/**
 * Operations runtime PR3 — typed verified-facts ledger (flag agentRuntime.factsLedger).
 *
 * Production QA 2026-10-22 (F4300-22): turn 1 read get_menu and quoted the confirmed 13.500 COP; turn 2, without
 * reading again, said «el precio no está confirmado». A fact read one turn earlier did not survive to the next.
 */
const T0 = new Date('2026-10-22T15:00:00.000Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const MENU = { count: 2, items: [
    { id: 'dish-paisa', name: 'Bandeja paisa', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: ['huevo'], prepTimeMinutes: 20 },
    { id: 'dish-ajiaco', name: 'Ajiaco', price: 0, priceStatus: 'missing', currency: 'COP', allergens: [] },
] };
const ROOMS = { properties: [
    { id: 'room-a', name: 'Habitación A', nightPrice: 200000, currency: 'COP', amenities: ['wifi', 'jacuzzi'], maxGuests: 2 },
    { id: 'room-b', name: 'Habitación B', nightPrice: 250000, currency: 'COP', amenities: ['wifi'], maxGuests: 4 },
] };

const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona>Atiende.</persona>' } as any);
const turnContext = (extra: Partial<TurnContext> = {}): TurnContext => ({
    language: 'es', timezone: 'America/Bogota', now: T0.toISOString(), upcomingDays: [], businessHoursStatus: 'open', ...extra,
} as TurnContext);
const validator = new ResponseValidatorService();
const EMPTY_CORPUS = buildTrustedPriceCorpus({}, []);

describe('facts extraction', () => {
    it('get_menu: the confirmed price becomes a money fact of that dish; a missing price adds nothing', () => {
        const { facts } = extractVerifiedFacts([{ name: 'get_menu', result: MENU }], T0, 'msg-1');
        const money = facts.filter(f => f.kind === 'money');
        expect(money).toEqual([expect.objectContaining({
            subject: { type: 'menu_item', id: 'dish-paisa', name: 'Bandeja paisa' }, field: 'price', value: 13500,
            currency: 'COP', priceStatus: 'confirmed', source: { tool: 'get_menu', turn: 'msg-1' },
            observedAt: T0.toISOString(), expiresAt: new Date(T0.getTime() + FACT_TTL_MS.money).toISOString(),
        })]);
        expect(facts.filter(f => f.kind === 'attribute').map(f => [f.subject.id, f.field, f.value]))
            .toEqual(expect.arrayContaining([['dish-paisa', 'allergens', ['huevo']], ['dish-paisa', 'prepTimeMinutes', 20]]));
    });

    it.each([
        ['error', { error: 'read_failed', items: [{ id: 'x', name: 'X', price: 9 }] }],
        ['success=false', { success: false, items: [{ id: 'x', name: 'X', price: 9 }] }],
        ['status=error', { status: 'error', message: 'No pude consultar' }],
        ['stale', { status: 'stale', items: [{ id: 'x', name: 'X', price: 9 }] }],
        ['null', null],
    ])('a failed read (%s) adds nothing', (_label, result) => {
        expect(extractVerifiedFacts([{ name: 'get_menu', result }], T0).facts).toEqual([]);
    });

    it('knowledge readers, MCP and unknown tools are never facts', () => {
        const priced = { results: [{ id: 'faq-1', name: 'Precio', price: 99000 }] };
        expect(extractVerifiedFacts([
            { name: 'search_faqs', result: priced }, { name: 'search_knowledge_base', result: priced },
            { name: 'mcp__crm__lookup', result: priced }, { name: 'made_up_tool', result: priced },
        ], T0).facts).toEqual([]);
    });

    it('an amount with no entity around it stays limited to the call', () => {
        expect(extractVerifiedFacts([{ name: 'get_menu', result: { total: 13500, currency: 'COP' } }], T0).facts).toEqual([]);
    });

    it('availability is bound to its subject and date, with the slots', () => {
        const { facts } = extractVerifiedFacts([{ name: 'check_availability', args: { serviceId: 'svc-1', date: '2026-10-23' },
            result: { available: true, serviceName: 'Corte', slots: [{ time: '16:00' }, { time: '17:00' }] } }], T0);
        expect(facts).toEqual([expect.objectContaining({ kind: 'availability', subject: { type: 'service', id: 'svc-1', name: 'Corte' },
            field: 'available:2026-10-23', value: true, detail: ['16:00', '17:00'],
            expiresAt: new Date(T0.getTime() + FACT_TTL_MS.availability).toISOString() })]);
    });

    it('QA4 precondition: a list of 6 orders read with limit 10 is complete with total 6', () => {
        const orders = Array.from({ length: 6 }, (_, i) => ({ id: `0000000${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, status: 'delivered', total: 30000 + i, currency: 'COP' }));
        const { facts } = extractVerifiedFacts([{ name: 'list_my_orders', args: { limit: 10 }, result: { orders } }], T0);
        const list = facts.find(f => f.kind === 'record_list')!;
        expect(list).toMatchObject({ subject: { type: 'orders', id: 'customer' }, complete: true, total: 6 });
        expect(list.value).toHaveLength(6);
        expect((list.value as string[])[0]).toBe('00000000 delivered');
        expect(facts.filter(f => f.kind === 'record_status')).toHaveLength(6);
        // Without a limit the reader may have cut the list: never claimed complete.
        const capped = extractVerifiedFacts([{ name: 'list_my_orders', result: { orders: orders.slice(0, 5) } }], T0).facts.find(f => f.kind === 'record_list')!;
        expect(capped).toMatchObject({ complete: false, total: 5 });
    });
});

describe('ledger lifetime', () => {
    const turn1 = extractVerifiedFacts([
        { name: 'get_menu', result: MENU },
        { name: 'check_availability', args: { serviceId: 'svc-1', date: '2026-10-23' }, result: { available: true, slots: ['16:00'] } },
        { name: 'list_my_orders', args: { limit: 10 }, result: { orders: [{ id: 'order-1', status: 'preparing' }] } },
    ], T0).facts;
    const ledger = mergeVerifiedFacts([], turn1, [], T0);

    it('TTL per kind: record status 2 min, record list 5 min, availability 10 min, money 24h', () => {
        const kinds = (at: Date) => [...new Set(liveVerifiedFacts(ledger, at).map(f => f.kind))].sort();
        expect(kinds(minutes(1))).toEqual(['attribute', 'availability', 'money', 'record_list', 'record_status']);
        expect(kinds(minutes(3))).toEqual(['attribute', 'availability', 'money', 'record_list']);
        expect(kinds(minutes(6))).toEqual(['attribute', 'availability', 'money']);
        // The 30-minute session boundary does not clear facts: the TTL decides.
        expect(kinds(minutes(35))).toEqual(['attribute', 'money']);
        expect(kinds(minutes(24 * 60 + 1))).toEqual([]);
    });

    it('malformed or future-dated entries are dropped', () => {
        const future = { ...ledger[0], observedAt: minutes(10).toISOString() };
        expect(liveVerifiedFacts([null, 'x', { v: 2 }, future, ledger[0]], T0)).toEqual([ledger[0]]);
        expect(liveVerifiedFacts('not an array', T0)).toEqual([]);
    });

    it('a successful write makes the availability of its subject and the record facts stale; a failed write does not', () => {
        const write = (result: any) => extractVerifiedFacts([{ name: 'create_appointment', args: { serviceId: 'svc-1', date: '2026-10-23', time: '16:00' }, result }], minutes(1));
        const failed = write({ success: false, error: 'slot_taken' });
        expect(failed.invalidations).toEqual([]);
        const done = write({ success: true, appointment: { id: 'apt-1', status: 'confirmed' } });
        const after = mergeVerifiedFacts(ledger, done.facts, done.invalidations, minutes(1));
        expect(after.map(f => f.kind)).not.toContain('availability');
        expect(after.map(f => f.kind)).not.toContain('record_list');
        expect(after.some(f => f.kind === 'money' && f.subject.id === 'dish-paisa')).toBe(true);
    });

    it('a newer read of the same subject and field replaces the older one', () => {
        const repriced = extractVerifiedFacts([{ name: 'get_menu', result: { items: [{ ...MENU.items[0], price: 14000 }] } }], minutes(5)).facts;
        const after = mergeVerifiedFacts(ledger, repriced, [], minutes(5));
        expect(after.filter(f => f.kind === 'money' && f.subject.id === 'dish-paisa').map(f => f.value)).toEqual([14000]);
    });
});

describe('restaurant case: turn 1 get_menu, turn 2 quotes 13.500 from the ledger without reading', () => {
    const ledger = mergeVerifiedFacts([], extractVerifiedFacts([{ name: 'get_menu', result: MENU }], T0, 'msg-1').facts, [], T0);
    const views = verifiedFactViews(liveVerifiedFacts(ledger, minutes(2)), minutes(2));

    it('turn 2 prompt carries the fact (subject, value, source, age) in <turn>, outside the cacheable prefix', () => {
        const { systemPrompt, cachePrefixChars } = assembler.assembleWithCacheBoundary({} as any, turnContext({ verifiedFacts: views }));
        const block = systemPrompt.slice(systemPrompt.indexOf('<verified_facts>'), systemPrompt.indexOf('</verified_facts>'));
        expect(systemPrompt.indexOf('<verified_facts>')).toBeGreaterThan(cachePrefixChars);
        expect(block).toContain('kind="money" subject_type="menu_item" subject_id="dish-paisa" subject="Bandeja paisa" field="price" value="13500" currency="COP" price_status="confirmed" source="get_menu" age_minutes="2"');
    });

    it('the price guardrail accepts 13.500 COP for the bandeja paisa with no read this turn', () => {
        const reply = 'La bandeja paisa cuesta 13.500 COP.';
        expect(validator.validatePrices(reply, EMPTY_CORPUS).ok).toBe(false);
        expect(validator.validatePrices(reply, EMPTY_CORPUS, { facts: views }).ok).toBe(true);
        // «¿y cuánto era?»: the reply does not name the dish, the customer did.
        expect(validator.validatePrices('Son 13.500 COP.', EMPTY_CORPUS, { facts: views, customerText: '¿y cuánto era la bandeja paisa?' }).ok).toBe(true);
        expect(enforceVerifiedPriceReply(reply, EMPTY_CORPUS, '<language>es</language>', validator, { facts: views }).blocked).toBe(false);
    });

    it('an invented amount is still rejected, and so is an expired fact', () => {
        expect(validator.validatePrices('La bandeja paisa cuesta 15.000 COP.', EMPTY_CORPUS, { facts: views })).toEqual({ ok: false, hallucinatedPrices: [15000] });
        const expired = verifiedFactViews(liveVerifiedFacts(ledger, minutes(24 * 60 + 1)), minutes(24 * 60 + 1));
        expect(validator.validatePrices('La bandeja paisa cuesta 13.500 COP.', EMPTY_CORPUS, { facts: expired }).ok).toBe(false);
    });

    it('a non-confirmed price in the ledger never validates an amount', () => {
        const example = verifiedFactViews(mergeVerifiedFacts([], extractVerifiedFacts([{ name: 'get_menu',
            result: { items: [{ id: 'dish-x', name: 'Sancocho', price: 9000, priceStatus: 'example', currency: 'COP' }] } }], T0).facts, [], T0), T0);
        expect(example).toEqual([expect.objectContaining({ priceStatus: 'example' })]);
        expect(validator.validatePrices('El sancocho cuesta 9.000 COP.', EMPTY_CORPUS, { facts: example }).ok).toBe(false);
    });
});

describe('subject binding', () => {
    const views = verifiedFactViews(mergeVerifiedFacts([], extractVerifiedFacts([{ name: 'list_properties', result: ROOMS }], T0).facts, [], T0), T0);

    it('the room A price does not validate the same number said for room B', () => {
        expect(validator.validatePrices('La Habitación A cuesta 200.000 COP por noche.', EMPTY_CORPUS, { facts: views }).ok).toBe(true);
        expect(validator.validatePrices('La Habitación B cuesta 200.000 COP por noche.', EMPTY_CORPUS, { facts: views }))
            .toEqual({ ok: false, hallucinatedPrices: [200000] });
        expect(validator.validatePrices('Habitación A: 200.000 COP. Habitación B: 250.000 COP.', EMPTY_CORPUS, { facts: views }).ok).toBe(true);
        expect(validator.validatePrices('Habitación A: 250.000 COP\nHabitación B: 200.000 COP', EMPTY_CORPUS, { facts: views }).ok).toBe(false);
    });

    it('an unnamed amount follows the subject the customer asked about', () => {
        expect(validator.validatePrices('Cuesta 200.000 COP por noche.', EMPTY_CORPUS, { facts: views, customerText: '¿y la habitación B?' }).ok).toBe(false);
        expect(validator.validatePrices('Cuesta 250.000 COP por noche.', EMPTY_CORPUS, { facts: views, customerText: '¿y la habitación B?' }).ok).toBe(true);
    });

    it('a currency that differs from the fact is not backed', () => {
        expect(validator.validatePrices('La Habitación A cuesta 200.000 USD.', EMPTY_CORPUS, { facts: views }).ok).toBe(false);
    });
});

describe('prompt and flag', () => {
    const rule = (prompt: string, start: string, end: string) => prompt.slice(prompt.indexOf(start), prompt.indexOf(end));

    it('flag off (no verifiedFacts key): the prompt is byte-identical to the one without the ledger', () => {
        const before = assembler.assemble({} as any, turnContext());
        const off = assembler.assemble({} as any, turnContext({ verifiedFacts: undefined }));
        expect(off).toBe(before);
        expect(off).not.toContain('verified_facts');
        expect(rule(off, '22a.', '22b.')).toContain('For a current price, read it from a catalogue result of THIS turn');
        expect(off).not.toContain('22c.');
    });

    it('flag on: 22a accepts a confirmed amount present in <verified_facts> or read in this turn; 22b and 22c follow', () => {
        const on = assembler.assemble({} as any, turnContext({ verifiedFacts: [] }));
        expect(on).not.toContain('<verified_facts>');
        const a = rule(on, '22a.', '22b.');
        expect(a).toContain('and any money fact in &lt;turn&gt;&lt;verified_facts&gt; whose price_status is "confirmed", DOES give you its amount');
        expect(a).toContain('use the amount present in &lt;turn&gt;&lt;verified_facts&gt; for that same subject or read it from a catalogue result of THIS turn');
        expect(a).toContain('valid only for its own subject');
        expect(rule(on, '22b.', '22c.')).toContain('use the confirmed amount of that package in &lt;turn&gt;&lt;verified_facts&gt;');
        expect(rule(on, '22c.', '22. NEVER CONVERT')).toContain('The conversation history is not a source of facts');
        // Everything else in the contract is unchanged.
        const off = assembler.assemble({} as any, turnContext());
        const strip = (prompt: string) => prompt.replace(/ {2}22a\.[^\n]*\n {2}22b\.[^\n]*\n( {2}22c\.[^\n]*\n)?/, '');
        expect(strip(on)).toBe(strip(off));
    });
});
