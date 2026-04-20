/**
 * Pre-vetted Meta WhatsApp message templates that are auto-submitted for
 * approval when a tenant completes Embedded Signup.
 *
 * Design choices:
 * - All UTILITY (highest approval rate, no opt-in required).
 * - 3 templates that cover the three most common business cases on the platform.
 * - Localized bodies per tenant language — only one language per tenant gets
 *   submitted (not all 4) to avoid wasting Meta's template slots.
 * - `example` blocks included per Meta requirement for variables.
 */

export type MetaLanguage = 'es_MX' | 'en_US' | 'pt_BR' | 'fr';

/**
 * Map a tenant language tag (e.g. "es-CO", "pt-BR", "fr-FR") to the Meta
 * language code that yields the highest approval rate for that region.
 */
export function normalizeMetaLanguage(tenantLanguage?: string): MetaLanguage {
    const code = (tenantLanguage || 'es').toLowerCase().split(/[-_]/)[0];
    switch (code) {
        case 'en': return 'en_US';
        case 'pt': return 'pt_BR';
        case 'fr': return 'fr';
        case 'es':
        default:
            return 'es_MX';
    }
}

export interface MetaTemplateComponent {
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
    format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
    text?: string;
    example?: { body_text?: string[][]; header_text?: string[] };
    buttons?: Array<{
        type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
        text: string;
        url?: string;
        phone_number?: string;
    }>;
}

export interface MetaTemplatePayload {
    name: string;
    category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
    language: MetaLanguage;
    components: MetaTemplateComponent[];
}

type TemplateKey = 'appointment_reminder' | 'order_confirmation' | 'payment_received';

/**
 * Localized content for every seed template. Keeping the data flat makes it
 * easy to edit/translate without wading through JSON nesting.
 */
