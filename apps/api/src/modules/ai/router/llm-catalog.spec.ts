import {
    activeLlmCatalog, catalogIntegrityProblems, catalogModel, CATALOG_ROLES, roleModel, roleModelForProvider, roleModels,
    SEED_LLM_CATALOG, type LlmCatalogSnapshot,
} from './llm-catalog';

function withChanges(change: (draft: { models: any[]; chains: any; roles: any }) => void): LlmCatalogSnapshot {
    const draft = JSON.parse(JSON.stringify(SEED_LLM_CATALOG));
    change(draft);
    return draft;
}

describe('llm-catalog (ADR-0030 fase 1)', () => {
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
        it('rol vacío y modelo duplicado', () => {
            const broken = withChanges(d => { d.roles.vision = []; d.models.push({ ...d.models[0] }); });
            expect(catalogIntegrityProblems(broken)).toEqual(expect.arrayContaining([
                'empty_role:vision', `duplicate_model:${SEED_LLM_CATALOG.models[0].id}`,
            ]));
        });
    });
});
