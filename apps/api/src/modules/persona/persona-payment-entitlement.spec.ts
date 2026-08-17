import { PersonaController } from './persona.controller';

describe('PersonaController customer payment entitlement', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const agentId = '22222222-2222-4222-8222-222222222222';
    const paymentConfig = {
        persona: { name: 'Ventas' },
        tools: { payments: { enabled: true, canCreateLinks: true } },
    };

    function makeController(featureResult: boolean | Error) {
        const personaService = {
            savePersonaFromYaml: jest.fn().mockResolvedValue({}),
            createAgent: jest.fn().mockResolvedValue({ id: agentId }),
            updateAgent: jest.fn().mockResolvedValue({ id: agentId }),
            getAgent: jest.fn().mockResolvedValue({ id: agentId, config_json: paymentConfig }),
            duplicateAgent: jest.fn().mockResolvedValue({ id: agentId }),
        };
        const throttleService = {
            isFeatureEnabled: featureResult instanceof Error
                ? jest.fn().mockRejectedValue(featureResult)
                : jest.fn().mockResolvedValue(featureResult),
        };
        const controller = new PersonaController(
            personaService as any,
            {} as any,
            throttleService as any,
        );

        return { controller, personaService, throttleService };
    }

    it.each([
        ['legacy save', async (controller: PersonaController) => controller.save(tenantId, paymentConfig, { user: {} })],
        ['agent create', async (controller: PersonaController) => controller.createAgent(
            tenantId,
            { name: 'Ventas', configJson: paymentConfig },
            { user: {} },
        )],
        ['agent update', async (controller: PersonaController) => controller.updateAgent(
            tenantId,
            agentId,
            { configJson: paymentConfig },
        )],
        ['agent duplicate', async (controller: PersonaController) => controller.duplicateAgent(
            tenantId,
            agentId,
            { user: {} },
        )],
    ])('rejects %s when customerPayments is not in the plan', async (_name, invoke) => {
        const { controller, personaService, throttleService } = makeController(false);

        await expect(invoke(controller)).resolves.toEqual({
            success: false,
            message: 'Los cobros a clientes no están disponibles en tu plan actual.',
        });
        expect(throttleService.isFeatureEnabled).toHaveBeenCalledWith(tenantId, 'customerPayments');
        expect(personaService.savePersonaFromYaml).not.toHaveBeenCalled();
        expect(personaService.createAgent).not.toHaveBeenCalled();
        expect(personaService.updateAgent).not.toHaveBeenCalled();
        expect(personaService.duplicateAgent).not.toHaveBeenCalled();
    });

    it('fails closed when entitlement resolution fails', async () => {
        const { controller, personaService } = makeController(new Error('billing unavailable'));

        await expect(controller.createAgent(
            tenantId,
            { name: 'Ventas', configJson: paymentConfig },
            { user: {} },
        )).resolves.toMatchObject({ success: false });
        expect(personaService.createAgent).not.toHaveBeenCalled();
    });

    it('allows an entitled tenant to persist the payment tool configuration', async () => {
        const { controller, personaService } = makeController(true);

        await expect(controller.createAgent(
            tenantId,
            { name: 'Ventas', configJson: paymentConfig },
            { user: { email: 'admin@example.com' } },
        )).resolves.toMatchObject({ success: true });
        expect(personaService.createAgent).toHaveBeenCalledWith(
            tenantId,
            expect.objectContaining({ configJson: paymentConfig }),
        );
    });

    it('does not query the entitlement when payment tools are not being enabled', async () => {
        const { controller, throttleService, personaService } = makeController(false);
        const config = { tools: { payments: { enabled: false } } };

        await controller.updateAgent(tenantId, agentId, { configJson: config });

        expect(throttleService.isFeatureEnabled).not.toHaveBeenCalled();
        expect(personaService.updateAgent).toHaveBeenCalled();
    });
});
