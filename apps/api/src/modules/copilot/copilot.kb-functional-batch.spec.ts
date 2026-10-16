import * as fs from 'fs';
import * as path from 'path';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

/**
 * Local isolated batch; preregistered before first Jest. Run with the dedicated
 * configuration that excludes globalSetup and database worker setup.
 *
 * Real controller -> real chat/search/parser/files -> captured LLM request.
 * No service helper, retrieval result or article content is stubbed.
 * Infrastructure is an explicit read-only fixture adapter, NOT real Prisma/Redis.
 * The LLM is the only generated-response boundary and returns a fixed sentinel.
 * Assessment/configuration/operations/channel providers are deliberately absent:
 * no quality repair, canonical-table ensure, draft/proposal or payment path runs.
 * No HTTP guards/session persistence, browser, production, model or SQL is tested.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SENTINEL = 'LOCAL_ASSIST_REPLY_SENTINEL';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
type Role = 'tenant_admin' | 'tenant_supervisor' | 'tenant_agent';
type Mode = 'immediate' | 'reviewed';
const API_ROOT = path.resolve(__dirname, '../../..');
const KB_ROOT = path.join(API_ROOT, 'kb', 'assistant');
const MESSAGES_ROOT = path.resolve(API_ROOT, '../dashboard/messages');

interface ArticleSource { id: string; title: string; roles: string[]; body: string }
function articleSource(locale: Locale): ArticleSource {
    const raw = fs.readFileSync(path.join(KB_ROOT, locale, '06-agentes-ia.md'), 'utf8');
    const parsed = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!parsed) throw new Error('Real agent KB front matter is unavailable: ' + locale);
    const metadata = parsed[1];
    const id = metadata.match(/^id:\s*(.+)$/m)?.[1]?.trim();
    const title = metadata.match(/^title:\s*"([^"]+)"\s*$/m)?.[1];
    const rolesText = metadata.match(/^roles:\s*(\[.*\])\s*$/m)?.[1];
    if (id !== 'agentes-ia' || !title || !rolesText) throw new Error('Invalid real agent KB metadata: ' + locale);
    return { id, title, roles: JSON.parse(rolesText), body: parsed[2].trim() };
}

const QUERIES: Record<Locale, { fallback: string; save: string; unassigned: string }> = {
    es: {
        fallback: '¿Cómo configuro el mensaje cuando el agente no puede responder sin prometer un traspaso?',
        save: '¿Cómo guardar los cambios de mi agente y cuándo empieza a responder con ellos?',
        unassigned: '¿Quién responde en canales sin agente asignado si hay un agente predeterminado activo?',
    },
    en: {
        fallback: 'How do I configure the agent fallback message when it cannot answer without promising a handoff?',
        save: 'How do I save my agent changes and when does it start replying with them?',
        unassigned: 'Who replies on unassigned channels when an active default agent exists?',
    },
    pt: {
        fallback: 'Como configurar a mensagem para quando o agente não souber responder sem prometer uma transferência?',
        save: 'Como salvar as alterações do meu agente e quando ele começa a responder com elas?',
        unassigned: 'Quem responde nos canais sem agente atribuído quando existe um agente padrão ativo?',
    },
    fr: {
        fallback: 'Comment configurer le message de repli quand l’agent ne peut pas répondre sans promettre un transfert ?',
        save: 'Comment enregistrer les modifications de mon agent et quand commence-t-il à répondre avec elles ?',
        unassigned: 'Qui répond sur les canaux sans agent assigné quand un agent par défaut actif existe ?',
    },
};

const SEMANTICS: Record<Locale, {
    fallbackLine: RegExp; noPromise: RegExp; unsafePromise: RegExp;
    activeDefault: RegExp; absentDefault: RegExp; optionalReviewed: RegExp; replyLanguage: string;
}> = {
    es: {
        fallbackLine: /^-\s+\*\*Mensaje cuando no puede responder\*\*/i,
        noPromise: /sin\s+prometer|no\s+promet(?:as|er)/i,
        unsafePromise: /conviene que prometa buscar a una persona/i,
        activeDefault: /agente predeterminado activo/i,
        absentDefault: /si no hay un agente predeterminado activo/i,
        optionalReviewed: /modo revisado\s*\(opcional\)/i,
        replyLanguage: 'español latinoamericano',
    },
    en: {
        fallbackLine: /^-\s+\*\*Message (?:for when it cannot answer|when unable to respond)\*\*/i,
        noPromise: /without\s+promising|do not\s+promise|don't\s+promise/i,
        unsafePromise: /promising to find a person beats improvising/i,
        activeDefault: /active default agent/i,
        absentDefault: /if there is no active default agent/i,
        optionalReviewed: /reviewed mode\s*\(optional\)/i,
        replyLanguage: 'English',
    },
    pt: {
        fallbackLine: /^-\s+\*\*Mensagem (?:para quando não souber responder|quando não consegue responder)\*\*/i,
        noPromise: /sem\s+prometer|n[aã]o\s+promet(?:a|er)/i,
        unsafePromise: /melhor prometer buscar uma pessoa/i,
        activeDefault: /agente padr[aã]o ativo/i,
        absentDefault: /se n[aã]o houver um agente padr[aã]o ativo/i,
        optionalReviewed: /modo revisado\s*\(opcional\)/i,
        replyLanguage: 'português brasileiro',
    },
    fr: {
        fallbackLine: /^-\s+\*\*Message (?:lorsqu'il ne peut pas répondre|quand il ne peut pas répondre)\*\*/i,
        noPromise: /sans\s+promettre|ne pas\s+promettre/i,
        unsafePromise: /promettre de chercher une personne vaut mieux/i,
        activeDefault: /agent par d[ée]faut actif/i,
        absentDefault: /s'il n'y a pas d'agent par d[ée]faut actif/i,
        optionalReviewed: /mode r[ée]vis[ée]\s*\(facultatif\)/i,
        replyLanguage: 'français',
    },
};

