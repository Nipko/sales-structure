/**
 * ═══ THE FOUR RECEIPTS NO SEEDED TEMPLATE DESCRIBED ═══
 *
 * Four `emailConfirmations` controls named an operation the template catalogue
 * could not express, so wiring them to what existed would have asserted
 * something the product cannot do:
 *
 *   · `restaurants` pointed at `restaurant_reservation_confirmation` — "Tu Mesa
 *     está Reservada", with a date, an hour and a 15-minute tolerance. The only
 *     writer in that family produces a FOOD ORDER (delivery / pickup /
 *     dine-in), and the family has no table-reservation operation at all. The
 *     email would have promised a table nobody booked.
 *   · `repairOrders` pointed at nothing; `automotive_service_confirmation` is
 *     an APPOINTMENT template ("Cita de servicio confirmada") and a workshop
 *     intake is not an appointment.
 *   · `vehicleRentals` and `petBoarding` pointed at nothing; the closest,
 *     `petservice_booking_confirmation`, carries a date and an hour, and a
 *     boarding is a RANGE — its "Hora del servicio" row would have rendered
 *     empty on every send.
 *
 * ── WHY GENERATED AND NOT SIXTEEN HAND-WRITTEN BLOBS ────────────────────────
 *
 * Sixteen escaped HTML strings (four receipts × four languages) is how the
 * Portuguese one ends up two redesigns behind the Spanish one. The markup lives
 * here once and only the copy differs per language, which is exactly the
 * arrangement `appointment-email-layout.ts` already uses in this module.
 *
 * Two hard constraints come from the renderer in `email-templates.service.ts`:
 *   · `{{#if x}}…{{/if}}` is a flat, non-greedy regular expression — blocks
 *     must NOT nest;
 *   · there is no `{{else}}`, so anything needing a fallback is pre-resolved by
 *     the caller.
 *
 * The markup is table-free but inline-styled, like its siblings, because
 * Outlook still drops `<style>` blocks.
 *
 * ── WHAT THESE RECEIPTS DELIBERATELY DO NOT SAY ─────────────────────────────
 *
 * Each carries a closing note naming what has NOT happened yet: a workshop
 * intake is not a diagnosis or a price, and a reserved rental still depends on
 * the documents the branch checks at pickup. A receipt that overstates is worse
 * than no receipt, because the customer acts on it.
 */

export const OPERATION_RECEIPT_KINDS = [
    'restaurant_order',
    'repair_order',
    'vehicle_rental',
    'pet_boarding',
] as const;

export type OperationReceiptKind = typeof OPERATION_RECEIPT_KINDS[number];

export const OPERATION_RECEIPT_SLUGS: Record<OperationReceiptKind, string> = {
    restaurant_order: 'restaurant_order_confirmation',
    repair_order: 'repair_order_confirmation',
    vehicle_rental: 'vehicle_rental_confirmation',
    pet_boarding: 'pet_boarding_confirmation',
};

/** Header gradient per receipt, so the four are visibly different families. */
const ACCENT: Record<OperationReceiptKind, { from: string; to: string; ink: string; rule: string }> = {
    restaurant_order: { from: '#e67e22', to: '#d35400', ink: 'white', rule: '#e67e22' },
    repair_order: { from: '#636e72', to: '#2d3436', ink: 'white', rule: '#636e72' },
    vehicle_rental: { from: '#0984e3', to: '#074a80', ink: 'white', rule: '#0984e3' },
    pet_boarding: { from: '#55efc4', to: '#00b894', ink: '#2d3436', rule: '#00b894' },
};

/**
 * The rows each receipt prints, in order.
 *
 * `optional` wraps the row in an `{{#if}}` so an absent value hides its whole
 * line instead of printing a label with nothing after it — the defect that made
 * the pet-care template unusable for a boarding in the first place.
 */
interface ReceiptField {
    readonly variable: string;
    readonly optional?: boolean;
}

