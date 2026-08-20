import { identityStepUpToolNames, identityStepUpToolsFor } from './identity-step-up-registration';
import { IDENTITY_STEP_UP_TOOLS } from './tools/insurance-tools';
import { STATIC_TOOL_NAMES, TOOL_POLICY_REGISTRY } from './tool-policy-registry';
import {
    approvedMcpToolNames,
    findMcpApproval,
    mcpRegisteredName,
    readMcpApprovals,
} from '../mcp/mcp-tool-approval';
import { ASSURANCE_LEVEL_MATRIX } from '@parallext/shared';

/**
 * Tres affordances que el agente veía y no podía usar.
 *
 * MCP se anunciaba entero al modelo mientras el guard central rechazaba toda
 * llamada `mcp__*`; `apply_discount` se publicaba desde un toggle guardado
 * aunque el único proveedor vivo solo sabe crear enlaces de pago; y el par OTP
 * se publicaba desde una lista de cuatro familias escrita a mano, así que
 * cualquier tool A2 fuera de esa lista disparaba un código que el agente no
 * tenía cómo leer.
 */

describe('el par OTP se deriva de las policies A2 publicadas', () => {
    const otpNames = identityStepUpToolNames();

    it('sin ninguna tool con step-up no publica la llave', () => {
        const tools = [{ name: 'list_services' }, { name: 'search_products' }] as any;
        expect(identityStepUpToolsFor(tools)).toEqual([]);
    });

    it('una sola tool A2 alcanza para publicar la llave', () => {
        const tools = [{ name: 'get_check_in_instructions' }] as any;
        expect(identityStepUpToolsFor(tools).map(t => t.name)).toEqual(otpNames);
    });

    it('cubre las familias que la lista escrita a mano dejaba afuera', () => {
        // Ninguna de estas pertenece a insurance/appointments/treatments/
        // professionalServices, las cuatro familias del gate anterior.
        for (const name of ['get_check_in_instructions', 'get_vaccination_status']) {
            expect(identityStepUpToolsFor([{ name }] as any).map(t => t.name)).toEqual(otpNames);
        }
    });

    it('no duplica la llave si ya estaba publicada', () => {
        const tools = [
            { name: 'get_vaccination_status' },
            ...IDENTITY_STEP_UP_TOOLS,
        ] as any;
        expect(identityStepUpToolsFor(tools)).toEqual([]);
    });

    it('la llave por sí sola no se considera una cerradura', () => {
        expect(identityStepUpToolsFor([...IDENTITY_STEP_UP_TOOLS] as any)).toEqual([]);
    });

    it('toda tool A2 del registro dispara la publicación', () => {
        const stepUpTools = STATIC_TOOL_NAMES.filter(name => (
            ASSURANCE_LEVEL_MATRIX[TOOL_POLICY_REGISTRY[name].assurance]?.requiresStepUpIdentity
        ));
        // Si esto queda vacío, el test dejó de probar algo.
        expect(stepUpTools.length).toBeGreaterThan(0);
        for (const name of stepUpTools) {
            expect(identityStepUpToolsFor([{ name }] as any).map(t => t.name)).toEqual(otpNames);
        }
    });

    it('los nombres a fijar en el recorte son exactamente el par OTP', () => {
        expect(otpNames).toEqual(IDENTITY_STEP_UP_TOOLS.map(t => t.name));
        expect(otpNames).toEqual(expect.arrayContaining(['request_identity_code', 'verify_identity_code']));
    });
});

describe('MCP: descubrir no es autorizar', () => {
    const base = {
        serverId: 'crm',
        toolName: 'lookup',
        approvedBy: 'owner@negocio.com',
        approvedAt: '2026-08-20T00:00:00.000Z',
    };

    it('un tenant sin aprobaciones no publica nada', () => {
        expect(approvedMcpToolNames({}).size).toBe(0);
        expect(approvedMcpToolNames({ mcpToolApprovals: [] }).size).toBe(0);
        expect(approvedMcpToolNames(undefined).size).toBe(0);
    });

    it('una lectura aprobada se publica', () => {
        const settings = {
            mcpToolApprovals: [{
                ...base, effect: 'read', requiresConfirmation: false, requiresHumanApproval: false,
            }],
        };
        expect([...approvedMcpToolNames(settings)]).toEqual(['mcp__crm__lookup']);
    });

    it('una escritura sin política de confirmación NO se publica', () => {
        const settings = {
            mcpToolApprovals: [{
                ...base, effect: 'write', requiresConfirmation: false, requiresHumanApproval: false,
            }],
        };
        // Aprobar "que escriba" sin decir cuándo confirmar es justo lo que el
        // guard central existe para frenar. Se trata como no aprobada, no como
        // aprobada-con-menos-controles.
        expect(approvedMcpToolNames(settings).size).toBe(0);
    });

    it('una escritura con confirmación sí se publica', () => {
        const settings = {
            mcpToolApprovals: [{
                ...base, effect: 'write', requiresConfirmation: true, requiresHumanApproval: false,
            }],
        };
        expect([...approvedMcpToolNames(settings)]).toEqual(['mcp__crm__lookup']);
    });

    it('registros malformados se descartan en vez de asumirse aprobados', () => {
        const settings = {
            mcpToolApprovals: [
                { serverId: 'crm' },
                { ...base, effect: 'read' },
                { ...base, effect: 'read', requiresConfirmation: 'sí', requiresHumanApproval: false },
                null,
                'mcp__crm__lookup',
            ],
        };
        expect(readMcpApprovals(settings)).toEqual([]);
        expect(approvedMcpToolNames(settings).size).toBe(0);
    });

    it('el nombre registrado enlaza aprobación y publicación', () => {
        expect(mcpRegisteredName('crm', 'lookup')).toBe('mcp__crm__lookup');
        const settings = {
            mcpToolApprovals: [{
                ...base, effect: 'payment', requiresConfirmation: true, requiresHumanApproval: true,
            }],
        };
        expect(findMcpApproval(settings, 'mcp__crm__lookup')).toMatchObject({ effect: 'payment' });
        expect(findMcpApproval(settings, 'mcp__crm__otra')).toBeNull();
    });
});
