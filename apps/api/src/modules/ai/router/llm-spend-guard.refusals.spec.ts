import { LlmSpendGuardService, isUnbilledRefusal } from './llm-spend-guard.service';
import { LLM_MODEL_CATALOGUE } from './llm-router.service';

const price = LLM_MODEL_CATALOGUE.find(m => m.id === 'gpt-4.1-mini')!;
const request = { messages: [{ role: 'user', content: 'hola '.repeat(200) }], maxTokens: 512 } as any;

function harness(providerName: string, failure?: unknown, response?: any) {
    const prisma = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
    const guard = new LlmSpendGuardService(prisma as any, {} as any, {} as any);
    jest.spyOn(guard, 'reserve').mockResolvedValue('res-1');
    const provider: any = {
        providerName,
        generate: failure ? jest.fn().mockRejectedValue(failure) : jest.fn().mockResolvedValue(response),
        generateStream: jest.fn(),
    };
    return { prisma, wrapped: guard.wrap(provider, 'tenant-1', price) };
}

const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), { status, ...extra });

/** El monto que quedó cargado a la reserva tras un intento fallido. */
async function settledAfter(error: unknown, providerName = 'openai'): Promise<number> {
    const { prisma, wrapped } = harness(providerName, error);
    await expect(wrapped.generate(request)).rejects.toBe(error);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, id, amount] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/basis='failed_estimate'/);
    expect(id).toBe('res-1');
    return amount;
}

describe('Rechazos que el proveedor no factura se liquidan en 0 (ADR-0027)', () => {
    it.each([
        ['429 sin créditos (8-nov)', httpError(429, '429 You have no credits remaining. Please add credits to continue.')],
        ['insufficient_quota', httpError(429, 'You exceeded your current quota', { code: 'insufficient_quota' })],
        ['401 clave inválida', httpError(401, 'Incorrect API key provided')],
        ['403 sin permiso', httpError(403, 'Forbidden')],
        ['402 sin saldo (DeepSeek)', httpError(402, 'Insufficient Balance')],
        ['429 límite de tasa', httpError(429, 'Rate limit reached for gpt-4.1-mini')],
        ['404 modelo inexistente', httpError(404, 'The model `gpt-9` does not exist')],
    ])('%s → 0', async (_label, error) => {
        expect(await settledAfter(error)).toBe(0);
    });

    it('Anthropic sin saldo responde 400, y también es 0', async () => {
        expect(await settledAfter(httpError(400, 'Your credit balance is too low to access the Anthropic API'), 'anthropic')).toBe(0);
    });

    it('un 5xx conserva el piso de entrada: el proveedor pudo haber procesado', async () => {
        expect(await settledAfter(httpError(500, 'upstream error'))).toBeGreaterThan(0);
    });

    it('un 400 de petición mal formada conserva el piso de entrada', async () => {
        expect(await settledAfter(httpError(400, "Invalid value for 'tool_choice'"))).toBeGreaterThan(0);
    });

    it('un timeout nuestro (sin status) deja la reserva completa', async () => {
        const { prisma, wrapped } = harness('openai', Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
        await expect(wrapped.generate(request)).rejects.toThrow('timed out');
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('isUnbilledRefusal respeta la excepción de Google: su 429 de cuota es límite por minuto', () => {
        expect(isUnbilledRefusal(httpError(429, 'You exceeded your current quota'), 'google')).toBe(true); // rate_limit
        expect(isUnbilledRefusal(httpError(500, 'boom'), 'google')).toBe(false);
    });

    it('una respuesta exitosa con caché se liquida a tarifa de caché', async () => {
        const { prisma, wrapped } = harness('openai', undefined, {
            content: 'ok', finishReason: 'stop',
            usage: { promptTokens: 10_000, completionTokens: 0, totalTokens: 10_000, cachedPromptTokens: 10_000 },
        });
        await wrapped.generate(request);
        const [sql, , amount, basis] = prisma.$executeRawUnsafe.mock.calls[0];
        expect(sql).toMatch(/basis=\$3/);
        expect(basis).toBe('reported_tokens_estimate');
        expect(amount).toBeGreaterThanOrEqual(1_000); // 10k × $0,10/M = 1.000 micro-USD
        expect(amount).toBeLessThanOrEqual(1_001);    // a precio completo serían 4.000
    });
});
