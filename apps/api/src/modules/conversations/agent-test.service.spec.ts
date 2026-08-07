import { AgentTestService } from './agent-test.service';
import {
    AGENT_TEST_SAFE_TOOL_NAMES,
    AGENT_TEST_SANDBOX_CONTACT_ID,
} from './agent-test-tool-policy';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

const ALL_TOOL_FLAGS = {
    appointments: { enabled: true },
    catalog: { enabled: true },
    faqs: { enabled: true },
    policies: { enabled: true },
    knowledge: { enabled: true },
    offers: { enabled: true },
    orders: { enabled: true },
    crm: { enabled: true },
    ecommerce: { enabled: true, canApplyDiscount: true },
    properties: { enabled: true },
    tours: { enabled: true },
    treatments: { enabled: true },
    realEstate: { enabled: true },
    vehicles: { enabled: true },
    pets: { enabled: true },
    restaurants: { enabled: true },
    gyms: { enabled: true },
    education: { enabled: true },
    insurance: { enabled: true },
    homeServices: { enabled: true },
    petServices: { enabled: true },
    photography: { enabled: true },
    professionalServices: { enabled: true },
};

function buildSubject() {
    const personaService = {
        getAgent: jest.fn().mockResolvedValue({
            config_json: {
                language: 'es-CO',
                tools: ALL_TOOL_FLAGS,
                rag: { enabled: false },
                llm: { temperature: 0 },
            },
        }),
    };
    const llmRouter = { execute: jest.fn() };
    const knowledgeService = {
        tenantHasKnowledge: jest.fn().mockResolvedValue(false),
        searchRelevant: jest.fn(),
    };
    const businessInfoService = { getPrimary: jest.fn().mockResolvedValue(null) };
    const promptAssembler = {
        computeUpcomingDays: jest.fn().mockReturnValue([]),
        assemble: jest.fn().mockReturnValue('system prompt'),
    };
    const languageDetector = { detect: jest.fn().mockReturnValue('es') };
    const toolExecutor = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const tenantsService = { getSchemaName: jest.fn().mockResolvedValue('tenant_test') };

    const service = new AgentTestService(
        personaService as any,
        llmRouter as any,
        knowledgeService as any,
        businessInfoService as any,
        promptAssembler as any,
        languageDetector as any,
        toolExecutor as any,
        tenantsService as any,
    );

    return { service, llmRouter, toolExecutor };
}

