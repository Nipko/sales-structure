import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';

describe('service modality prefetch stays within service-location questions', () => {
    it.each([
        ['SERVICEDOM_A_PAYMENT_ES', 'Puedo pagar en linea?'],
        ['SERVICEDOM_A_PAYMENT_EN', 'Is online payment accepted?'],
        ['SERVICEDOM_A_PAYMENT_PT', 'Posso fazer o pagamento online?'],
        ['SERVICEDOM_B_SHIPPING', 'Que modalidad de envio tiene mi pedido?'],
        ['SERVICEDOM_B_EMPLOYMENT', 'Do you have remote job vacancies?'],
        ['SERVICEDOM_B_INVOICE', 'Que modalidad de facturacion utilizan?'],
    ])('%s does not prefetch service location for %s', async (_id, message) => {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 6, config_json: {
            language: 'es', industry: 'peluqueria', rag: { enabled: false }, llm: {},
        } });
        publishTools(f, ['list_services']);
        f.toolExecutor.execute.mockResolvedValue({ services: [{ name: 'Synthetic service',
            appointmentTerms: { locationType: 'in_person', locationAddress: 'Synthetic service address' } }] });
        const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        expect(result.debug.runtimeError).toBeUndefined();
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(1);
        const messages = f.llmRouter.execute.mock.calls[0][0].messages;
        expect(messages.some((m: any) => m.role === 'tool' && m.content.includes('Synthetic service address'))).toBe(false);
    });
});