interface FixtureHarness {
    controller: CopilotController;
    execute: jest.Mock;
    tenantRead: jest.Mock;
    planCatalogRead: jest.Mock;
    verticalRead: jest.Mock;
    unexpected: string[];
}
function strictObject(name: string, properties: Record<string, unknown>, unexpected: string[]) {
    return new Proxy(properties, {
        get(target, property) {
            if (typeof property !== 'string') return undefined;
            if (Object.prototype.hasOwnProperty.call(target, property)) return target[property];
            const attempted = name + '.' + property;
            unexpected.push(attempted);
            throw new Error('Forbidden fixture adapter access: ' + attempted);
        },
    });
}

function harness(mode: Mode): FixtureHarness {
    const unexpected: string[] = [];
    const tenantRead = jest.fn(async () => ({ settings: mode === 'reviewed' ? { agentReviewMode: 'reviewed' } : {} }));
    // No live billing catalog is represented; the real helper takes its no-data
    // branch and never calls throttle. This does not certify plan-aware advice.
    const planCatalogRead = jest.fn(async () => []);
    const verticalRead = jest.fn(async () => null);
    const execute = jest.fn(async () => ({
        content: SENTINEL,
        routingDecision: { selectedModel: { id: 'local-llm-boundary-stub' } },
        usage: { totalTokens: 0 },
    }));
    const prisma = strictObject('prisma', {
        tenant: strictObject('prisma.tenant', { findUnique: tenantRead }, unexpected),
        billingPlan: strictObject('prisma.billingPlan', { findMany: planCatalogRead }, unexpected),
    }, unexpected);
    const forbidden = (name: string) => strictObject(name, {}, unexpected);
    const service = new CopilotService(
        forbidden('config') as any,
        prisma as any,
        forbidden('redis') as any,
        strictObject('llm', { execute }, unexpected) as any,
        forbidden('knowledge') as any,
        forbidden('throttle') as any,
        strictObject('verticals', { getVerticalConfig: verticalRead }, unexpected) as any,
        null as any, // rate limiter: no HTTP guard is invoked here
        null as any, // quality: prevent automatic repair/channel provider
        null as any, // quality signals
        null as any, // assessment: prevent transitive readiness/DDL
        null as any, // configuration proposals
        null as any, // content operation proposals and canonical-table ensure
    );
    return { controller: new CopilotController(service), execute, tenantRead, planCatalogRead, verticalRead, unexpected };
}

async function chat(fixture: FixtureHarness, locale: Locale, message: string, role: Role = 'tenant_admin') {
    const result = await fixture.controller.chat(
        { message, page: '/admin/agent/' + AGENT, locale, history: [] },
        { user: { sub: ACTOR, role, firstName: 'Synthetic QA' } },
        TENANT,
    );
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    const call = fixture.execute.mock.calls[0][0] as {
        task: string; tenantId: string; messages: Array<{ role: string; content: string }>;
        systemPrompt: string; tools?: unknown[]; temperature: number; maxTokens: number;
    };
    expect(call).toMatchObject({
        task: 'conversation', tenantId: TENANT,
        messages: [{ role: 'user', content: message }], temperature: 0.4, maxTokens: 800,
    });
    expect(call.tools ?? []).toEqual([]);
    expect(call.systemPrompt).toContain('Rol autenticado: ' + role);
    expect(call.systemPrompt).toContain('responde SIEMPRE en ' + SEMANTICS[locale].replyLanguage);
    expect(fixture.tenantRead.mock.calls).toEqual([[{ where: { id: TENANT }, select: { settings: true } }]]);
    expect(fixture.verticalRead.mock.calls).toEqual([[TENANT]]);
    expect(fixture.planCatalogRead).toHaveBeenCalledTimes(role === 'tenant_admin' ? 1 : 0);
    expect(result).toMatchObject({ success: true, data: { reply: SENTINEL, model: 'local-llm-boundary-stub', tokensUsed: 0 } });
    // These absences are deliberate fixture scope, not claims that production
    // can safely run chat without DDL/side effects or that the LLM is accurate.
    expect(call.systemPrompt).not.toContain('## EVALUACIÓN COMPARTIDA DE CONFIGURACIÓN');
    expect(call.systemPrompt).not.toContain('## PLAN DEL USUARIO');
    return call.systemPrompt;
}

