import { PipelineService, resolveTenantNativeStage, resolveConversationalProgressStage, type TenantStageMapping } from './pipeline.service';

const dental: TenantStageMapping[] = [
    { slug: 'consulta_inicial', position: 0, prob: 10, is_terminal: false, terminal_outcome: null },
    { slug: 'cita_agendada', position: 1, prob: 30, is_terminal: false, terminal_outcome: null },
    { slug: 'primera_visita', position: 2, prob: 50, is_terminal: false, terminal_outcome: null },
    { slug: 'paciente_activo', position: 3, prob: 80, is_terminal: false, terminal_outcome: null },
    { slug: 'seguimiento', position: 4, prob: 90, is_terminal: false, terminal_outcome: null },
    { slug: 'alta', position: 5, prob: 100, is_terminal: true, terminal_outcome: 'won' },
    { slug: 'no_continuo', position: 6, prob: 0, is_terminal: true, terminal_outcome: 'lost' },
];
const retail: TenantStageMapping[] = [
    { slug: 'interesado', position: 0, prob: 10, is_terminal: false, terminal_outcome: null },
    { slug: 'cotizacion', position: 1, prob: 30, is_terminal: false, terminal_outcome: null },
    { slug: 'pedido', position: 2, prob: 60, is_terminal: false, terminal_outcome: null },
    { slug: 'enviado', position: 3, prob: 80, is_terminal: false, terminal_outcome: null },
    { slug: 'entregado', position: 4, prob: 100, is_terminal: true, terminal_outcome: 'won' },
    { slug: 'devolucion', position: 5, prob: 0, is_terminal: true, terminal_outcome: 'lost' },
];
async function run(stages: TenantStageMapping[], current: string, messageText: string, sentiment = 50, lang = 'es') {
    const s: any = Object.create(PipelineService.prototype);
    s.getTenantSchema = jest.fn().mockResolvedValue('tenant_unit');
    s.getTenantStageCatalog = jest.fn().mockResolvedValue(stages);
    s.isAutoProgressEnabled = jest.fn().mockResolvedValue(true);
    s.prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([{ opp_id: 'op', opp_stage: current, lead_id: 'lead' }]) };
    s.evaluateRulesForLead = jest.fn().mockResolvedValue(undefined);
    s.writeLeadStage = jest.fn().mockResolvedValue(undefined);
    s.logger = { log: jest.fn(), warn: jest.fn() };
    await s.autoProgressFromConversation('tenant', 'conversation', { messageText, sentiment, lang, isCustomerReply: true });
    return s;
}
describe('conversational signals cannot manufacture a domain milestone', () => {
    it.each([
        [dental, 'consulta_inicial', '¿Cuál es la tarifa confirmada de Control y seguimiento? Solo necesito información.'],
        [retail, 'cotizacion', '¿Cuál es el precio actual y cuántas unidades hay de Spark QA Camiseta 20261018T090055Z? Solo necesito información.'],
    ] as const)('does not advance %s from %s on an informational price question', async (stages, current, text) => {
        const s = await run([...stages], current, text);
        expect(s.writeLeadStage).not.toHaveBeenCalled();
    });
    it.each([
        ['es', 'precio'], ['en', 'price'], ['pt', 'preço'], ['fr', 'prix'],
    ])('does not turn positive sentiment into an actual shipment for %s', async (lang, text) => {
        const s = await run(retail, 'cotizacion', text, 10, lang);
        expect(s.writeLeadStage).not.toHaveBeenCalled();
    });
    it('purchase language alone does not prove an appointment, visit or completed treatment', async () => {
        const s = await run(dental, 'consulta_inicial', 'quiero reservar');
        expect(s.writeLeadStage).not.toHaveBeenCalled();
    });
    it('retains legitimate generic qualification and readiness without calling them orders', async () => {
        const stages: TenantStageMapping[] = [
            { slug: 'contactado', position: 0, prob: 20, is_terminal: false, terminal_outcome: null },
            { slug: 'calificado', position: 1, prob: 50, is_terminal: false, terminal_outcome: null },
            { slug: 'listo_para_cierre', position: 2, prob: 95, is_terminal: false, terminal_outcome: null },
        ];
        expect((await run(stages, 'contactado', 'precio')).writeLeadStage).toHaveBeenCalledWith('tenant', 'lead', 'calificado', expect.anything());
        expect((await run(stages, 'calificado', 'quiero comprar')).writeLeadStage).toHaveBeenCalledWith('tenant', 'lead', 'listo_para_cierre', expect.anything());
    });
    it('retains a stage explicitly labelled with a supported qualification synonym', async () => {
        const stages = [retail[0], { ...retail[1], slug: 'triage', name: 'Qualified' }];
        const s = await run(stages, 'interesado', 'price', 50, 'en');
        expect(s.writeLeadStage).toHaveBeenCalledWith('tenant', 'lead', 'triage', expect.anything());
    });
    it('leaves explicit native resolution for domain commands unchanged', () => {
        expect(resolveTenantNativeStage(retail, 'pedido').slug).toBe('pedido');
        expect(resolveTenantNativeStage(dental, 'cita_agendada').slug).toBe('cita_agendada');
    });
    it('fails closed on ambiguous semantic labels instead of choosing by probability', () => {
        const stages = [
            { ...retail[1], slug: 'triage_a', name: 'Qualified' },
            { ...retail[2], slug: 'triage_b', name: 'Calificado' },
        ];
        expect(resolveConversationalProgressStage(stages, 'calificado')).toBeUndefined();
    });
    it('never uses conversation signals to resolve terminal outcomes', () => {
        expect(resolveConversationalProgressStage(retail, 'ganado')).toBeUndefined();
        expect(resolveConversationalProgressStage(retail, 'perdido')).toBeUndefined();
        expect(resolveConversationalProgressStage([{ ...retail[4], slug: 'calificado' }], 'calificado')).toBeUndefined();
    });
    it('does not write the same semantic stage again', async () => {
        const s = await run([{ ...retail[1], slug: 'calificado' }], 'calificado', 'precio');
        expect(s.writeLeadStage).not.toHaveBeenCalled();
    });
});
