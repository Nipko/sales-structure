import { AIToolExecutorService } from './ai-tool-executor.service';
import {
    TOOL_AUTHORITY_MAX_AGE_SECONDS,
    decideToolAuthority,
    isToolAuthorityDenial,
    type ToolExecutionAuthority,
} from '@parallext/shared';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * ═══ LA AUTORIZACIÓN ERA POR NEGACIÓN ═══
 *
 * El ejecutor es la puerta común: el bucle del LLM, el motor de reservas,
 * Procedures, la confirmación diferida, el banco de pruebas, el servidor MCP y
 * el reanudador de aprobaciones pasan todos por acá. Y preguntaba dos cosas,
 * ambas opcionales: "¿el dueño apagó esta tool?" y "¿el negocio está
 * bloqueado?". Un llamador que no pasaba `opts` —y había uno— tenía el catálogo
 * entero; y cualquier tool que nadie hubiera pensado en prohibir estaba
 * permitida por omisión.
 *
 * Ahora la pregunta es al revés: **qué se publicó para este turno**. Lo que no
 * está en esa lista no corre, venga de donde venga la llamada.
 */

const schemaName = 'tenant_authority';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function buildExecutor() {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const stub = () => ({}) as any;
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: queryRawUnsafe, executeInTenantSchema: jest.fn().mockResolvedValue([]) } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
    );
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
        jest.spyOn((executor as any).logger, level).mockImplementation(() => undefined);
    }
    return { executor, queryRawUnsafe, control };
}

// ── La decisión, aislada ──────────────────────────────────────────────────

describe('decideToolAuthority: sin autoridad no se ejecuta nada', () => {
    it('la ausencia de autoridad NO es permiso', () => {
        const decision = decideToolAuthority(undefined, 'create_appointment', { isNonCommittal: false });
        expect(decision).toMatchObject({ allowed: false, reason: 'not_authorised' });
    });

    it('una lista vacía tampoco: publicar cero tools es una decisión válida', () => {
        // El caso real: el resolutor se cayó y el turno quedó sin contrato. Que
        // no haya lista no puede significar "todas".
        const decision = decideToolAuthority(
            authorityFor(), 'search_faqs', { isNonCommittal: true },
        );
        expect(decision).toMatchObject({ allowed: false, reason: 'not_authorised' });
    });

    it('una tool publicada pasa', () => {
        expect(decideToolAuthority(
            authorityFor('check_availability'), 'check_availability', { isNonCommittal: true },
        )).toEqual({ allowed: true });
    });

    it('publicar una tool no publica a sus vecinas', () => {
        // Autorizar `check_availability` no autoriza `create_appointment`:
        // consultar y comprometerse son cosas distintas.
        expect(decideToolAuthority(
            authorityFor('check_availability'), 'create_appointment', { isNonCommittal: false },
        )).toMatchObject({ allowed: false, reason: 'not_authorised' });
    });
});

describe('el orden de los motivos importa: cada denegación se explica por lo suyo', () => {
    const base = (over: Partial<ToolExecutionAuthority> = {}): ToolExecutionAuthority => ({
        ...authorityFor('cancel_appointment'),
        ...over,
    });

    it('el bloqueo del perfil frena una operación que compromete', () => {
        expect(decideToolAuthority(
            base({ commitmentBlocked: { reason: 'capability:blocked:profile_blocked' } }),
            'cancel_appointment', { isNonCommittal: false },
        )).toMatchObject({ allowed: false, reason: 'commitment_blocked' });
    });

    it('...y NO frena una lectura: bloqueado no es mudo', () => {
        // Filtrar por "escribe una fila" dejaba al perfil bloqueado sin poder
        // ni contestar una pregunta de horario.
        expect(decideToolAuthority(
            base({ commitmentBlocked: { reason: 'capability:blocked:profile_blocked' } }),
            'cancel_appointment', { isNonCommittal: true },
        )).toEqual({ allowed: true });
    });

    it('lo que el dueño apagó se reporta como decisión del dueño, no como "no autorizada"', () => {
        // El matiz no es cosmético: `not_authorised` manda a revisar el plan o
        // la habilitación, y acá la respuesta es "andá a la pantalla del agente
        // y volvé a encenderla".
        const decision = decideToolAuthority(
            base({
                deniedTools: ['cancel_appointment'],
                commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
            }),
            'cancel_appointment', { isNonCommittal: true },
        );
        expect(decision).toMatchObject({ allowed: false, reason: 'disabled_by_owner' });
    });

    it('una autoridad vieja se rechaza antes que cualquier otra cosa', () => {
        const stale = new Date(Date.now() - (TOOL_AUTHORITY_MAX_AGE_SECONDS + 30) * 1000);
        const decision = decideToolAuthority(
            base({ resolvedAt: stale.toISOString() }), 'cancel_appointment', { isNonCommittal: true },
        );
        expect(decision).toMatchObject({ allowed: false, reason: 'authority_stale' });
    });

    it('una marca de tiempo ilegible cuenta como vieja, no como fresca', () => {
        // Sin esto, un `resolvedAt` corrupto producía una edad `NaN` y cualquier
        // comparación con NaN es falsa: la autoridad más rota sería la que
        // nunca vence.
        expect(decideToolAuthority(
            base({ resolvedAt: 'ayer' }), 'cancel_appointment', { isNonCommittal: true },
        )).toMatchObject({ allowed: false, reason: 'authority_stale' });
    });
});