const FIELDS: Record<OperationReceiptKind, readonly ReceiptField[]> = {
    restaurant_order: [
        { variable: 'order_type' },
        { variable: 'estimated_ready', optional: true },
        { variable: 'delivery_address', optional: true },
        { variable: 'table_number', optional: true },
        { variable: 'payment_method', optional: true },
    ],
    repair_order: [
        { variable: 'vehicle' },
        { variable: 'reported_concern' },
        { variable: 'mileage', optional: true },
    ],
    vehicle_rental: [
        { variable: 'vehicle' },
        { variable: 'pickup_date' },
        { variable: 'return_date' },
        { variable: 'pickup_location', optional: true },
        { variable: 'driver_name', optional: true },
    ],
    pet_boarding: [
        { variable: 'pet_name' },
        { variable: 'service_name' },
        { variable: 'check_in' },
        { variable: 'check_out' },
    ],
};

/** Every variable a receipt can render, for the template row's `variables`. */
export function operationReceiptVariables(kind: OperationReceiptKind): string[] {
    const base = ['customer_name', 'company_name', 'company_logo', 'reference'];
    const fields = FIELDS[kind].map(field => field.variable);
    return kind === 'restaurant_order'
        ? [...base, ...fields, 'order_items_html', 'order_total']
        : [...base, ...fields];
}

interface ReceiptCopy {
    readonly name: string;
    readonly subject: string;
    readonly heading: string;
    readonly greeting: string;
    readonly intro: string;
    readonly referenceLabel: string;
    /** Label per variable, in the same order as FIELDS. */
    readonly labels: Record<string, string>;
    readonly totalLabel?: string;
    /** What has NOT happened yet. Never omitted. */
    readonly note: string;
    readonly footer: string;
}

type Language = 'es' | 'en' | 'pt' | 'fr';

