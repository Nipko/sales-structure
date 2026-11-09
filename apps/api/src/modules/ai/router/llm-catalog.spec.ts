import {
    activeLlmCatalog, catalogContent, catalogHeadChanges, catalogIntegrityProblems, catalogModel, CATALOG_ROLES, parseLlmCatalogSnapshot,
    roleModel, roleModelForProvider, roleModels, sameCatalogContent, SEED_LLM_CATALOG, setActiveLlmCatalog, type LlmCatalogSnapshot,
} from './llm-catalog';
import { rehearsalJudgeDefaultModel } from '../../rehearsal/rehearsal-judge';
import { evidenceVerifierModel } from '../../conversations/runtime/evidence-verifier';

function withChanges(change: (draft: { models: any[]; chains: any; roles: any }) => void): LlmCatalogSnapshot {
    const draft = JSON.parse(JSON.stringify(SEED_LLM_CATALOG));
    change(draft);
    return draft;
}

describe('llm-catalog (ADR-0030 fases 1 y 2)', () => {
    afterEach(() => setActiveLlmCatalog(SEED_LLM_CATALOG));

    it('la versión activa es la semilla de código', () => {
        expect(activeLlmCatalog()).toBe(SEED_LLM_CATALOG);
        expect(activeLlmCatalog().version).toBe('seed');
    });

    it('la semilla es coherente: sin problemas de integridad', () => {
        expect(catalogIntegrityProblems(SEED_LLM_CATALOG)).toEqual([]);
    });

    it('la semilla está congelada', () => {
        expect(Object.isFrozen(SEED_LLM_CATALOG.models)).toBe(true);
        expect(Object.isFrozen(SEED_LLM_CATALOG.models[0])).toBe(true);
        expect(Object.isFrozen(SEED_LLM_CATALOG.chains.conversation)).toBe(true);
        expect(Object.isFrozen(SEED_LLM_CATALOG.roles.vision)).toBe(true);
    });

    it('los roles conservan los modelos que antes estaban escritos en cada servicio', () => {
        expect(roleModel('aux_reasoning')).toBe('gpt-6-luna');
        expect(roleModel('aux_cheap')).toBe('deepseek-flash');
        expect(roleModel('judge_rehearsal')).toBe('deepseek-flash');
        expect(roleModel('judge_quality')).toBe('gpt-6-luna');
        expect(roleModels('vision')).toEqual(['gemini-3.5-flash-lite', 'grok-4.3', 'gpt-6-luna']);
        for (const role of CATALOG_ROLES) expect(roleModels(role).length).toBeGreaterThan(0);
    });

    it('roleModelForProvider toma el primer modelo del rol de ese proveedor', () => {
        expect(roleModelForProvider('vision', 'google')).toBe('gemini-3.5-flash-lite');
        expect(roleModelForProvider('vision', 'xai')).toBe('grok-4.3');
        expect(roleModelForProvider('vision', 'openai')).toBe('gpt-6-luna');
        expect(roleModelForProvider('vision', 'anthropic')).toBeUndefined();
        expect(roleModelForProvider('aux_reasoning', 'openai')).toBe('gpt-6-luna');
    });

    it('catalogModel busca por id en la versión activa', () => {
        expect(catalogModel('gpt-6-luna')?.provider).toBe('openai');
        expect(catalogModel('gpt-4o-mini')).toBeUndefined();
    });

    describe('catalogIntegrityProblems detecta un catálogo roto', () => {
        it('cadena o rol que apunta a un modelo inexistente', () => {
            const broken = withChanges(d => { d.chains.conversation.push('gpt-9'); d.roles.aux_cheap = ['nope']; });
            expect(catalogIntegrityProblems(broken)).toEqual(expect.arrayContaining([
                'chain_unknown_model:conversation:gpt-9', 'role_unknown_model:aux_cheap:nope',
            ]));
        });
        it('modelo sin precio, sin precio de caché o de una familia desconocida', () => {
            const broken = withChanges(d => {
                d.models.push({ id: 'gpt-7-luna', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0, costInPer1k: 0,
                    costOutPer1k: 0.001, maxContextTokens: 1000, supportsTools: true });
            });
            expect(catalogIntegrityProblems(broken)).toEqual(expect.arrayContaining([
                'missing_price:gpt-7-luna', 'missing_cache_price:gpt-7-luna', 'unknown_family:openai:gpt-7-luna',
            ]));
        });
        it('cadena de un solo proveedor (lección del 8-nov: OpenAI sin créditos)', () => {
            const broken = withChanges(d => { d.chains.tool_calling = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-6-sol']; });
            expect(catalogIntegrityProblems(broken)).toContain('chain_single_provider:tool_calling');
        });
        it('cabeza de tool_calling sin herramientas', () => {
            const broken = withChanges(d => { d.chains.tool_calling.unshift('gemini-3.5-flash-lite'); });
            expect(catalogIntegrityProblems(broken)).toContain('tool_calling_head_without_tools:gemini-3.5-flash-lite');
        });
        it('el juez del ensayo no puede encabezar una cadena que evalúa', () => {
            const broken = withChanges(d => { d.chains.classify.unshift('deepseek-flash'); });
            expect(catalogIntegrityProblems(broken)).toContain('judge_heads_chain:classify:deepseek-flash');
        });
        it('modelo retirado: no puede estar en cadenas ni roles, pero conserva su precio y su familia no importa', () => {
            const broken = withChanges(d => { d.models.find((m: any) => m.id === 'gpt-5.6-luna').retired = true; });
            expect(catalogIntegrityProblems(broken)).toEqual(expect.arrayContaining([
                'retired_in_chain:conversation:gpt-5.6-luna', 'retired_in_chain:tool_calling:gpt-5.6-luna', 'retired_in_chain:classify:gpt-5.6-luna',
            ]));
            const retiredOld = withChanges(d => {
                d.models.push({ id: 'gpt-4o-mini', provider: 'openai', tier: 'tier_4_budget', costPer1kTokens: 0.0004, costInPer1k: 0.00015,
                    costOutPer1k: 0.0006, costCachedInPer1k: 0.000075, maxContextTokens: 128000, supportsTools: true, retired: true });
            });
            expect(catalogIntegrityProblems(retiredOld)).toEqual([]);
        });
        it('cabeza de tool_calling fuera de los tiers que pueden liderar', () => {
            const broken = withChanges(d => { d.chains.tool_calling.unshift(d.chains.tool_calling.splice(3, 1)[0]); });
            expect(catalogIntegrityProblems(broken)).toContain('tool_calling_head_tier:deepseek-flash:tier_4_budget');
        });
        it('precio sin fuente ni fecha de verificación', () => {
            const broken = withChanges(d => { delete d.models[0].priceSourceUrl; d.models[1].priceCheckedAt = 'ayer'; });
            expect(catalogIntegrityProblems(broken)).toEqual(expect.arrayContaining([
                `missing_price_source:${SEED_LLM_CATALOG.models[0].id}`, `missing_price_checked_at:${SEED_LLM_CATALOG.models[1].id}`,
            ]));
        });
        it('rol vacío y modelo duplicado', () => {
            const broken = withChanges(d => { d.roles.vision = []; d.models.push({ ...d.models[0] }); });
            expect(catalogIntegrityProblems(broken)).toEqual(expect.arrayContaining([
                'empty_role:vision', `duplicate_model:${SEED_LLM_CATALOG.models[0].id}`,
            ]));
        });
    });

    describe('versiones (fase 2)', () => {
        it('el contenido de la semilla se lee de vuelta igual (lo que se guarda como versión 1)', () => {
            const parsed = parseLlmCatalogSnapshot(JSON.parse(JSON.stringify(catalogContent(SEED_LLM_CATALOG))), '1');
            expect(parsed.problems).toEqual([]);
            expect(parsed.snapshot!.version).toBe('1');
            expect(sameCatalogContent(parsed.snapshot!, SEED_LLM_CATALOG)).toBe(true);
            expect(Object.isFrozen(parsed.snapshot!.models[0])).toBe(true);
        });

        it('parseLlmCatalogSnapshot rechaza la forma equivocada y descarta campos ajenos', () => {
            expect(parseLlmCatalogSnapshot(null, 'x').problems).toEqual(['snapshot_not_object']);
            const content: any = catalogContent(SEED_LLM_CATALOG);
            content.models[0].provider = 'mistral';
            content.models[1].costOutPer1k = '0.1';
            content.models[2].tier = 'tier_9';
            content.chains.summarize = ['gpt-6-luna'];
            content.roles.vision = 'gpt-6-luna';
            expect(parseLlmCatalogSnapshot(content, 'x').problems).toEqual(expect.arrayContaining([
                `model_unknown_provider:${content.models[0].id}:mistral`, `model_bad_costOutPer1k:${content.models[1].id}`,
                `model_bad_tier:${content.models[2].id}`, 'unknown_chain:summarize', 'role_not_list:vision',
            ]));
            const extra: any = catalogContent(SEED_LLM_CATALOG);
            extra.models[0].note = 'campo ajeno';
            expect((parseLlmCatalogSnapshot(extra, 'x').snapshot!.models[0] as any).note).toBeUndefined();
        });

        it('catalogHeadChanges sólo ve cabezas, no reordenamientos detrás', () => {
            const reordered = withChanges(d => { d.chains.conversation.push(d.chains.conversation.splice(1, 1)[0]); });
            expect(catalogHeadChanges(SEED_LLM_CATALOG, reordered)).toEqual([]);
            const newHead = withChanges(d => { d.chains.classify.unshift(d.chains.classify.splice(1, 1)[0]); d.roles.vision.reverse(); });
            expect(catalogHeadChanges(SEED_LLM_CATALOG, newHead)).toEqual([
                'chain:classify:gemini-3.5-flash-lite->gpt-5.6-luna', 'role:vision:gemini-3.5-flash-lite->gpt-6-luna',
            ]);
        });

        it('publicar otra versión cambia lo que leen roles, jueces y verificador sin reiniciar', () => {
            const next = parseLlmCatalogSnapshot(withChanges(d => {
                d.roles.judge_rehearsal = ['gpt-5.6-luna']; d.roles.aux_reasoning = ['gpt-6-sol']; d.chains.classify.unshift('claude-haiku-5-5');
                d.chains.classify = [...new Set(d.chains.classify)];
            }), '2').snapshot!;
            setActiveLlmCatalog(next);
            expect(activeLlmCatalog().version).toBe('2');
            expect(roleModel('aux_reasoning')).toBe('gpt-6-sol');
            expect(rehearsalJudgeDefaultModel()).toBe('gpt-5.6-luna');
            expect(evidenceVerifierModel()).toBe('claude-haiku-5-5');
        });
    });
});
