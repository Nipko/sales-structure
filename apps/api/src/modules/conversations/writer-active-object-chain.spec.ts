import {
    ACTIVE_OBJECT_KINDS,
    deepLinkForActiveObject,
    type ActiveObjectKind,
} from '@parallext/shared';
import { STATIC_TOOL_NAMES, isBusinessWriteTool, toolOrigin } from './tool-policy-registry';
import { ACTIVE_OBJECT_EXPOSURE_POLICY } from './active-object-policy';

/**
 * ═══ EL AGENTE ESCRIBE UNA FILA; ¿DÓNDE LA ABRE UNA PERSONA? ═══
 *
 * La cadena tiene tres eslabones y cada uno se rompía distinto:
 *
 * 1. **Writer → tipo de objeto.** `create_vehicle_rental` y
 *    `create_pet_boarding` escribían filas de un tipo que no existía en el
 *    registro, así que el turno siguiente no las veía: el cliente preguntaba
 *    "¿hasta cuándo lo tengo?" y lo que el agente acababa de crear era
 *    invisible para él.
 * 2. **Tipo → carga en el turno.** Cinco cargadores para veintidós tipos.
 * 3. **Tipo → deep link.** Un panel que muestra una reserva sin decir dónde
 *    está la deja tan lejos como antes.
 *
 * Los dos primeros los cerraron U47 y U48 y tienen su propia prueba. Ésta cierra
 * el tercero y, sobre todo, **el enlace entre el primero y el tercero**: que
 * cada writer de negocio termine en algo que una persona pueda abrir.
 */

/**
 * Qué objeto deja cada escritura de negocio.
 *
 * Se declara porque no es derivable: `cancel_appointment` y `create_appointment`
 * dejan el mismo objeto, y `add_contact_note` no deja ninguno **a propósito** —
 * anotar lo que el cliente dijo no crea un registro operativo que alguien
 * tenga que abrir; se lee en la ficha del contacto, que el Inbox ya muestra.
 */
const WRITER_OBJECT: Readonly<Record<string, ActiveObjectKind | null>> = Object.freeze({
    create_appointment: 'appointment',
    cancel_appointment: 'appointment',
    reschedule_appointment: 'appointment',
    place_catalog_order: 'order',
    place_order: 'food_order',
    cancel_order: 'food_order',
    create_property_booking: 'property_booking',
    cancel_property_booking: 'property_booking',
    create_tour_booking: 'tour_booking',
    cancel_tour_booking: 'tour_booking',
    schedule_test_drive: 'appointment',
    enroll_student: 'enrollment',
    cancel_enrollment: 'enrollment',
    register_pet: 'pet',
    update_pet: 'pet',
    book_class: 'class_booking',
    cancel_class_booking: 'class_booking',
    freeze_membership: 'membership',
    calculate_quote: 'insurance_quote',
    cancel_quote: 'insurance_quote',
    file_claim: 'insurance_claim',
    create_service_request: 'service_request',
    cancel_service_request: 'service_request',
    create_vehicle_rental: 'vehicle_rental',
    cancel_vehicle_rental: 'vehicle_rental',
    create_pet_boarding: 'pet_boarding',
    cancel_pet_boarding: 'pet_boarding',
    request_photo_quote: 'photo_session',
    cancel_photo_session: 'photo_session',
    triage_pet_emergency: null,
    // ── Identidad: la llave, no la puerta ─────────────────────────────
    //
    // Las tres escriben —un código, un enlace de examen, un intento verificado—
    // y ninguna deja un registro operativo: son el paso previo a leer algo, no
    // la cosa que se lee.
    request_identity_code: null,
    verify_identity_code: null,
    get_placement_test_link: null,
    // ── CRM: anotar no crea un registro operativo ─────────────────────
    //
    // Las tres escriben en el CRM y ninguna deja algo que alguien tenga que
    // "abrir": la nota, la etiqueta y el interés se leen en la ficha del
    // contacto, que el Inbox muestra al lado de la conversación. Declararles un
    // tipo de objeto habría llenado el turno de ruido sin agregar ningún lugar
    // al que ir.
    add_contact_note: null,
    tag_contact: null,
    record_contact_interest: null,
    // ── Dinero: el enlace de pago no es un objeto del panel ───────────
    create_payment_link: null,
    refund_payment: null,
    apply_discount: null,
    // ── Salidas al canal: mandar algo no crea nada ───────────────────
    send_product_image: null,
    send_property_image: null,
    send_listing_image: null,
    send_vehicle_image: null,
    send_portfolio: null,
    send_booking_link: null,
});