// ── La misma decisión, en la puerta ───────────────────────────────────────

describe('el ejecutor deniega por defecto y no toca la base', () => {
    it('una tool fuera de la lista no llega al motor de la tool', async () => {
        const { executor, queryRawUnsafe, control } = buildExecutor();

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_appointment',
            { serviceId: 'svc-1', date: '2026-09-01', time: '10:00' },
            conversationId, { authority: authorityFor('check_availability') },
        );

        expect(result).toMatchObject({ error: 'tool_not_authorised', shouldHandoff: true });
        // No es "falló después de escribir": no se escribió.
        expect(queryRawUnsafe).not.toHaveBeenCalled();
        // Y tampoco se abrió un asiento en el ledger para algo que no iba a correr.
        expect(control.preflight).not.toHaveBeenCalled();
    });

    it('cada motivo llega al cliente con su propio código', async () => {
        const cases: Array<[Partial<ToolExecutionAuthority>, string]> = [
            [{ commitmentBlocked: { reason: 'capability:blocked:x' } }, 'capability_blocked'],
            [{ deniedTools: ['place_order'] }, 'tool_disabled_by_owner'],
            [{ resolvedAt: new Date(Date.now() - 3600_000).toISOString() }, 'authority_stale'],
        ];
        for (const [over, expected] of cases) {
            const { executor } = buildExecutor();
            const result: any = await executor.execute(
                schemaName, tenantId, contactId, 'place_order', {}, conversationId,
                { authority: { ...authorityFor('place_order'), ...over } },
            );
            expect(result.error).toBe(expected);
            // Todos escalan: el cliente pidió algo concreto que no se pudo hacer.
            expect(result.shouldHandoff).toBe(true);
            expect(isToolAuthorityDenial(result.error)).toBe(true);
        }
    });

    it('el mensaje no inventa un motivo ni promete reintentar', async () => {
        const { executor } = buildExecutor();
        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'refund_payment', {}, conversationId,
            { authority: authorityFor() },
        );
        // Ni "error", ni "en este momento", ni "intentá de nuevo": nada de eso
        // es cierto, y el cliente vuelve a intentar contra una puerta cerrada.
        expect(String(result.message)).not.toMatch(/error|problema|intent|momento/i);
        expect(String(result.message)).toMatch(/equipo/);
    });

    it('una tool MCP de lectura no se cuela por el nombre', async () => {
        // `mcp__*` se decide por la aprobación revisada, no por el prefijo. Sin
        // autoridad no hay ejecución aunque el efecto declarado sea `read`.
        const { executor } = buildExecutor();
        (executor as any).mcpClient = {
            getApproval: jest.fn().mockResolvedValue({ effect: 'read' }),
            callRemoteTool: jest.fn().mockResolvedValue({ ok: true }),
        };

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'mcp__crm__lookup', {}, conversationId,
            { authority: authorityFor('search_faqs') },
        );

        expect(result).toMatchObject({ error: 'tool_not_authorised' });
        expect((executor as any).mcpClient.callRemoteTool).not.toHaveBeenCalled();
    });

    it('la tool publicada sí corre: la puerta no cierra el paso legítimo', async () => {
        // Denegar por defecto sólo sirve si lo autorizado pasa. Sin este caso,
        // un gate que denegara TODO se vería idéntico a uno correcto.
        const { executor } = buildExecutor();
        const search = jest.fn().mockResolvedValue([
            { id: 'faq-1', question: '¿A qué hora abren?', answer: 'De 9 a 18.' },
        ]);
        (executor as any).faqsService = { search, incrementViews: jest.fn() };

        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'search_faqs', { query: 'horario' },
            conversationId, { authority: authorityFor('search_faqs') },
        );

        expect(isToolAuthorityDenial(result?.error)).toBe(false);
        expect(search).toHaveBeenCalledWith(tenantId, 'horario', 3, undefined);
        expect(result.faqs).toHaveLength(1);
    });
});

// ── Lo que reconoce la escalada ───────────────────────────────────────────

describe('isToolAuthorityDenial distingue "no puedo" de "salió mal"', () => {
    it('reconoce los cuatro códigos de denegación', () => {
        for (const code of [
            'tool_not_authorised', 'capability_blocked',
            'tool_disabled_by_owner', 'authority_stale',
        ]) {
            expect(isToolAuthorityDenial(code)).toBe(true);
        }
    });

    it('no confunde una lectura fallida con una denegación', () => {
        // Una consulta rota se arregla del lado nuestro; mandar esa
        // conversación a la cola humana llena la cola de problemas internos.
        for (const code of ['read_failed', 'tool_failed', 'confirmation_required', undefined, null]) {
            expect(isToolAuthorityDenial(code)).toBe(false);
        }
    });
});
