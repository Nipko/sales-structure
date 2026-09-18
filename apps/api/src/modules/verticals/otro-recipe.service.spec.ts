import { OtroRecipeService } from './otro-recipe.service';

/**
 * D9 (sep-2026): "Otro" deja de ser la hoja en blanco.
 *
 * Todo lo que el modelo devuelve pasa por el mismo lint que las recetas
 * escritas a mano, y se descarta ENTERA si algo falla. Estas pruebas fijan esa
 * postura: media receta con un precio inventado es peor que ninguna.
 */
describe('the recipe a model writes for a business that fits nowhere', () => {
    const FOUR = (es: string) => ({ es, en: es, pt: es, fr: es });

    function goodRecipe() {
        return {
            family: 'orders_retail',
            purchaseModes: ['order', 'inform'],
            mainInstructions: FOUR('Respondes qué hay, cuánto cuesta y cómo lo reciben, y tomas el pedido con nombre y dirección.'),
            whenUnsure: [
                FOUR('Lo confirmo con el equipo y te escribo.'),
                FOUR('Déjame tu dato y te lo confirmamos.'),
                FOUR('Te paso con una persona del equipo.'),
            ],
            // El motivo visible va emparejado con el disparador exacto que lo
            // cumple; uno inventado hace que el lint descarte la receta entera.
            handoffReasons: [
                { trigger: 'reclamo formal', text: FOUR('Reclamo formal') },
                { trigger: 'hablar con una persona', text: FOUR('Pide hablar con una persona') },
                { trigger: 'quiero mi dinero', text: FOUR('Quiere su dinero de vuelta') },
            ],
            canonicalQuestions: Array.from({ length: 5 }, (_, i) => ({
                question: FOUR(`Pregunta ${i + 1}`),
                answer: FOUR('Cuesta [precio] y llega en [tiempo].'),
            })),
            recommendedChannels: [{ channel: 'whatsapp', why: FOUR('Es por donde ya te escriben.') }],
            testQuestions: [FOUR('¿Tienen [producto]?'), FOUR('¿Hacen envíos?'), FOUR('¿Cómo pago?')],
            conversationExamples: Array.from({ length: 3 }, () => ({
                customer: FOUR('hola, info'),
                agent: FOUR('¡Hola! Cuéntame qué buscas y te digo si lo tenemos.'),
            })),
        };
    }

    function build(modelContent: string | Error, options?: { about?: string; stored?: any }) {
        const execute = jest.fn(async (_options: any): Promise<any> => {
            if (modelContent instanceof Error) throw modelContent;
            return { content: modelContent, model: 'test-model' };
        });
        const prisma: any = {
            tenant: { findUnique: jest.fn(async () => ({ schemaName: 'tenant_x', settings: options?.stored ? { generatedRecipe: options.stored } : {} })) },
            executeInTenantSchema: jest.fn(async () => [{ about: options?.about ?? null }]),
            $executeRawUnsafe: jest.fn(async () => 1),
        };
        const redis: any = {
            get: jest.fn(async () => null),
            set: jest.fn(async () => undefined),
            acquireLockToken: jest.fn(async () => 'token'),
            releaseLockToken: jest.fn(async () => undefined),
        };
        const service = new OtroRecipeService(prisma, redis, { execute } as any);
        return { service, prisma, redis, execute };
    }

    const ABOUT = 'Vendemos repuestos para motos y hacemos domicilios en la ciudad.';

    it('guarda la receta que pasa el lint', async () => {
        const { service, prisma, execute } = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        const record = await service.generate('11111111-1111-1111-1111-111111111111');
        expect(execute).toHaveBeenCalledTimes(1);
        expect(record?.recipe.family).toBe('orders_retail');
        expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    });

    it('pide el modelo con techo de nivel y con el tenant, para que la llamada se pueda ver y apagar', async () => {
        const { service, execute } = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        await service.generate('11111111-1111-1111-1111-111111111111');
        const options = execute.mock.calls[0][0];
        // Sin techo, el router habilita los cuatro niveles y una cuenta básica
        // escribe su receta en el modelo más caro del catálogo.
        expect(options.allowedTiers).toEqual(['tier_2_standard', 'tier_3_efficient']);
        // Sin tenantId no hay reserva de presupuesto ni atribución de costo: la
        // generación sería invisible y nadie podría apagarla.
        expect(options.tenantId).toBe('11111111-1111-1111-1111-111111111111');
        expect(options.jsonMode).toBe(true);
    });

    it('descarta la receta entera cuando una sola respuesta dice un precio', async () => {
        const bad = goodRecipe();
        bad.canonicalQuestions[2].answer = FOUR('Cuesta $80.000 con envío incluido.');
        const { service, prisma } = build(JSON.stringify(bad), { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('descarta una receta que dice una dirección', async () => {
        const bad = goodRecipe();
        bad.canonicalQuestions[1].answer = FOUR('Estamos en Calle 93 #12-34, cerca del parque.');
        const { service, prisma } = build(JSON.stringify(bad), { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('descarta una receta cuyo motivo nombra un disparador que no existe', async () => {
        // Es la ficha que el motor nunca iba a cumplir: la pantalla promete el
        // pase a una persona y el runtime no escala.
        const bad: any = goodRecipe();
        bad.handoffReasons[0].trigger = 'audiencia con el rey';
        const { service, prisma } = build(JSON.stringify(bad), { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('descarta un motivo sin disparador declarado', async () => {
        const bad: any = goodRecipe();
        delete bad.handoffReasons[1].trigger;
        const { service, prisma } = build(JSON.stringify(bad), { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('le dice al modelo cuáles son los disparadores reales, para que no invente uno', async () => {
        const { service, execute } = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        await service.generate('11111111-1111-1111-1111-111111111111');
        expect(execute.mock.calls[0][0].systemPrompt).toContain('reclamo formal');
    });

    it('descarta una lista a la que le falta un idioma', async () => {
        const bad: any = goodRecipe();
        bad.testQuestions[1] = { es: 'solo español' };
        const { service, prisma } = build(JSON.stringify(bad), { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('tolera cercas de código alrededor del JSON', async () => {
        // El modo JSON de Anthropic es una frase en el prompt, no una
        // restricción de decodificación, y la cadena de respaldo puede mandar
        // esta llamada allá.
        const { service } = build('```json\n' + JSON.stringify(goodRecipe()) + '\n```', { about: ABOUT });
        const record = await service.generate('11111111-1111-1111-1111-111111111111');
        expect(record?.recipe.canonicalQuestions).toHaveLength(5);
    });

    it('no guarda nada cuando el modelo devuelve prosa', async () => {
        const { service, prisma } = build('Claro, aquí tienes la receta del negocio.', { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('no llama al modelo cuando la descripción no describe un negocio', async () => {
        const { service, execute } = build(JSON.stringify(goodRecipe()), { about: 'tienda' });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('un fallo del modelo nunca sale hacia afuera', async () => {
        // Un alta no puede romperse porque un proveedor esté caído o porque el
        // tenant se haya pasado de presupuesto.
        const { service } = build(new Error('llm_budget_exceeded'), { about: ABOUT });
        await expect(service.generate('11111111-1111-1111-1111-111111111111')).resolves.toBeNull();
    });

    it('no regenera cuando la descripción no cambió', async () => {
        const stored = { recipe: goodRecipe(), sourceHash: '', generatedAt: 'x' };
        const { service, execute, prisma } = build(JSON.stringify(goodRecipe()), { about: ABOUT, stored });
        // El hash guardado tiene que coincidir con el de la descripción actual.
        const first = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        const fresh = await first.service.generate('11111111-1111-1111-1111-111111111111');
        stored.sourceHash = fresh!.sourceHash;
        prisma.tenant.findUnique = jest.fn(async () => ({ schemaName: 'tenant_x', settings: { generatedRecipe: stored } })) as any;
        const again = await service.generate('11111111-1111-1111-1111-111111111111');
        expect(again?.sourceHash).toBe(stored.sourceHash);
        expect(execute).not.toHaveBeenCalled();
    });

    it('un segundo intento en paralelo no dispara una segunda generación', async () => {
        const { service, execute, redis } = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        redis.acquireLockToken = jest.fn(async () => null);
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('no vuelve a pagarle al modelo mientras el enfriamiento está puesto', async () => {
        // El candado se suelta al terminar, así que sin enfriamiento una receta
        // que el lint rechaza producía una llamada pagada en CADA carga de la
        // pantalla del día 0.
        const { service, execute, redis } = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        redis.get = jest.fn(async () => '1');
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('marca el enfriamiento antes de llamar, no después', async () => {
        // Si el proceso muere en el medio, el siguiente intento espera en vez
        // de repetir una llamada que quizá ya se cobró.
        const { service, redis } = build(JSON.stringify(goodRecipe()), { about: ABOUT });
        await service.generate('11111111-1111-1111-1111-111111111111');
        expect(redis.set).toHaveBeenCalled();
    });

    it('descarta una receta a la que le falta lo mínimo para llamarse receta', async () => {
        // El lint cuenta lo que falta como `gap` para no romper la suite por
        // las industrias sin escribir. Un modelo que devuelve {"family":"..."}
        // no tiene esa excusa: pasaba las tres compuertas y se guardaba.
        const { service, prisma } = build(JSON.stringify({ family: 'booking' }), { about: ABOUT });
        expect(await service.generate('11111111-1111-1111-1111-111111111111')).toBeNull();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('sin modelo configurado no hace nada y no se queja', async () => {
        const prisma: any = { tenant: { findUnique: jest.fn() }, executeInTenantSchema: jest.fn(), $executeRawUnsafe: jest.fn() };
        const service = new OtroRecipeService(prisma, {} as any, undefined);
        await expect(service.generate('11111111-1111-1111-1111-111111111111')).resolves.toBeNull();
    });
});
