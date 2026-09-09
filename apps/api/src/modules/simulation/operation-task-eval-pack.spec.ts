import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildDomainContractDraft, composeSubtypeEvalPack, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { bindCanonicalEvalFixtures, CANONICAL_EVAL_FIXTURE_IDS, resolveCanonicalEvalFixtures } from './eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { buildTaskCompetenceMatrix, hasPositiveTaskAssertion } from './task-competence-matrix';
import { CANONICAL_EVAL_TOOL_FAMILIES, CANONICAL_EVAL_TOOLS } from './isolated-eval-namespace';
import { canEvalExecuteWriter, EVAL_SANDBOX_CONTACT_ID, EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';
import { TOOL_POLICY_REGISTRY } from '../conversations/tool-policy-registry';
import { EVAL_IDENTITY_READERS } from './eval-identity-fixture';
import { ASSURANCE_LEVEL_MATRIX } from '@parallext/shared';

const fixture = resolveCanonicalEvalFixtures({ capturedAt: '2026-09-07T15:00:00Z', config: { hours: { timezone: 'America/Bogota', schedule: {} } } } as AgentEvaluationSnapshot);
if (fixture.status !== 'ready') throw new Error('fixture_blocked');
const ids = CANONICAL_EVAL_FIXTURE_IDS;
const CASES = ['complete', 'repeat', 'question', 'handoff'];
const POSITIVE = new Set(['complete', 'repeat']);
const source = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

/** Cada intención con su writer, su familia y la fila exacta que se afirma. */
const OPERATIONS: Record<string, { writer: string; family: string; table: string; where: Record<string, unknown> }> = {
    book_stay: {
        writer: 'create_property_booking', family: 'property_bookings', table: 'property_bookings',
        where: {
            property_id: ids.property, guest_name: 'Alex Rivera', guests_count: 2,
            check_in: { op: 'date_eq', value: fixture.date }, check_out: { op: 'date_eq', value: fixture.endDate },
            night_price: 100, cleaning_fee: 0, currency: 'COP',
            status: 'confirmed', amount_due: null, hold_expires_at: null,
        },
    },
    book_tour: {
        writer: 'create_tour_booking', family: 'tour_bookings', table: 'tour_bookings',
        where: {
            package_id: ids.tourPackage, inventory_id: ids.tourInventory, guest_name: 'Alex Rivera',
            departure_date: { op: 'date_eq', value: fixture.date },
            party_size: 2, adults: 2, children: 0,
            unit_price: 50, total_price: 100, currency: 'COP',
            status: 'reserved', amount_due: null, hold_expires_at: null,
        },
    },
    place_food_order: {
        writer: 'place_order', family: 'restaurant_orders', table: 'food_orders',
        where: {
            order_type: 'pickup', customer_name: 'Alex Rivera',
            subtotal: 20, delivery_fee: 0, discount: 0, total: 20, currency: 'COP',
            status: 'received', payment_status: 'pending', estimated_delivery_at: null,
        },
    },
    request_service: {
        writer: 'create_service_request', family: 'service_requests', table: 'service_requests',
        where: {
            status: 'pending', customer_name: 'Alex Rivera', customer_phone: '+573000000001',
            address: { op: 'ilike', value: '%Calle 45 #12-30%' }, currency: 'COP',
            service_id: null, scheduled_at: null, assigned_technician_name: null,
        },
    },
    request_photo_quote: {
        writer: 'request_photo_quote', family: 'photo_sessions', table: 'photo_sessions',
        where: {
            status: 'requested', session_type: 'wedding',
            client_name: 'Alex Rivera', client_phone: '+573000000001',
            scheduled_at: { op: 'date_eq', value: fixture.date },
            price: null, deposit_paid: 0, currency: 'COP',
        },
    },
    board_pet: {
        writer: 'create_pet_boarding', family: 'resource_rentals', table: 'resource_rentals',
        where: {
            rental_type: 'pet_boarding', resource_id: ids.pet, service_id: ids.boardingService,
            start_date: { op: 'date_eq', value: fixture.date }, end_date: { op: 'date_eq', value: fixture.endDate },
            status: 'reserved', version: 1, created_by: null,
        },
    },
};

describe('service, lodging and food operation competence pack', () => {
    it('declares the committed and the untouched cases for every profile and language', () => {
        let tasks = 0;
        for (const profileId of listCanonicalSubtypeExperienceProfileIds()) {
            const [industry, subtype] = profileId.split('/');
            const intents = buildDomainContractDraft(industry, subtype).intents;
            for (const [key, operation] of Object.entries(OPERATIONS)) {
                const task = intents.find(item => item.key === key);
                if (task) tasks++;
                for (const language of EVAL_LANGUAGES) {
                    const cases = composeSubtypeEvalPack({ industry, subtype, language })
                        .filter(item => item.key.startsWith(`intent_${key}_canonical_`));
                    expect(cases).toHaveLength(task ? CASES.length : 0);
                    for (const scenario of cases) {
                        expect(scenario.profileId).toBe(profileId);
                        expect(scenario.language).toBe(language);
                        // Every token must bind, and no scenario may leak the
                        // sandbox adapter's own placeholder year into a case.
                        expect(JSON.stringify(bindCanonicalEvalFixtures(scenario, fixture))).not.toMatch(/\{\{fixture\.|2099/);
                        expect(scenario.messages.length).toBeLessThanOrEqual(8);
                    }
                    if (!task) continue;
                    for (const caseKey of CASES) {
                        const scenario = cases.find(item => item.key.endsWith(`_${caseKey}_v1`))!;
                        expect(scenario).toBeDefined();
                        expect(hasPositiveTaskAssertion(task.toolPlan, scenario)).toBe(POSITIVE.has(caseKey));
                    }
                    const untouched = cases.find(item => item.key.endsWith('_handoff_v1'))!;
                    expect(untouched.expectedActions).toEqual([
                        { kind: 'tool_call', type: 'not_called', tool: operation.writer },
                        { kind: 'db_effect', type: 'no_row', family: operation.family, table: operation.table },
                    ]);
                }
            }
        }
        // 7 servicios a domicilio + 4 fotografía + 4 restaurantes + 2 turismo
        // + 2 alojamiento + 2 guardería.
        expect(tasks).toBe(21);
    });

    it('asserts the columns the production command persists, not merely that some row appeared', () => {
        for (const [key, operation] of Object.entries(OPERATIONS)) {
            const profile = buildTaskCompetenceMatrix().profiles.find(item => item.tasks.some(task => task.key === key))!;
            const [industry, subtype] = profile.profileId.split('/');
            const pack = composeSubtypeEvalPack({ industry, subtype, language: 'en' });
            const complete = bindCanonicalEvalFixtures(pack.find(item => item.key === `intent_${key}_canonical_complete_v1`)!, fixture);
            const row = complete.expectedActions!.find(item => item.kind === 'db_effect' && item.type === 'row_exists')! as any;
            expect(row.where).toEqual(operation.where);
            expect(complete.expectedActions).toContainEqual({ kind: 'tool_call', type: 'called', tool: operation.writer });
            expect(complete.expectedActions).toContainEqual({ kind: 'db_effect', type: 'row_count',
                family: operation.family, table: operation.table, count: 1 });
            const repeat = pack.find(item => item.key === `intent_${key}_canonical_repeat_v1`)!;
            expect(repeat.expectedActions).toContainEqual({ kind: 'db_effect', type: 'row_count',
                family: operation.family, table: operation.table, count: 1 });
        }
    });

    /**
     * El estado afirmado tiene que ser el que escribe PRODUCCIÓN.
     *
     * El adaptador SQL del sandbox escribe otro para la estadía: nace ahí
     * `pending`. Copiarlo habría certificado lo contrario del producto — que
     * una estadía sin política de pago queda esperando un cobro que nadie va a
     * pedir. Estas comprobaciones atan cada literal a su comando.
     */
    it('takes each status literal from the production command and not from the sandbox adapter', () => {
        const sandbox = source('../conversations/eval-writer-sandbox.ts');
        expect(sandbox).toMatch(/property_bookings[\s\S]*?'pending'/);
        expect(OPERATIONS.book_stay.where.status).toBe('confirmed');
        expect(source('../vacation-rental/properties.service.ts'))
            .toContain("const status = policy.requiresPayment ? PENDING_PAYMENT_STATUS : 'confirmed';");
        expect(source('../tours/tours.service.ts'))
            .toContain("const status = policy.requiresPayment ? PENDING_PAYMENT_STATUS : 'reserved';");
        // `payment_policy` nace en `'none'` para propiedades y paquetes, así que
        // ninguna de las dos exige pago y ninguna retiene fechas.
        expect(source('../../../prisma/tenant-schema.sql')).toContain("ADD COLUMN IF NOT EXISTS payment_policy VARCHAR(16) DEFAULT ''none''");
        // La guardería nace `reserved` porque el cupo queda tomado; el alquiler
        // de vehículo nace `pending_review` y no está en este pack.
        expect(source('../resource-rentals/resource-rentals.service.ts'))
            .toMatch(/initialStatus[\s\S]*?'vehicle_rental'\s*\?\s*'pending_review'\s*:\s*'reserved'/);
        expect(OPERATIONS.board_pet.where.status).toBe('reserved');
        // El pedido de comida no fija estado: lo pone el DDL.
        expect(source('../../../prisma/tenant-schema.sql')).toContain(`"status" VARCHAR(20) DEFAULT 'received'`);
        expect(source('../home-services/home-services.service.ts'))
            .toContain("const status = data.status || (scheduledAt ? 'scheduled' : 'pending');");
    });

    /**
     * Sin esto la evaluación despierta gente de verdad: un correo de emergencia
     * a los responsables del tenant, dos notificaciones push al dueño y un
     * correo de confirmación a la casilla que el modelo haya inventado.
     */
    it('suppresses every external effect of these commands inside a leased namespace', () => {
        expect(source('../home-services/home-services.service.ts'))
            .toContain("if (!execution.sandboxNamespace) this.eventEmitter.emit('service_request.created'");
        expect(source('../photography/photography.service.ts'))
            .toContain("if (status === 'requested' && !execution.sandboxNamespace) {");
        expect(source('../restaurants/restaurants.service.ts'))
            .toContain("if (!execution.sandboxNamespace) this.eventEmitter.emit('food_order.created'");
        expect(source('../tours/tours.service.ts'))
            .toContain('const guestEmail = execution.sandboxNamespace ? null : data.guestEmail;');
        expect(source('../vacation-rental/properties.service.ts'))
            .toContain('if (data.guestEmail && !execution.sandboxNamespace) {');
        // El arriendo, no el nombre del schema: un llamador de producción no
        // puede quedarse sin aviso por parecerse a una prueba.
        for (const file of ['../home-services/home-services.service.ts', '../photography/photography.service.ts',
            '../restaurants/restaurants.service.ts', '../tours/tours.service.ts', '../vacation-rental/properties.service.ts']) {
            expect(source(file)).toContain('execution: { sandboxNamespace?: EvalNamespaceLease }');
        }
        // La reserva de recurso no tiene efecto externo que apagar: escribe SQL
        // y su propia bitácora, sin eventos, correos ni proveedores.
        const rentals = source('../resource-rentals/resource-rentals.service.ts');
        expect(rentals).not.toMatch(/eventEmitter|emailService|renderAndSend/);
    });

    it('admits each writer to the namespace and keeps it out of a real tenant schema', () => {
        const namespace = source('./isolated-eval-namespace.ts');
        for (const [key, operation] of Object.entries(OPERATIONS)) {
            expect(CANONICAL_EVAL_TOOLS.has(operation.writer)).toBe(true);
            expect(CANONICAL_EVAL_TOOL_FAMILIES[operation.writer]).toBe(operation.family);
            const family = EVAL_WRITER_SANDBOX_FAMILIES[operation.family];
            expect(family.status).toBe('audited');
            expect(family.contactColumn).toBe('contact_id');
            expect(family.table).toBe(operation.table);
            // Audited no es permiso para escribir el schema real de un tenant:
            // estos comandos emiten avisos, retienen fechas y descuentan cupo.
            expect(family.canonicalOnly).toBe(true);
            expect(canEvalExecuteWriter(operation.writer, EVAL_SANDBOX_CONTACT_ID)).toBe(false);
            expect(key).toBeTruthy();
        }
        // Las dos tablas que estos comandos leen o escriben y que el namespace
        // no clonaba: sin ellas la reserva falla por una relación ausente o se
        // revierte entera al escribir su bitácora.
        expect(namespace).toContain("'ical_blocks'");
        expect(namespace).toContain("'resource_rentals', 'resource_rental_events'");
        // El alquiler de vehículo comparte familia y tabla con la guardería y
        // aun así queda afuera: el guardián central le exige identidad
        // escalada, y la identidad sintética del namespace sólo cubre lectores.
        expect(CANONICAL_EVAL_TOOLS.has('create_vehicle_rental')).toBe(false);
        expect(EVAL_IDENTITY_READERS.has('create_vehicle_rental')).toBe(false);
        expect(TOOL_POLICY_REGISTRY.create_vehicle_rental.assuranceEnforcement).toBe('step_up');
        expect(ASSURANCE_LEVEL_MATRIX[TOOL_POLICY_REGISTRY.create_vehicle_rental.assurance].requiresStepUpIdentity).toBe(true);
        for (const writer of Object.values(OPERATIONS)) {
            expect(ASSURANCE_LEVEL_MATRIX[TOOL_POLICY_REGISTRY[writer.writer].assurance].requiresStepUpIdentity).toBe(false);
        }
    });

    it('clears the missing-positive gap for the six operations without claiming certification', () => {
        const matrix = buildTaskCompetenceMatrix();
        let tasks = 0;
        for (const profile of matrix.profiles) for (const task of profile.tasks.filter(item => OPERATIONS[item.key])) {
            tasks++;
            expect(task.gaps).not.toContain('positive_task_case_missing');
            expect(task.gaps).not.toContain('effect_verifier_missing');
            expect(task.gaps).toContain('profile_execution_evidence_missing');
            expect(profile.certification.certified).toBe(false);
        }
        expect(tasks).toBe(21);
        // Los seis que quedan sin caso positivo lo siguen estando por su
        // control de identidad, no por falta de escenario: los cinco perfiles
        // de `file_claim` y `automotriz/alquiler`. Cerrarlos exigiría darle
        // identidad verificada a un writer sensible desde una prueba.
        expect(matrix.summary.tasksMissingPositiveCases).toBe(6);
        const pending = matrix.profiles.flatMap(profile => profile.tasks
            .filter(task => task.gaps.includes('positive_task_case_missing'))
            .map(task => `${profile.profileId}/${task.key}`));
        expect(pending.sort()).toEqual(['automotriz/alquiler/rent_vehicle', 'seguros/aseguradora/file_claim',
            'seguros/auto/file_claim', 'seguros/broker/file_claim', 'seguros/salud/file_claim', 'seguros/vida/file_claim']);
    });
});