const COPY: Record<Language, Record<OperationReceiptKind, ReceiptCopy>> = {
    es: {
        restaurant_order: {
            name: 'Confirmación de Pedido (Restaurante)',
            subject: 'Pedido #{{reference}} recibido — {{company_name}}',
            heading: 'Pedido Recibido 🍽️',
            greeting: 'Hola',
            intro: 'Recibimos tu pedido y ya pasó a la cocina. Estos son los detalles:',
            referenceLabel: 'Número de pedido',
            labels: {
                order_type: 'Tipo de pedido',
                estimated_ready: 'Listo aproximadamente',
                delivery_address: 'Dirección de entrega',
                table_number: 'Mesa',
                payment_method: 'Forma de pago',
            },
            totalLabel: 'Total',
            note: 'Este correo confirma que recibimos el pedido, no que ya fue entregado ni cobrado. Si algo no coincide, respóndenos por el mismo chat antes de que salga de la cocina.',
            footer: '¡Buen provecho! — {{company_name}}',
        },
        repair_order: {
            name: 'Comprobante de Ingreso al Taller',
            subject: 'Orden de reparación #{{reference}} abierta — {{company_name}}',
            heading: 'Vehículo Recibido 🔧',
            greeting: 'Hola',
            intro: 'Abrimos una orden de reparación con lo que nos contaste. Así quedó registrada:',
            referenceLabel: 'Número de orden',
            labels: {
                vehicle: 'Vehículo',
                reported_concern: 'Problema reportado',
                mileage: 'Kilometraje',
            },
            note: 'El problema reportado es lo que nos dijiste, no un diagnóstico. Todavía no hay presupuesto: cuando el taller revise el vehículo te vamos a enviar el detalle para que lo apruebes antes de tocar nada.',
            footer: 'Gracias por confiarnos tu vehículo — {{company_name}}',
        },
        vehicle_rental: {
            name: 'Confirmación de Alquiler de Vehículo',
            subject: 'Alquiler #{{reference}} confirmado — {{company_name}}',
            heading: 'Alquiler Confirmado 🚗',
            greeting: 'Hola',
            intro: 'Tu alquiler quedó reservado. Estos son los datos que tenemos:',
            referenceLabel: 'Número de alquiler',
            labels: {
                vehicle: 'Vehículo',
                pickup_date: 'Retiro',
                return_date: 'Devolución',
                pickup_location: 'Lugar de retiro',
                driver_name: 'Conductor',
            },
            note: 'La reserva está confirmada. Al momento del retiro necesitamos ver en persona el documento de identidad, la licencia vigente del conductor y el medio de pago de la garantía.',
            footer: '¡Buen viaje! — {{company_name}}',
        },
        pet_boarding: {
            name: 'Confirmación de Guardería / Hotel de Mascotas',
            subject: 'Estadía #{{reference}} confirmada — {{company_name}}',
            heading: 'Estadía Confirmada 🐾',
            greeting: 'Hola',
            intro: 'Reservamos la estadía de tu mascota. Estos son los detalles:',
            referenceLabel: 'Número de reserva',
            labels: {
                pet_name: 'Mascota',
                service_name: 'Servicio',
                check_in: 'Ingreso',
                check_out: 'Salida',
            },
            note: 'Por favor trae el carnet de vacunas al día, el alimento habitual y cualquier medicación con sus indicaciones. Sin el carnet no podemos recibir a tu mascota.',
            footer: 'La vamos a cuidar como en casa — {{company_name}}',
        },
    },
    en: {
        restaurant_order: {
            name: 'Order Confirmation (Restaurant)',
            subject: 'Order #{{reference}} received — {{company_name}}',
            heading: 'Order Received 🍽️',
            greeting: 'Hello',
            intro: 'We have your order and it has gone through to the kitchen. Here are the details:',
            referenceLabel: 'Order number',
            labels: {
                order_type: 'Order type',
                estimated_ready: 'Ready at approximately',
                delivery_address: 'Delivery address',
                table_number: 'Table',
                payment_method: 'Payment method',
            },
            totalLabel: 'Total',
            note: 'This email confirms that we received the order, not that it has been delivered or charged. If anything looks wrong, reply in the same chat before it leaves the kitchen.',
            footer: 'Enjoy your meal! — {{company_name}}',
        },
        repair_order: {
            name: 'Workshop Intake Receipt',
            subject: 'Repair order #{{reference}} opened — {{company_name}}',
            heading: 'Vehicle Received 🔧',
            greeting: 'Hello',
            intro: 'We opened a repair order with what you told us. This is how it was recorded:',
            referenceLabel: 'Order number',
            labels: {
                vehicle: 'Vehicle',
                reported_concern: 'Reported problem',
                mileage: 'Mileage',
            },
            note: 'The reported problem is what you described, not a diagnosis. There is no estimate yet: once the workshop inspects the vehicle we will send you the detail to approve before any work starts.',
            footer: 'Thank you for trusting us with your vehicle — {{company_name}}',
        },
        vehicle_rental: {
            name: 'Vehicle Rental Confirmation',
            subject: 'Rental #{{reference}} confirmed — {{company_name}}',
            heading: 'Rental Confirmed 🚗',
            greeting: 'Hello',
            intro: 'Your rental is reserved. This is what we have on file:',
            referenceLabel: 'Rental number',
            labels: {
                vehicle: 'Vehicle',
                pickup_date: 'Pick-up',
                return_date: 'Return',
                pickup_location: 'Pick-up location',
                driver_name: 'Driver',
            },
            note: 'The reservation is confirmed. At pick-up we need to see the ID document, the driver\'s valid licence and the payment method for the deposit in person.',
            footer: 'Safe travels! — {{company_name}}',
        },
        pet_boarding: {
            name: 'Pet Boarding Confirmation',
            subject: 'Stay #{{reference}} confirmed — {{company_name}}',
            heading: 'Stay Confirmed 🐾',
            greeting: 'Hello',
            intro: 'We have booked your pet\'s stay. Here are the details:',
            referenceLabel: 'Booking number',
            labels: {
                pet_name: 'Pet',
                service_name: 'Service',
                check_in: 'Check-in',
                check_out: 'Check-out',
            },
            note: 'Please bring an up-to-date vaccination record, the usual food and any medication with its instructions. Without the vaccination record we cannot take your pet in.',
            footer: 'We will look after them like family — {{company_name}}',
        },
    },
    pt: {
        restaurant_order: {
            name: 'Confirmação de Pedido (Restaurante)',
            subject: 'Pedido #{{reference}} recebido — {{company_name}}',
            heading: 'Pedido Recebido 🍽️',
            greeting: 'Olá',
            intro: 'Recebemos o seu pedido e ele já foi para a cozinha. Estes são os detalhes:',
            referenceLabel: 'Número do pedido',
            labels: {
                order_type: 'Tipo de pedido',
                estimated_ready: 'Pronto aproximadamente',
                delivery_address: 'Endereço de entrega',
                table_number: 'Mesa',
                payment_method: 'Forma de pagamento',
            },
            totalLabel: 'Total',
            note: 'Este e-mail confirma que recebemos o pedido, não que ele já foi entregue ou cobrado. Se algo não estiver certo, responda no mesmo chat antes de o pedido sair da cozinha.',
            footer: 'Bom apetite! — {{company_name}}',
        },
        repair_order: {
            name: 'Comprovante de Entrada na Oficina',
            subject: 'Ordem de reparo #{{reference}} aberta — {{company_name}}',
            heading: 'Veículo Recebido 🔧',
            greeting: 'Olá',
            intro: 'Abrimos uma ordem de reparo com o que você nos contou. Foi registrada assim:',
            referenceLabel: 'Número da ordem',
            labels: {
                vehicle: 'Veículo',
                reported_concern: 'Problema relatado',
                mileage: 'Quilometragem',
            },
            note: 'O problema relatado é o que você descreveu, não um diagnóstico. Ainda não há orçamento: quando a oficina revisar o veículo enviaremos o detalhe para você aprovar antes de qualquer serviço.',
            footer: 'Obrigado por confiar seu veículo a nós — {{company_name}}',
        },
        vehicle_rental: {
            name: 'Confirmação de Aluguel de Veículo',
            subject: 'Aluguel #{{reference}} confirmado — {{company_name}}',
            heading: 'Aluguel Confirmado 🚗',
            greeting: 'Olá',
            intro: 'Seu aluguel está reservado. Estes são os dados que temos:',
            referenceLabel: 'Número do aluguel',
            labels: {
                vehicle: 'Veículo',
                pickup_date: 'Retirada',
                return_date: 'Devolução',
                pickup_location: 'Local de retirada',
                driver_name: 'Condutor',
            },
            note: 'A reserva está confirmada. Na retirada precisamos ver pessoalmente o documento de identidade, a carteira de habilitação válida do condutor e o meio de pagamento da garantia.',
            footer: 'Boa viagem! — {{company_name}}',
        },
        pet_boarding: {
            name: 'Confirmação de Hospedagem de Animais',
            subject: 'Estadia #{{reference}} confirmada — {{company_name}}',
            heading: 'Estadia Confirmada 🐾',
            greeting: 'Olá',
            intro: 'Reservamos a estadia do seu animal. Estes são os detalhes:',
            referenceLabel: 'Número da reserva',
            labels: {
                pet_name: 'Animal',
                service_name: 'Serviço',
                check_in: 'Entrada',
                check_out: 'Saída',
            },
            note: 'Por favor traga a carteira de vacinação em dia, a ração habitual e qualquer medicação com as instruções. Sem a carteira de vacinação não podemos receber o seu animal.',
            footer: 'Vamos cuidar dele como em casa — {{company_name}}',
        },
    },
    fr: {
        restaurant_order: {
            name: 'Confirmation de Commande (Restaurant)',
            subject: 'Commande #{{reference}} reçue — {{company_name}}',
            heading: 'Commande Reçue 🍽️',
            greeting: 'Bonjour',
            intro: 'Nous avons reçu votre commande et elle est partie en cuisine. Voici les détails :',
            referenceLabel: 'Numéro de commande',
            labels: {
                order_type: 'Type de commande',
                estimated_ready: 'Prête vers',
                delivery_address: 'Adresse de livraison',
                table_number: 'Table',
                payment_method: 'Moyen de paiement',
            },
            totalLabel: 'Total',
            note: 'Ce courriel confirme que nous avons reçu la commande, pas qu\'elle a été livrée ni encaissée. Si quelque chose ne correspond pas, répondez dans le même chat avant qu\'elle ne quitte la cuisine.',
            footer: 'Bon appétit ! — {{company_name}}',
        },
        repair_order: {
            name: 'Reçu de Prise en Charge à l\'Atelier',
            subject: 'Ordre de réparation #{{reference}} ouvert — {{company_name}}',
            heading: 'Véhicule Reçu 🔧',
            greeting: 'Bonjour',
            intro: 'Nous avons ouvert un ordre de réparation avec ce que vous nous avez indiqué. Voici son enregistrement :',
            referenceLabel: 'Numéro d\'ordre',
            labels: {
                vehicle: 'Véhicule',
                reported_concern: 'Problème signalé',
                mileage: 'Kilométrage',
            },
            note: 'Le problème signalé est celui que vous avez décrit, pas un diagnostic. Il n\'y a pas encore de devis : dès que l\'atelier aura examiné le véhicule, nous vous enverrons le détail à approuver avant toute intervention.',
            footer: 'Merci de nous confier votre véhicule — {{company_name}}',
        },
        vehicle_rental: {
            name: 'Confirmation de Location de Véhicule',
            subject: 'Location #{{reference}} confirmée — {{company_name}}',
            heading: 'Location Confirmée 🚗',
            greeting: 'Bonjour',
            intro: 'Votre location est réservée. Voici les informations dont nous disposons :',
            referenceLabel: 'Numéro de location',
            labels: {
                vehicle: 'Véhicule',
                pickup_date: 'Prise en charge',
                return_date: 'Retour',
                pickup_location: 'Lieu de prise en charge',
                driver_name: 'Conducteur',
            },
            note: 'La réservation est confirmée. Lors de la prise en charge, nous devons voir en personne la pièce d\'identité, le permis de conduire valide et le moyen de paiement de la caution.',
            footer: 'Bon voyage ! — {{company_name}}',
        },
        pet_boarding: {
            name: 'Confirmation de Pension pour Animal',
            subject: 'Séjour #{{reference}} confirmé — {{company_name}}',
            heading: 'Séjour Confirmé 🐾',
            greeting: 'Bonjour',
            intro: 'Nous avons réservé le séjour de votre animal. Voici les détails :',
            referenceLabel: 'Numéro de réservation',
            labels: {
                pet_name: 'Animal',
                service_name: 'Service',
                check_in: 'Arrivée',
                check_out: 'Départ',
            },
            note: 'Merci d\'apporter le carnet de vaccination à jour, l\'alimentation habituelle et tout médicament avec sa posologie. Sans le carnet de vaccination, nous ne pouvons pas accueillir votre animal.',
            footer: 'Nous nous en occuperons comme à la maison — {{company_name}}',
        },
    },
};

