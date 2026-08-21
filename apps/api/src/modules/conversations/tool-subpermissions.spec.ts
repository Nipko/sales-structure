import { AIToolExecutorService } from './ai-tool-executor.service';
import {
    staticToolsForAgentConfig,
    subpermissionDeniedToolNames,
} from './agent-tool-registry';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Las casillas que el dueño apagaba y no apagaban nada.
 *
 * `canBook`, `canCancel`, `canCheckStock` y `canRecommend` existen en el tipo,
 * la pantalla del agente los muestra como casillas y el bootstrap los siembra
 * por vertical. **Ningún lugar los leía.** Un dueño que destildaba "puede
 * cancelar" veía la casilla apagada y el agente cancelaba igual.
 *
 * Un control que existe en la interfaz y no en el sistema es peor que no
 * tenerlo: el control que no está no se confía, y éste sí.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_subperm';
const contactId = '22222222-2222-4222-8222-222222222222';

function names(cfg: any): string[] {
    return staticToolsForAgentConfig(cfg).map(t => String(t.name));
}

describe('un subpermiso apagado retira su tool de la publicación', () => {
    it('canBook: false saca las que reservan y deja las que consultan', () => {
        const published = names({ appointments: { enabled: true, canBook: false } });

        expect(published).not.toContain('create_appointment');
        expect(published).not.toContain('send_booking_link');
        // Consultar servicios y disponibilidad sigue: apagar "puede agendar"
        // no convierte al agente en mudo sobre la agenda.
        expect(published).toContain('list_services');
        expect(published).toContain('check_availability');
    });

    it('canCancel: false cubre también reprogramar', () => {
        // Reprogramar LIBERA el turno original. Que no estuviera cubierta por
        // ninguna de las dos casillas era la fuga más silenciosa: el dueño
        // apagaba cancelar y el agente reprogramaba, que para su agenda es lo
        // mismo.
        const published = names({ appointments: { enabled: true, canCancel: false } });

        expect(published).not.toContain('cancel_appointment');
        expect(published).not.toContain('reschedule_appointment');
        expect(published).toContain('create_appointment');
    });

    it('canCheckStock y canRecommend también recortan', () => {
        expect(names({ catalog: { enabled: true, canCheckStock: false } }))
            .not.toContain('check_stock');
        expect(names({ ecommerce: { enabled: true, canRecommend: false } }))
            .not.toContain('recommend_products');
    });

    it('ausente es permitido: un agente viejo no pierde capacidades', () => {
        // Un agente guardado antes de que la clave existiera no puede quedarse
        // sin reservar por un cambio de contrato. Sólo un `false` explícito
        // recorta.
        const published = names({ appointments: { enabled: true } });
        expect(published).toContain('create_appointment');
        expect(published).toContain('cancel_appointment');
        expect(subpermissionDeniedToolNames({ appointments: { enabled: true } }).size).toBe(0);
    });

    it('el subpermiso recorta, no apaga la familia', () => {
        const published = names({ appointments: { enabled: true, canBook: false, canCancel: false } });
        expect(published.length).toBeGreaterThan(0);
        expect(published).toContain('get_appointment_details');
    });

    it('una familia apagada no publica nada, con o sin subpermisos', () => {
        expect(names({ appointments: { enabled: false, canBook: true } })).toEqual([]);
    });
});

describe('el ejecutor también los mira: publicar no alcanza', () => {
    function buildExecutor() {
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
        const control = {
            preflight: jest.fn().mockResolvedValue({ decision: 'allow' }),
            finish: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const stub = {} as any;
        const executor = new AIToolExecutorService(
            prisma as any,
            stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
            stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
            control as any, stub, stub,
        );
        jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
        return { executor, prisma };
    }

    it('rechaza la tool apagada aunque la llamen por nombre', async () => {
        // Publicar alcanza para el loop del LLM y no para el motor
        // determinista, Procedures ni la confirmación server-side: los tres
        // llaman por nombre.
        const { executor, prisma } = buildExecutor();

        const result = await executor.execute(
            schemaName, tenantId, contactId, 'cancel_appointment', {}, undefined,
            {
                // La tool está PUBLICADA y aun así cae: lo que la frena es que
                // el dueño la apagó. Con la lista vacía el caso pasaría por
                // `not_authorised` sin tocar nunca el subpermiso.
                authority: {
                    ...authorityFor('cancel_appointment', 'reschedule_appointment'),
                    deniedTools: ['cancel_appointment', 'reschedule_appointment'],
                },
                deniedTools: ['cancel_appointment', 'reschedule_appointment'],
            },
        );

        expect(result).toMatchObject({ error: 'tool_disabled_by_owner', shouldHandoff: true });
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('el mensaje no promete reintentar: es una decisión del dueño', async () => {
        const { executor } = buildExecutor();

        const result = await executor.execute(
            schemaName, tenantId, contactId, 'check_stock', {}, undefined,
            {
                authority: { ...authorityFor('check_stock'), deniedTools: ['check_stock'] },
                deniedTools: ['check_stock'],
            },
        );

        // No es un fallo ni una falta de capacidad temporal.
        expect(String(result.message)).not.toMatch(/intent|error|problema|momento/i);
        expect(String(result.message)).toMatch(/equipo/);
    });

    it('una tool que el dueño no apagó pasa', async () => {
        const { executor } = buildExecutor();

        const result = await executor.execute(
            schemaName, tenantId, contactId, 'check_availability', { date: '2026-09-01' },
            undefined, {
                authority: {
                    ...authorityFor('check_availability'),
                    deniedTools: ['cancel_appointment'],
                },
                deniedTools: ['cancel_appointment'],
            },
        );

        expect(result?.error).not.toBe('tool_disabled_by_owner');
    });
});