describe('AgentTestService read-only tool policy', () => {
    it('advertises the audited real tool names, including professional services and safe ecommerce parity', async () => {
        const { service, llmRouter } = buildSubject();
        llmRouter.execute.mockResolvedValue({ content: 'ok', model: 'test-model' });

        await service.test('tenant-id', 'agent-id', { message: 'hola' });

        const offered = llmRouter.execute.mock.calls[0][0].tools.map((tool: any) => tool.name);
        expect(new Set(offered)).toEqual(new Set(AGENT_TEST_SAFE_TOOL_NAMES));
        expect(offered).toEqual(expect.arrayContaining([
            'get_case_status',
            'recommend_products',
            'get_order_status',
            'search_products',
            'search_knowledge_base',
            'list_active_offers',
        ]));
        const forbidden = [
            // Obsolete aliases from the previous allowlist.
            'list_products',
            'search_knowledge',
            'get_policies',
            'list_offers',
            // Writers and action-like tools.
            'create_appointment',
            'calculate_quote',
            'get_placement_test_link',
            'apply_discount',
            'send_booking_link',
            'cancel_appointment',
            'reschedule_appointment',
            'send_product_image',
            'create_property_booking',
            'cancel_property_booking',
            'send_property_image',
            'create_tour_booking',
            'cancel_tour_booking',
            'send_listing_image',
            'send_vehicle_image',
            'register_pet',
            'update_pet',
            'place_order',
            'cancel_order',
            'book_class',
            'freeze_membership',
            'cancel_class_booking',
            'enroll_student',
            'cancel_enrollment',
            'file_claim',
            'cancel_quote',
            'request_identity_code',
            'verify_identity_code',
            'create_service_request',
            'cancel_service_request',
            'send_portfolio',
            'request_photo_quote',
            'cancel_photo_session',
            // External tools stay default-denied until sandboxed.
            'get_restaurant_menu',
            'get_fitness_schedule',
            'list_clinic_services',
            'check_clinic_availability',
        ];
        for (const name of forbidden) expect(offered).not.toContain(name);
        expect(offered.some((name: string) => name.startsWith('mcp__'))).toBe(false);
    });

    it('blocks hallucinated writers and opaque MCP tools before the real executor, even in evalMode', async () => {
        const { service, llmRouter, toolExecutor } = buildSubject();
        llmRouter.execute
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [
                    { id: 'write-1', function: { name: 'create_appointment', arguments: '{"date":"2026-08-07"}' } },
                    { id: 'mcp-1', function: { name: 'mcp__erp__create_order', arguments: '{}' } },
                ],
            })
            .mockResolvedValueOnce({ content: 'No persistí ninguna acción.' });

        const result = await service.test(
            'tenant-id',
            'agent-id',
            { message: 'crea una cita' },
            { evalMode: true },
        );

        expect(toolExecutor.execute).not.toHaveBeenCalled();
        expect(result.debug.toolCalls).toHaveLength(2);
        for (const call of result.debug.toolCalls) {
            expect(call.result).toMatchObject({
                error: 'agent_test_read_only',
                persisted: false,
            });
        }
    });

    it('executes only allowlisted reads with a valid non-customer UUID', async () => {
        const { service, llmRouter, toolExecutor } = buildSubject();
        llmRouter.execute
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [
                    { id: 'case-1', function: { name: 'get_case_status', arguments: '{}' } },
                    { id: 'shop-1', function: { name: 'recommend_products', arguments: '{"search":"camisa"}' } },
                ],
            })
            .mockResolvedValueOnce({ content: 'Resultado de prueba.' });

        await service.test(
            'tenant-id',
            'agent-id',
            { message: 'consulta segura' },
            // A syntactically valid but arbitrary UUID must not let Agent Test
            // inspect a real customer's contact-scoped records.
            { sandboxContactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        );

        expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
        for (const call of toolExecutor.execute.mock.calls) {
            expect(call[2]).toBe(AGENT_TEST_SANDBOX_CONTACT_ID);
            expect(call[2]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
            expect(AGENT_TEST_SAFE_TOOL_NAMES).toContain(call[3]);
            expect(call[6]).toEqual({
                evalMode: false,
                readOnly: true,
                executionContext: AGENT_TEST_EXECUTION_CONTEXT,
            });
        }
    });

    it('propagates the persistence-disabled context through every non-tool layer', async () => {
        const personaService = {
            getAgent: jest.fn().mockResolvedValue({
                config_json: {
                    language: 'es-CO',
                    rag: { enabled: true, topK: 2, similarityThreshold: 0.1 },
                },
            }),
        };
        const llmRouter = { execute: jest.fn().mockResolvedValue({ content: 'ok' }) };
        const knowledgeService = {
            tenantHasKnowledge: jest.fn().mockResolvedValue(true),
            searchRelevant: jest.fn().mockResolvedValue([]),
        };
        const businessInfoService = { getPrimary: jest.fn().mockResolvedValue(null) };
        const promptAssembler = {
            computeUpcomingDays: jest.fn().mockReturnValue([]),
            assemble: jest.fn().mockReturnValue('system prompt'),
        };
        const tenantsService = { getSchemaName: jest.fn().mockResolvedValue('tenant_test') };
        const service = new AgentTestService(
            personaService as any,
            llmRouter as any,
            knowledgeService as any,
            businessInfoService as any,
            promptAssembler as any,
            { detect: jest.fn().mockReturnValue('es') } as any,
            { execute: jest.fn() } as any,
            tenantsService as any,
        );

        await service.test('tenant-id', 'agent-id', { message: 'hola' });

        expect(personaService.getAgent).toHaveBeenCalledWith(
            'tenant-id', 'agent-id', AGENT_TEST_EXECUTION_CONTEXT,
        );
        expect(businessInfoService.getPrimary).toHaveBeenCalledWith(
            'tenant-id', AGENT_TEST_EXECUTION_CONTEXT,
        );
        expect(knowledgeService.tenantHasKnowledge).toHaveBeenCalledWith(
            'tenant-id', AGENT_TEST_EXECUTION_CONTEXT,
        );
        expect(knowledgeService.searchRelevant).toHaveBeenCalledWith(
            'tenant-id',
            'hola',
            2,
            { similarityThreshold: 0.1, executionContext: AGENT_TEST_EXECUTION_CONTEXT },
        );
        expect(tenantsService.getSchemaName).toHaveBeenCalledWith(
            'tenant-id', AGENT_TEST_EXECUTION_CONTEXT,
        );
        expect(llmRouter.execute).toHaveBeenCalledWith(expect.objectContaining({
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
        }));
    });
});