const language = (lang: string): Language =>
    (['es', 'en', 'pt', 'fr'] as const).includes(lang as Language) ? lang as Language : 'es';

export function operationReceiptName(kind: OperationReceiptKind, lang: string): string {
    return COPY[language(lang)][kind].name;
}

export function operationReceiptSubject(kind: OperationReceiptKind, lang: string): string {
    return COPY[language(lang)][kind].subject;
}

/** One `<p>` per field, wrapped in `{{#if}}` when the field is optional. */
function rows(kind: OperationReceiptKind, copy: ReceiptCopy): string {
    return FIELDS[kind].map(field => {
        const line = `<p style="margin:6px 0;font-size:14px;">`
            + `<strong>${copy.labels[field.variable]}:</strong> {{${field.variable}}}</p>`;
        // Flat, never nested: the renderer's `{{#if}}` is a non-greedy regular
        // expression and a nested block would swallow the wrong `{{/if}}`.
        return field.optional
            ? `      {{#if ${field.variable}}}${line}{{/if}}`
            : `      ${line}`;
    }).join('\n');
}

export function buildOperationReceipt(kind: OperationReceiptKind, lang: string): string {
    const copy = COPY[language(lang)][kind];
    const accent = ACCENT[kind];
    // Only the restaurant receipt itemises: the others confirm one operation,
    // and an empty item block is a grey box with nothing in it.
    const itemised = kind === 'restaurant_order';
    return `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,${accent.from},${accent.to});padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:${accent.ink};margin:0;font-size:20px;">${copy.heading}</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">${copy.greeting} <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">${copy.intro}</p>
    <div style="background:#fafafa;padding:16px;border-radius:8px;border-left:4px solid ${accent.rule};margin:16px 0;">
      <p style="margin:6px 0;font-size:14px;"><strong>${copy.referenceLabel}:</strong> {{reference}}</p>
${rows(kind, copy)}
    </div>${itemised ? `
    <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:16px 0;">
      {{order_items_html}}
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;" />
      <p style="margin:4px 0;font-size:16px;text-align:right;"><strong>${copy.totalLabel}: {{order_total}}</strong></p>
    </div>` : ''}
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;font-size:13px;color:#666;line-height:1.6;margin-top:16px;">
      ${copy.note}
    </div>
    <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:16px;text-align:center;">
      ${copy.footer}
    </p>
  </div>
</div>`;
}
