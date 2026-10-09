import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TOOL_FAMILIES } from './agent-tool-registry';
import {
    FLOW_GUIDANCE,
    VerticalTurnContextService,
    verticalFlowGuidance,
    type FlowLanguage,
} from './vertical-turn-context.service';

/**
 * The flow guidance had two copies: this localized table and a Spanish-only one in `conversations.service.ts` that
 * overwrote it on every turn it applied to, so an English, Portuguese or French turn received Spanish guidance and the
 * two drifted apart (the catalogue-empty and search-first rules had to be written twice). There is one copy now; these
 * specs hold it against the tool registry and against the language of the turn.
 */
const LANGUAGES: readonly FlowLanguage[] = ['es', 'en', 'pt', 'fr'];
const FAMILY_KEYS = new Set<string>(TOOL_FAMILIES.map(family => String(family.key)));
const TOOL_NAMES = new Set<string>(TOOL_FAMILIES.flatMap(family => family.tools.map(tool => String(tool.name))));
const toolsNamedIn = (text: string) => [...new Set((text.match(/[a-z]+(?:_[a-z]+)+/g) ?? []).filter(token => TOOL_NAMES.has(token)))].sort();

describe('flow guidance: one localized copy, held against the registry', () => {
    it.each(FLOW_GUIDANCE.map(entry => [`${entry.industry}/${entry.requires}`, entry] as const))('%s has guidance in the four languages naming the same tools', (_name, entry) => {
        expect(FAMILY_KEYS.has(entry.requires)).toBe(true);
        const reference = toolsNamedIn(entry.guidance.es);
        expect(reference.length).toBeGreaterThan(0);
        for (const language of LANGUAGES) {
            expect(entry.guidance[language].trim().length).toBeGreaterThan(40);
            expect(toolsNamedIn(entry.guidance[language])).toEqual(reference);
        }
        // It only names tools the family really has (or tools of the horizontal appointment flow).
        const family = TOOL_FAMILIES.find(candidate => String(candidate.key) === entry.requires)!;
        expect(family.tools.length).toBeGreaterThan(0);
    });

    it('the translations are not the Spanish text copied', () => {
        for (const entry of FLOW_GUIDANCE) {
            for (const language of ['en', 'pt', 'fr'] as const) {
                expect(entry.guidance[language]).not.toBe(entry.guidance.es);
            }
        }
    });

    it.each(FLOW_GUIDANCE.map(entry => [`${entry.industry}/${entry.requires}`, entry] as const))('%s: each language gets its own text, and only with the tool enabled', (_name, entry) => {
        const enabled = { [entry.requires]: { enabled: true } };
        for (const language of LANGUAGES) {
            expect(verticalFlowGuidance(entry.industry, enabled, language)).toContain(entry.guidance[language]);
        }
        expect(verticalFlowGuidance(entry.industry, {}, 'en')).toBeUndefined();
        expect(verticalFlowGuidance(entry.industry, { [entry.requires]: { enabled: false } }, 'en')).toBeUndefined();
        expect(verticalFlowGuidance('no_such_industry', enabled, 'en')).toBeUndefined();
    });

    describe('the turn resolves the guidance in the language of the turn', () => {
        const build = () => {
            const verticals = {
                getVerticalConfig: jest.fn().mockResolvedValue({ industry: 'inmobiliaria', subType: 'venta', terminology: null }),
            };
            const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) } };
            return new VerticalTurnContextService(prisma as any, verticals as any);
        };
        const toolsConfig = { realEstate: { enabled: true } };
        const entry = FLOW_GUIDANCE.find(candidate => candidate.industry === 'inmobiliaria')!;

        it.each(LANGUAGES)('language %s', async (language) => {
            const context = await build().resolve({ tenantId: 't1', language, toolsConfig });
            expect(context?.industryGuidance).toBe(entry.guidance[language]);
        });

        it('a regional code such as en-US or pt-BR selects the base language; an unknown one falls back to Spanish', async () => {
            expect((await build().resolve({ tenantId: 't1', language: 'en-US', toolsConfig }))?.industryGuidance).toBe(entry.guidance.en);
            expect((await build().resolve({ tenantId: 't1', language: 'pt-BR', toolsConfig }))?.industryGuidance).toBe(entry.guidance.pt);
            expect((await build().resolve({ tenantId: 't1', language: 'de', toolsConfig }))?.industryGuidance).toBe(entry.guidance.es);
        });
    });

    it('conversations.service.ts no longer keeps a Spanish-only copy nor writes industryGuidance itself', () => {
        const source = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        expect(source).not.toContain('VERTICAL_FLOW_GUIDANCE');
        expect(source).not.toMatch(/export function verticalFlowGuidance/);
        expect(source).not.toMatch(/industryGuidance:\s*guidance/);
    });
});