const CONTENT: Record<TemplateKey, Record<MetaLanguage, {
    header: string;
    body: string;
    footer: string;
    bodyExample: string[];
    buttons?: MetaTemplateComponent['buttons'];
}>> = {
    // ─────────────────────────────────────────────────────────────
    // 1. APPOINTMENT REMINDER — 6 variables
    // ─────────────────────────────────────────────────────────────
    appointment_reminder: {
        es_MX: {
            header: 'Recordatorio de tu cita',
            body:
                'Hola {{1}} 👋\n\n' +
                'Te recordamos tu cita programada:\n\n' +
                '🗓️ Servicio: {{2}}\n' +
                '📅 Fecha: {{3}}\n' +
                '⏰ Hora: {{4}}\n' +
                '👤 Con: {{5}}\n' +
                '📍 Dirección: {{6}}\n\n' +
                'Por favor llega 15 minutos antes para el registro.\n\n' +
                'Si necesitas reagendar o cancelar, responde a este mensaje.',
            footer: 'Gracias por confiar en nosotros',
            bodyExample: ['Carlos', 'Corte de cabello', '15 de abril', '3:00 PM', 'Juan Pérez', 'Calle 123 #45-67, Bogotá'],
            buttons: [
                { type: 'QUICK_REPLY', text: '✅ Confirmar asistencia' },
                { type: 'QUICK_REPLY', text: '🔄 Reagendar' },
            ],
        },
        en_US: {
            header: 'Appointment reminder',
            body:
                'Hi {{1}} 👋\n\n' +
                'This is a reminder of your upcoming appointment:\n\n' +
                '🗓️ Service: {{2}}\n' +
                '📅 Date: {{3}}\n' +
                '⏰ Time: {{4}}\n' +
                '👤 With: {{5}}\n' +
                '📍 Address: {{6}}\n\n' +
                'Please arrive 15 minutes early for check-in.\n\n' +
                'If you need to reschedule or cancel, reply to this message.',
            footer: 'Thank you for choosing us',
            bodyExample: ['Charles', 'Haircut', 'April 15', '3:00 PM', 'John Smith', '123 Main St, New York'],
            buttons: [
                { type: 'QUICK_REPLY', text: '✅ Confirm attendance' },
                { type: 'QUICK_REPLY', text: '🔄 Reschedule' },
            ],
        },
        pt_BR: {
            header: 'Lembrete de agendamento',
            body:
                'Olá {{1}} 👋\n\n' +
                'Lembramos o seu agendamento:\n\n' +
                '🗓️ Serviço: {{2}}\n' +
                '📅 Data: {{3}}\n' +
                '⏰ Horário: {{4}}\n' +
                '👤 Com: {{5}}\n' +
                '📍 Endereço: {{6}}\n\n' +
                'Por favor chegue 15 minutos antes para o registro.\n\n' +
                'Se precisar remarcar ou cancelar, responda a esta mensagem.',
            footer: 'Obrigado por sua confiança',
            bodyExample: ['Carlos', 'Corte de cabelo', '15 de abril', '15:00', 'João Silva', 'Rua das Flores 123, São Paulo'],
            buttons: [
                { type: 'QUICK_REPLY', text: '✅ Confirmar presença' },
                { type: 'QUICK_REPLY', text: '🔄 Remarcar' },
            ],
        },
        fr: {
            header: 'Rappel de rendez-vous',
            body:
                'Bonjour {{1}} 👋\n\n' +
                'Rappel de votre rendez-vous prévu:\n\n' +
                '🗓️ Service: {{2}}\n' +
                '📅 Date: {{3}}\n' +
                '⏰ Heure: {{4}}\n' +
                '👤 Avec: {{5}}\n' +
                '📍 Adresse: {{6}}\n\n' +
                'Merci d\'arriver 15 minutes en avance pour l\'enregistrement.\n\n' +
                'Si vous devez reporter ou annuler, répondez à ce message.',
            footer: 'Merci de votre confiance',
            bodyExample: ['Charles', 'Coupe de cheveux', '15 avril', '15h00', 'Jean Dupont', '123 rue de la Paix, Paris'],
            buttons: [
                { type: 'QUICK_REPLY', text: '✅ Confirmer' },
                { type: 'QUICK_REPLY', text: '🔄 Reporter' },
            ],
        },
    },

    // ─────────────────────────────────────────────────────────────
    // 2. ORDER CONFIRMATION — 5 variables, no buttons (keep it clean)
    // ─────────────────────────────────────────────────────────────
    order_confirmation: {
        es_MX: {
            header: 'Pedido confirmado',
            body:
                'Hola {{1}},\n\n' +
                'Confirmamos la recepción de tu pedido:\n\n' +
                '🧾 Número: #{{2}}\n' +
                '📦 Productos: {{3}}\n' +
                '💰 Total: {{4}}\n' +
                '⏱️ Entrega estimada: {{5}}\n\n' +
                'Te notificaremos cuando salga a envío. Si tienes preguntas, responde a este mensaje.',
            footer: 'Gracias por tu compra',
            bodyExample: ['María', 'ORD-2026-4581', '2x Zapatos deportivos', '$280.000 COP', '3-5 días hábiles'],
        },
        en_US: {
            header: 'Order confirmed',
            body:
                'Hi {{1}},\n\n' +
                'We\'ve confirmed your order:\n\n' +
                '🧾 Number: #{{2}}\n' +
                '📦 Products: {{3}}\n' +
                '💰 Total: {{4}}\n' +
                '⏱️ Estimated delivery: {{5}}\n\n' +
                'We\'ll notify you when it ships. Reply with any questions.',
            footer: 'Thank you for your purchase',
            bodyExample: ['Mary', 'ORD-2026-4581', '2x Running shoes', '$89.99 USD', '3-5 business days'],
        },
        pt_BR: {
            header: 'Pedido confirmado',
            body:
                'Olá {{1}},\n\n' +
                'Confirmamos o recebimento do seu pedido:\n\n' +
                '🧾 Número: #{{2}}\n' +
                '📦 Produtos: {{3}}\n' +
                '💰 Total: {{4}}\n' +
                '⏱️ Entrega estimada: {{5}}\n\n' +
                'Avisaremos quando for enviado. Responda com dúvidas.',
            footer: 'Obrigado pela sua compra',
            bodyExample: ['Maria', 'ORD-2026-4581', '2x Tênis esportivos', 'R$ 459,80', '3-5 dias úteis'],
        },
        fr: {
            header: 'Commande confirmée',
            body:
                'Bonjour {{1}},\n\n' +
                'Nous avons confirmé votre commande:\n\n' +
                '🧾 Numéro: #{{2}}\n' +
                '📦 Produits: {{3}}\n' +
                '💰 Total: {{4}}\n' +
                '⏱️ Livraison estimée: {{5}}\n\n' +
                'Nous vous notifierons à l\'expédition. Répondez pour toute question.',
            footer: 'Merci pour votre achat',
            bodyExample: ['Marie', 'ORD-2026-4581', '2x Chaussures de sport', '89,99 €', '3-5 jours ouvrés'],
        },
    },

    // ─────────────────────────────────────────────────────────────
    // 3. PAYMENT RECEIVED — 5 variables, no buttons
    // ─────────────────────────────────────────────────────────────
    payment_received: {
        es_MX: {
            header: 'Pago confirmado',
            body:
                'Hola {{1}},\n\n' +
                'Hemos recibido tu pago correctamente.\n\n' +
                '💵 Monto: {{2}}\n' +
                '🧾 Referencia: {{3}}\n' +
                '📄 Concepto: {{4}}\n' +
                '📅 Fecha: {{5}}\n\n' +
                'Guarda este mensaje como comprobante. Si necesitas una factura formal, responde a este mensaje.',
            footer: 'Transacción segura',
            bodyExample: ['Luis', '$150.000 COP', 'REF-8823-KLM', 'Consulta médica', '14 de abril de 2026'],
        },
        en_US: {
            header: 'Payment received',
            body:
                'Hi {{1}},\n\n' +
                'We\'ve received your payment successfully.\n\n' +
                '💵 Amount: {{2}}\n' +
                '🧾 Reference: {{3}}\n' +
                '📄 Description: {{4}}\n' +
                '📅 Date: {{5}}\n\n' +
                'Keep this message as proof of payment. Reply if you need a formal invoice.',
            footer: 'Secure transaction',
            bodyExample: ['Louis', '$75.00 USD', 'REF-8823-KLM', 'Medical consultation', 'April 14, 2026'],
        },
        pt_BR: {
            header: 'Pagamento recebido',
            body:
                'Olá {{1}},\n\n' +
                'Recebemos seu pagamento com sucesso.\n\n' +
                '💵 Valor: {{2}}\n' +
                '🧾 Referência: {{3}}\n' +
                '📄 Descrição: {{4}}\n' +
                '📅 Data: {{5}}\n\n' +
                'Guarde esta mensagem como comprovante. Responda se precisar de nota fiscal.',
            footer: 'Transação segura',
            bodyExample: ['Luís', 'R$ 250,00', 'REF-8823-KLM', 'Consulta médica', '14 de abril de 2026'],
        },
        fr: {
            header: 'Paiement reçu',
            body:
                'Bonjour {{1}},\n\n' +
                'Nous avons bien reçu votre paiement.\n\n' +
                '💵 Montant: {{2}}\n' +
                '🧾 Référence: {{3}}\n' +
                '📄 Description: {{4}}\n' +
                '📅 Date: {{5}}\n\n' +
                'Conservez ce message comme preuve. Répondez pour toute facture formelle.',
            footer: 'Transaction sécurisée',
            bodyExample: ['Louis', '75,00 €', 'REF-8823-KLM', 'Consultation médicale', '14 avril 2026'],
        },
    },
};

/**
 * Build the final Meta Graph API payloads for a given tenant language.
 * Returns the 3 seed templates ready to POST to
 * `/{waba-id}/message_templates`.
 */
export function buildSeedTemplatePayloads(tenantLanguage?: string): MetaTemplatePayload[] {
    const lang = normalizeMetaLanguage(tenantLanguage);
    const keys: TemplateKey[] = ['appointment_reminder', 'order_confirmation', 'payment_received'];

    return keys.map((key) => {
        const content = CONTENT[key][lang];
        const components: MetaTemplateComponent[] = [
            { type: 'HEADER', format: 'TEXT', text: content.header },
            {
                type: 'BODY',
                text: content.body,
                example: { body_text: [content.bodyExample] },
            },
            { type: 'FOOTER', text: content.footer },
        ];
        if (content.buttons && content.buttons.length > 0) {
            components.push({ type: 'BUTTONS', buttons: content.buttons });
        }
        return {
            name: key,
            category: 'UTILITY',
            language: lang,
            components,
        };
    });
}

/** Names of the 3 seed templates — useful for DB lookups and UI badging. */
export const SEED_TEMPLATE_NAMES: TemplateKey[] = [
    'appointment_reminder',
    'order_confirmation',
    'payment_received',
];
