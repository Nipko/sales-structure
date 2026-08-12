import { CopilotService, CopilotChatRequest } from './copilot.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function createService() {
    const llmRouter = {
        execute: jest.fn().mockResolvedValue({
            content: 'Ayuda',
            routingDecision: { selectedModel: { id: 'test-model' } },
            usage: { totalTokens: 10 },
        }),
    };
    const verticals = {
        getVerticalConfig: jest.fn().mockResolvedValue({
            industry: 'turismo',
            subType: 'alquiler_vacacional',
            effectiveCapabilities: ['crm_pipeline', 'nightly_booking'],
        }),
    };
    const service = new CopilotService(
        {} as any,
        {} as any,
        {} as any,
        llmRouter as any,
        {} as any,
        {} as any,
        verticals as any,
    );
    return { service, llmRouter, verticals };
}

describe('CopilotService authenticated context', () => {
    it('boosts an article for the current page using complete route segments', () => {
        const { service } = createService();
        jest.spyOn(service as any, 'loadKb').mockReturnValue([
            {
                id: 'agent', locale: 'es', title: 'Agente', routes: ['/admin/agent'],
                roles: ['tenant_agent'], keywords: [], body: 'Configuración del agente.',
            },
            {
                id: 'analytics', locale: 'es', title: 'Analítica', routes: ['/admin/agent-analytics'],
                roles: ['tenant_agent'], keywords: [], body: 'Rendimiento del equipo.',
            },
        ]);

        const matches = (service as any).searchKb(
            'necesito ayuda',
            'es',
            '/admin/agent-analytics/team',
            'tenant_agent',
            1,
        );

        expect(matches.map((article: any) => article.id)).toEqual(['analytics']);
    });

    it('excludes a higher-scoring article when the authenticated role is not allowed', () => {
        const { service } = createService();
        jest.spyOn(service as any, 'loadKb').mockReturnValue([
            {
                id: 'admin-only', locale: 'es', title: 'Canales secretos', routes: ['/admin/channels'],
                roles: ['tenant_admin'], keywords: ['canales'], body: 'Configuración administrativa de canales.',
            },
            {
                id: 'agent-safe', locale: 'es', title: 'Uso del inbox', routes: ['/admin/inbox'],
                roles: ['tenant_agent'], keywords: ['canales'], body: 'Identifica el canal de una conversación.',
            },
        ]);

        const matches = (service as any).searchKb(
            'canales',
            'es',
            '/admin/channels',
            'tenant_agent',
        );

        expect(matches.map((article: any) => article.id)).toEqual(['agent-safe']);
    });

    it('includes an article when the authenticated role is explicitly allowed', () => {
        const { service } = createService();
        jest.spyOn(service as any, 'loadKb').mockReturnValue([
            {
                id: 'admin-only', locale: 'es', title: 'Canales', routes: ['/admin/channels'],
                roles: ['tenant_admin'], keywords: ['canales'], body: 'Configuración administrativa.',
            },
        ]);

        const matches = (service as any).searchKb(
            'canales',
            'es',
            '/admin/channels',
            'tenant_admin',
        );

        expect(matches.map((article: any) => article.id)).toEqual(['admin-only']);
    });

    it('does not let generic dashboard routes displace an exact keyword match', () => {
        const { service } = createService();
        jest.spyOn(service as any, 'loadKb').mockReturnValue([
            {
                id: 'getting-started', locale: 'es', title: 'Primeros pasos', routes: ['/admin'],
                roles: ['tenant_admin'], keywords: ['inicio'], body: 'Resumen general del panel.',
            },
            {
                id: 'navigation', locale: 'es', title: 'Navegación', routes: ['/admin'],
                roles: ['tenant_admin'], keywords: ['menu'], body: 'Cómo moverte por el panel.',
            },
            {
                id: 'analytics', locale: 'es', title: 'Analítica', routes: ['/admin'],
                roles: ['tenant_admin'], keywords: ['metricas'], body: 'Resumen de indicadores.',
            },
            {
                id: 'integrations', locale: 'es', title: 'Integraciones', routes: ['/admin/settings/integrations/mcp'],
                roles: ['tenant_admin'], keywords: ['mcp'], body: 'Configura MCP de forma segura.',
            },
        ]);

        const matches = (service as any).searchKb(
            'mcp',
            'es',
            '/admin',
            'tenant_admin',
            3,
        );

        expect(matches.map((article: any) => article.id)).toEqual(['integrations']);
    });

    it('derives vertical context from the authenticated tenant configuration', async () => {
        const { service, verticals } = createService();

        const context = await (service as any).buildVerticalContext(TENANT_ID);

        expect(verticals.getVerticalConfig).toHaveBeenCalledWith(TENANT_ID);
        expect(context).toContain('"industry":"turismo"');
        expect(context).toContain('"subType":"alquiler_vacacional"');
        expect(context).toContain('"nightly_booking"');
    });

    it('injects only server-derived vertical context into the support prompt', async () => {
        const { service, llmRouter } = createService();
        jest.spyOn(service as any, 'searchKb').mockReturnValue([]);
        const planSpy = jest.spyOn(service as any, 'buildPlanContext').mockResolvedValue('PLAN ADMIN');
        const request: CopilotChatRequest = {
            message: '¿Qué puedo hacer aquí?',
            history: [],
            context: {
                tenantId: TENANT_ID,
                userName: 'Usuario autenticado',
                userRole: 'tenant_admin',
                locale: 'es',
                page: '/admin/properties',
            },
        };

        await service.chat(request);

        expect(llmRouter.execute).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT_ID,
            systemPrompt: expect.stringContaining('"effectiveCapabilities":["crm_pipeline","nightly_booking"]'),
        }));
        expect((service as any).searchKb).toHaveBeenCalledWith(
            request.message,
            'es',
            '/admin/properties',
            'tenant_admin',
        );
        expect(planSpy).toHaveBeenCalledWith(TENANT_ID);
        const systemPrompt = llmRouter.execute.mock.calls[0][0].systemPrompt;
        expect(systemPrompt).not.toContain('Usuario autenticado');
        expect(systemPrompt).toContain('Rol autenticado: tenant_admin');
    });

    it('does not expose tenant plan or quota context to supervisors or agents', async () => {
        const { service, llmRouter } = createService();
        jest.spyOn(service as any, 'searchKb').mockReturnValue([]);
        const planSpy = jest.spyOn(service as any, 'buildPlanContext')
            .mockResolvedValue('SENSITIVE PLAN AND QUOTAS');
        const request: CopilotChatRequest = {
            message: '¿Qué incluye nuestra suscripción?',
            history: [],
            context: {
                tenantId: TENANT_ID,
                userName: 'Supervisor',
                userRole: 'tenant_supervisor',
                locale: 'es',
                page: '/admin',
            },
        };

        await service.chat(request);

        expect(planSpy).not.toHaveBeenCalled();
        const systemPrompt = llmRouter.execute.mock.calls[0][0].systemPrompt;
        expect(systemPrompt).not.toContain('SENSITIVE PLAN AND QUOTAS');
        expect(systemPrompt).toContain('no reveles ni infieras el plan');
    });
});