const BUSINESS_WRITERS = STATIC_TOOL_NAMES.filter(isBusinessWriteTool);

describe('toda escritura de negocio declara qué objeto deja', () => {
    it('no hay writers sin clasificar', () => {
        // Un writer nuevo sin entrada acá es una fila que el agente crea y
        // nadie sabe dónde abrir. La prueba falla con su nombre, que es lo que
        // hace falta para clasificarlo.
        const unclassified = BUSINESS_WRITERS.filter(
            name => !Object.prototype.hasOwnProperty.call(WRITER_OBJECT, name),
        );
        expect(unclassified).toEqual([]);
    });

    it('y no hay clasificaciones de tools que ya no existen', () => {
        const stale = Object.keys(WRITER_OBJECT).filter(
            name => !STATIC_TOOL_NAMES.includes(name),
        );
        expect(stale).toEqual([]);
    });

    it('hay writers de verdad que revisar', () => {
        expect(BUSINESS_WRITERS.length).toBeGreaterThan(20);
    });
});

describe('lo que el agente crea, una persona lo puede abrir', () => {
    it('todo objeto que deja un writer tiene deep link', () => {
        // El plan exige que todo objeto que el agente toca tenga deep link
        // humano. Sin él, quien atiende lee "confirmame la reserva", tiene que
        // adivinar cuál, salir a buscarla y volver.
        const orphans: string[] = [];
        for (const [tool, kind] of Object.entries(WRITER_OBJECT)) {
            if (!kind) continue;
            if (!deepLinkForActiveObject(kind)) orphans.push(`${tool}→${kind}`);
        }
        expect(orphans).toEqual([]);
    });

    it('el tipo que deja cada writer es uno declarado', () => {
        const unknown = Object.entries(WRITER_OBJECT)
            .filter(([, kind]) => kind && !ACTIVE_OBJECT_KINDS.includes(kind))
            .map(([tool, kind]) => `${tool}→${kind}`);
        expect(unknown).toEqual([]);
    });

    it('un writer vertical nunca deja un objeto sin política de exposición', () => {
        // Sin política, el objeto entra o no al turno según quién lo cargue: la
        // clase de decisión que tiene que estar escrita, no emerger.
        for (const [tool, kind] of Object.entries(WRITER_OBJECT)) {
            if (!kind) continue;
            if (toolOrigin(tool) !== 'vertical') continue;
            expect({ tool, hasPolicy: !!ACTIVE_OBJECT_EXPOSURE_POLICY[kind] })
                .toEqual({ tool, hasPolicy: true });
        }
    });
});

describe('las excepciones son decisiones, no olvidos', () => {
    it('las tres escrituras de CRM no dejan objeto a propósito', () => {
        // Anotar lo que el cliente dijo no crea un registro operativo que
        // alguien tenga que abrir: se lee en la ficha del contacto, que el
        // Inbox ya muestra al lado de la conversación.
        for (const tool of ['add_contact_note', 'tag_contact', 'record_contact_interest']) {
            expect({ tool, kind: WRITER_OBJECT[tool] }).toEqual({ tool, kind: null });
        }
    });

    it('mandar una imagen o un enlace tampoco crea nada', () => {
        for (const tool of Object.keys(WRITER_OBJECT).filter(t => t.startsWith('send_'))) {
            expect({ tool, kind: WRITER_OBJECT[tool] }).toEqual({ tool, kind: null });
        }
    });

    it('la lista de excepciones no crece sin que se note', () => {
        // Si la mayoría de los writers no dejan objeto, la cadena dejó de
        // existir y esta prueba pasaría en verde igual.
        const withObject = Object.values(WRITER_OBJECT).filter(Boolean).length;
        const without = Object.values(WRITER_OBJECT).length - withObject;
        expect(withObject).toBeGreaterThan(without);
    });
});
