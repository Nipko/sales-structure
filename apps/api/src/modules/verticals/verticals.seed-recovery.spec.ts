import { VerticalsService } from './verticals.service';

describe('VerticalsService seed recovery contracts', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const schemaName = 'tenant_seed_recovery';

    describe('seedAvailability', () => {
        it('rolls back a partial schedule and lets the retry commit every expected day', async () => {
            type Slot = {
                id: string;
                user_id: string;
                day_of_week: number;
                start_time: string;
                end_time: string;
            };

            let committedSlots: Slot[] = [];
            let transactionAttempt = 0;
            const insertAttempts: Array<{ transaction: number; day: number }> = [];

            const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
                transactionAttempt++;
                const thisAttempt = transactionAttempt;
                const workingSlots = committedSlots.map((slot) => ({ ...slot }));
                let insertsThisAttempt = 0;
                const query = jest.fn(async (sql: string, params: any[] = []) => {
                    if (sql.includes('pg_advisory_xact_lock')) return [];
                    if (sql.includes('FROM availability_slots')) {
                        return workingSlots.map(({ user_id, day_of_week, start_time, end_time }) => ({
                            user_id,
                            day_of_week,
                            start_time,
                            end_time,
                        }));
                    }
                    if (sql.includes('INSERT INTO availability_slots')) {
                        insertsThisAttempt++;
                        insertAttempts.push({ transaction: thisAttempt, day: params[2] });
                        if (thisAttempt === 1 && insertsThisAttempt === 2) {
                            throw new Error('injected second-slot failure');
                        }
                        workingSlots.push({
                            id: params[0],
                            user_id: params[1],
                            day_of_week: params[2],
                            start_time: params[3],
                            end_time: params[4],
                        });
                        return [];
                    }
                    throw new Error(`Unexpected availability SQL: ${sql}`);
                });

                // This assignment models PostgreSQL commit. If callback throws,
                // workingSlots is discarded and the durable state is unchanged.
                const result = await callback(query);
                committedSlots = workingSlots;
                return result;
            });
            const prisma: any = {
                user: {
                    findFirst: jest.fn().mockResolvedValue({ id: ownerId }),
                },
                transactionInTenantSchema,
            };
            const service = new VerticalsService(prisma, {} as any, {} as any);
            const definition: any = {
                businessHours: {
                    schedule: {
                        mon: '09:00-18:00',
                        tue: '09:00-18:00',
                        wed: '10:00-16:00',
                    },
                },
            };

            await expect((service as any).seedAvailability(
                tenantId,
                schemaName,
                definition,
            )).rejects.toThrow('injected second-slot failure');

            expect(committedSlots).toEqual([]);

            await expect((service as any).seedAvailability(
                tenantId,
                schemaName,
                definition,
            )).resolves.toBeUndefined();

            expect(transactionInTenantSchema).toHaveBeenCalledTimes(2);
            expect(transactionInTenantSchema.mock.calls.map((call: any[]) => call[0]))
                .toEqual([schemaName, schemaName]);
            expect(committedSlots).toHaveLength(3);
            expect(committedSlots.map((slot) => ({
                owner: slot.user_id,
                day: slot.day_of_week,
                start: slot.start_time,
                end: slot.end_time,
            }))).toEqual([
                { owner: ownerId, day: 1, start: '09:00', end: '18:00' },
                { owner: ownerId, day: 2, start: '09:00', end: '18:00' },
                { owner: ownerId, day: 3, start: '10:00', end: '16:00' },
            ]);
            expect(insertAttempts).toEqual([
                { transaction: 1, day: 1 },
                { transaction: 1, day: 2 },
                { transaction: 2, day: 1 },
                { transaction: 2, day: 2 },
                { transaction: 2, day: 3 },
            ]);
        });
    });

    describe('seedMembershipPlans', () => {
        function buildMembershipHarness(initialNames: string[]) {
            let committedPlans = initialNames.map((name, index) => ({ name, sort_order: index + 1 }));
            const insertedParams: any[][] = [];
            const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
                const workingPlans = committedPlans.map((plan) => ({ ...plan }));
                const query = jest.fn(async (sql: string, params: any[] = []) => {
                    if (sql.includes('pg_advisory_xact_lock')) return [];
                    if (sql.includes('SELECT name FROM membership_plans')) {
                        return [...workingPlans]
                            .sort((a, b) => a.sort_order - b.sort_order)
                            .map(({ name }) => ({ name }));
                    }
                    if (sql.includes('INSERT INTO membership_plans')) {
                        insertedParams.push([...params]);
                        workingPlans.push({ name: params[0], sort_order: params[8] });
                        return [];
                    }
                    throw new Error(`Unexpected membership SQL: ${sql}`);
                });
                const result = await callback(query);
                committedPlans = workingPlans;
                return result;
            });
            const service = new VerticalsService(
                { transactionInTenantSchema } as any,
                {} as any,
                {} as any,
            );
            return {
                service,
                insertedParams,
                names: () => committedPlans.map(({ name }) => name),
                transactionInTenantSchema,
            };
        }

        it('fills only the missing canonical plan from a cross-language canonical subset', async () => {
            const harness = buildMembershipHarness(['Mensual', 'Annual']);

            await (harness.service as any).seedMembershipPlans(schemaName, 'en');

            expect(harness.transactionInTenantSchema).toHaveBeenCalledTimes(1);
            expect(harness.names()).toEqual(['Mensual', 'Annual', 'Quarterly']);
            expect(harness.insertedParams).toHaveLength(1);
            expect(harness.insertedParams[0]).toEqual([
                'Quarterly',
                'Three months with unlimited classes and 15 freeze days',
                90,
                390000,
                null,
                1,
                3,
                15,
                2,
            ]);
        });

        it('does not append defaults when the tenant has any custom membership configuration', async () => {
            const harness = buildMembershipHarness(['Plan VIP personalizado']);

            await (harness.service as any).seedMembershipPlans(schemaName, 'es');

            expect(harness.names()).toEqual(['Plan VIP personalizado']);
            expect(harness.insertedParams).toEqual([]);
        });
    });

    describe('localized service and FAQ seeds', () => {
        it('does not duplicate semantic records after es -> en and probes every translation', async () => {
            type NamedRow = { name: string };
            type QuestionRow = { question: string };
            let committedServices: NamedRow[] = [];
            let committedFaqs: QuestionRow[] = [];
            const serviceQueries: Array<{ sql: string; params: any[] }> = [];
            const faqQueries: Array<{ sql: string; params: any[] }> = [];

            const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
                const workingServices = committedServices.map((row) => ({ ...row }));
                const workingFaqs = committedFaqs.map((row) => ({ ...row }));
                const query = jest.fn(async (sql: string, params: any[] = []) => {
                    if (sql.includes('pg_advisory_xact_lock')) return [];
                    if (sql.includes('INSERT INTO services')) {
                        serviceQueries.push({ sql, params: [...params] });
                        const translations = params[8] as string[];
                        if (!workingServices.some(({ name }) => translations.includes(name))) {
                            workingServices.push({ name: params[0] });
                        }
                        return [];
                    }
                    if (sql.includes('INSERT INTO faqs')) {
                        faqQueries.push({ sql, params: [...params] });
                        const translations = params[3] as string[];
                        if (!workingFaqs.some(({ question }) => translations.includes(question))) {
                            workingFaqs.push({ question: params[0] });
                        }
                        return [];
                    }
                    throw new Error(`Unexpected localized seed SQL: ${sql}`);
                });
                const result = await callback(query);
                committedServices = workingServices;
                committedFaqs = workingFaqs;
                return result;
            });
            const service = new VerticalsService(
                { transactionInTenantSchema } as any,
                {} as any,
                {} as any,
            );
            const definition: any = {
                services: [
                    {
                        name: { es: 'Consulta inicial', en: 'Initial consultation', pt: 'Consulta inicial PT', fr: 'Consultation initiale' },
                        description: { es: 'Descripción ES', en: 'Description EN', pt: 'Descrição PT', fr: 'Description FR' },
                        durationMinutes: 45,
                        price: 100000,
                        currency: 'COP',
                        category: 'consulta',
                    },
                    {
                        name: { es: 'Seguimiento', en: 'Follow-up', pt: 'Acompanhamento', fr: 'Suivi' },
                        description: { es: 'Seguimiento ES', en: 'Follow-up EN', pt: 'Acompanhamento PT', fr: 'Suivi FR' },
                        durationMinutes: 30,
                        price: 80000,
                        currency: 'COP',
                        category: 'consulta',
                    },
                ],
                faqs: [
                    {
                        question: { es: '¿Atienden los sábados?', en: 'Are you open Saturdays?', pt: 'Abrem aos sábados?', fr: 'Êtes-vous ouverts le samedi ?' },
                        answer: { es: 'Sí.', en: 'Yes.', pt: 'Sim.', fr: 'Oui.' },
                        category: 'horarios',
                    },
                    {
                        question: { es: '¿Qué medios de pago aceptan?', en: 'Which payment methods do you accept?', pt: 'Quais meios de pagamento aceitam?', fr: 'Quels moyens de paiement acceptez-vous ?' },
                        answer: { es: 'Tarjeta y transferencia.', en: 'Card and transfer.', pt: 'Cartão e transferência.', fr: 'Carte et virement.' },
                        category: 'pagos',
                    },
                ],
            };

            await (service as any).seedServices(schemaName, definition, 'es');
            await (service as any).seedServices(schemaName, definition, 'en');
            await (service as any).seedFaqs(schemaName, definition, 'es');
            await (service as any).seedFaqs(schemaName, definition, 'en');

            expect(committedServices).toEqual([
                { name: 'Consulta inicial' },
                { name: 'Seguimiento' },
            ]);
            expect(committedFaqs).toEqual([
                { question: '¿Atienden los sábados?' },
                { question: '¿Qué medios de pago aceptan?' },
            ]);
            expect(serviceQueries).toHaveLength(4);
            expect(faqQueries).toHaveLength(4);
            for (const { sql } of serviceQueries) {
                expect(sql).toContain('name = ANY($9::text[])');
            }
            for (const { sql } of faqQueries) {
                expect(sql).toContain('question = ANY($4::text[])');
            }
            expect(serviceQueries[0].params[8]).toEqual([
                'Consulta inicial',
                'Initial consultation',
                'Consulta inicial PT',
                'Consultation initiale',
            ]);
            expect(serviceQueries[1].params[8]).toEqual([
                'Seguimiento',
                'Follow-up',
                'Acompanhamento',
                'Suivi',
            ]);
            expect(serviceQueries[2].params[8]).toEqual(serviceQueries[0].params[8]);
            expect(serviceQueries[3].params[8]).toEqual(serviceQueries[1].params[8]);
            expect(faqQueries[0].params[3]).toEqual([
                '¿Atienden los sábados?',
                'Are you open Saturdays?',
                'Abrem aos sábados?',
                'Êtes-vous ouverts le samedi ?',
            ]);
            expect(faqQueries[1].params[3]).toEqual([
                '¿Qué medios de pago aceptan?',
                'Which payment methods do you accept?',
                'Quais meios de pagamento aceitam?',
                'Quels moyens de paiement acceptez-vous ?',
            ]);
            expect(faqQueries[2].params[3]).toEqual(faqQueries[0].params[3]);
            expect(faqQueries[3].params[3]).toEqual(faqQueries[1].params[3]);
        });
    });
});