function expectNativeAgentArticle(prompt: string, locale: Locale): ArticleSource {
    const source = articleSource(locale);
    expect(source.roles).toEqual(['tenant_admin']);
    expect(prompt).toContain('### Artículo: ' + source.title);
    expect(prompt).toContain(source.body);
    if (locale !== 'es') expect(prompt).not.toContain(articleSource('es').body);
    return source;
}

function assistedConfigurationRule(prompt: string): string {
    const start = prompt.indexOf('11. **CONFIGURACIÓN ASISTIDA:**');
    const end = prompt.indexOf('11a. **ACOMPAÑAMIENTO PROACTIVO:**', start);
    if (start < 0 || end <= start) throw new Error('Real assisted-configuration rule was not emitted');
    return prompt.slice(start, end);
}

describe.each(LOCALES)('real KB selection to real Assist prompt (%s)', locale => {
    it('product: retrieved fallback guidance does not recommend promising human follow-up', async () => {
        const fixture = harness('immediate');
        const prompt = await chat(fixture, locale, QUERIES[locale].fallback);
        const source = expectNativeAgentArticle(prompt, locale);
        const screenMessages = JSON.parse(fs.readFileSync(path.join(MESSAGES_ROOT, locale + '.json'), 'utf8'));
        const screenGuidance = screenMessages.agent?.validation?.fallbackHelp;
        expect(typeof screenGuidance).toBe('string');
        expect(screenGuidance).toMatch(SEMANTICS[locale].noPromise);
        const fallbackLines = source.body.split(/\r?\n/).filter(line => SEMANTICS[locale].fallbackLine.test(line));
        expect(fallbackLines.length).toBeGreaterThan(0);
        // Check the specific fallback instruction, not a distant disclaimer
        // elsewhere in the article or an arbitrary echoed model response.
        expect(fallbackLines.some(line => SEMANTICS[locale].noPromise.test(line))).toBe(true);
        expect(fallbackLines.some(line => SEMANTICS[locale].unsafePromise.test(line))).toBe(false);
    });

    it('control: real agent help and the authenticated immediate-mode rule reach the same prompt', async () => {
        const prompt = await chat(harness('immediate'), locale, QUERIES[locale].save);
        const source = expectNativeAgentArticle(prompt, locale);
        expect(source.body).toMatch(SEMANTICS[locale].optionalReviewed);
        const rule = assistedConfigurationRule(prompt);
        expect(rule).toMatch(/esta cuenta aplica los cambios del agente al guardarlos/i);
        expect(rule).toMatch(/guardar y aplicar[^.]*de inmediato/i);
        expect(rule).not.toMatch(/guardar crea un borrador/i);
        // The real article legitimately documents BOTH modes. Never ban the
        // word "draft" globally from the full prompt to make this pass.
    });

    it('control: real agent help and the authenticated reviewed-mode exception reach the same prompt', async () => {
        const prompt = await chat(harness('reviewed'), locale, QUERIES[locale].save);
        const source = expectNativeAgentArticle(prompt, locale);
        expect(source.body).toMatch(SEMANTICS[locale].optionalReviewed);
        const rule = assistedConfigurationRule(prompt);
        expect(rule).toMatch(/esta cuenta revisa los cambios antes de aplicarlos/i);
        expect(rule).toMatch(/guardar crea un borrador/i);
        expect(rule).toMatch(/hasta publicar la correcci[oó]n/i);
        expect(rule).not.toMatch(/guardar y aplicar[^.]*de inmediato/i);
    });

    it('control: retrieved unassigned-channel help distinguishes an active default from an absent default', async () => {
        const prompt = await chat(harness('immediate'), locale, QUERIES[locale].unassigned);
        const source = expectNativeAgentArticle(prompt, locale);
        expect(source.body).toMatch(SEMANTICS[locale].activeDefault);
        expect(source.body).toMatch(SEMANTICS[locale].absentDefault);
        // No tenant channel snapshot is fabricated: conceptual help may say
        // how routing works, never assert which channels this fixture has.
        expect(prompt).toContain('No afirmes que no hay canales');
    });

    it.each(['tenant_supervisor', 'tenant_agent'] as const)(
        'control: real selection excludes admin agent instructions for authenticated %s',
        async role => {
            const prompt = await chat(harness('immediate'), locale, QUERIES[locale].fallback, role);
            const source = articleSource(locale);
            expect(source.roles).toEqual(['tenant_admin']);
            expect(prompt).not.toContain('### Artículo: ' + source.title);
            expect(prompt).not.toContain(source.body);
            if (locale !== 'es') {
                const spanish = articleSource('es');
                expect(prompt).not.toContain('### Artículo: ' + spanish.title);
                expect(prompt).not.toContain(spanish.body);
            }
        },
    );
});

