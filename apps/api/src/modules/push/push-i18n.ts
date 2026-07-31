/**
 * Agent/staff-facing i18n strings for push-listener.service.ts
 *
 * Push notifications are sent to AGENTS and ADMINS (not to customers).
 * The tenant's configured language drives the locale.
 *
 * Do NOT translate: log strings, technical keys, URLs/tags, brand names.
 * Preserve: emojis, {placeholders}.
 *
 * Usage:
 *   import { pushI18n } from './push-i18n';
 *   const t = pushI18n(tenantLanguage);
 *   { title: t.handoffTitle, body: t.handoffBody(contactName, reason) }
 */

type SupportedLang = 'es' | 'en' | 'pt' | 'fr';
const SUPPORTED = new Set<SupportedLang>(['es', 'en', 'pt', 'fr']);

/** Normalise any locale string ("es-CO", "EN", null) → 2-char code. */
function normalisePushLang(raw: string | null | undefined): SupportedLang {
    const code = (raw || 'es').slice(0, 2).toLowerCase() as SupportedLang;
    return SUPPORTED.has(code) ? code : 'es';
}

// ─── Contact/customer name fallback ──────────────────────────────────────────
const CONTACT_FALLBACK: Record<SupportedLang, string> = {
    es: 'Cliente',
    en: 'Customer',
    pt: 'Cliente',
    fr: 'Client',
};

// ─── "Conversation" fallback (used in SLA escalation body) ───────────────────
const CONVERSATION_FALLBACK: Record<SupportedLang, string> = {
    es: 'Conversación',
    en: 'Conversation',
    pt: 'Conversa',
    fr: 'Conversation',
};

// ─── "Service" fallback (used in appointment notification body) ───────────────
const SERVICE_FALLBACK: Record<SupportedLang, string> = {
    es: 'Servicio',
    en: 'Service',
    pt: 'Serviço',
    fr: 'Service',
};

// ─── Push message strings ─────────────────────────────────────────────────────
interface PushStrings {
    /** onHandoff — title of the push notification sent to the assigned agent */
    handoffTitle: string;
    /** onHandoff — body: "{contactName} needs attention — {reason}" */
    handoffBody: (contactName: string, reason: string) => string;

    /** onInboundMessage — title when an assigned agent gets a new customer message */
    newMessageTitle: string;
    /** onInboundMessage — fallback body when text is empty */
    newMessageFallback: string;

    /** onSupervisorEscalation — title for SLA breach alert */
    slaEscalationTitle: string;
    /** onSupervisorEscalation — body: "{contactName} has been waiting >5 minutes" */
    slaEscalationBody: (contactName: string) => string;

    /** onAppointment — title for new appointment */
    newAppointmentTitle: string;

    /** onFoodOrder — title for a new food order placed from the chat */
    newOrderTitle: string;
    /** onFoodOrder — body: "{customerName} · {orderType} · {total}" */
    newOrderBody: (customerName: string, orderType: string, total: string) => string;
    /** onFoodOrder — order type labels shown in the body */
    orderTypeDelivery: string;
    orderTypePickup: string;
    orderTypeDineIn: string;
    /** onFoodOrderCancelled — title when the customer cancels from the chat */
    orderCancelledTitle: string;
    /** onFoodOrderCancelled — body: "{customerName} cancelled the order" */
    orderCancelledBody: (customerName: string) => string;
}

const PUSH_STRINGS: Record<SupportedLang, PushStrings> = {
    es: {
        handoffTitle:          'Conversación escalada',
        handoffBody:           (name, reason) => `${name} necesita atención — ${reason}`,
        newMessageTitle:       'Nuevo mensaje',
        newMessageFallback:    'Nuevo mensaje',
        slaEscalationTitle:    'Escalación SLA',
        slaEscalationBody:     (name) => `${name} sin respuesta por más de 5 minutos`,
        newAppointmentTitle:   'Nueva cita agendada',
        newOrderTitle:         '🍽️ Pedido nuevo',
        newOrderBody:          (name, type, total) => `${name} · ${type} · ${total}`,
        orderTypeDelivery:     'Domicilio',
        orderTypePickup:       'Para recoger',
        orderTypeDineIn:       'En mesa',
        orderCancelledTitle:   'Pedido cancelado',
        orderCancelledBody:    (name) => `${name} canceló su pedido`,
    },
    en: {
        handoffTitle:          'Escalated conversation',
        handoffBody:           (name, reason) => `${name} needs attention — ${reason}`,
        newMessageTitle:       'New message',
        newMessageFallback:    'New message',
        slaEscalationTitle:    'SLA escalation',
        slaEscalationBody:     (name) => `${name} has been waiting for more than 5 minutes`,
        newAppointmentTitle:   'New appointment booked',
        newOrderTitle:         '🍽️ New order',
        newOrderBody:          (name, type, total) => `${name} · ${type} · ${total}`,
        orderTypeDelivery:     'Delivery',
        orderTypePickup:       'Pickup',
        orderTypeDineIn:       'Dine-in',
        orderCancelledTitle:   'Order cancelled',
        orderCancelledBody:    (name) => `${name} cancelled their order`,
    },
    pt: {
        handoffTitle:          'Conversa escalada',
        handoffBody:           (name, reason) => `${name} precisa de atenção — ${reason}`,
        newMessageTitle:       'Nova mensagem',
        newMessageFallback:    'Nova mensagem',
        slaEscalationTitle:    'Escalação SLA',
        slaEscalationBody:     (name) => `${name} sem resposta há mais de 5 minutos`,
        newAppointmentTitle:   'Nova consulta agendada',
        newOrderTitle:         '🍽️ Novo pedido',
        newOrderBody:          (name, type, total) => `${name} · ${type} · ${total}`,
        orderTypeDelivery:     'Entrega',
        orderTypePickup:       'Para retirar',
        orderTypeDineIn:       'Na mesa',
        orderCancelledTitle:   'Pedido cancelado',
        orderCancelledBody:    (name) => `${name} cancelou o pedido`,
    },
    fr: {
        handoffTitle:          'Conversation transférée',
        handoffBody:           (name, reason) => `${name} nécessite une attention — ${reason}`,
        newMessageTitle:       'Nouveau message',
        newMessageFallback:    'Nouveau message',
        slaEscalationTitle:    'Escalade SLA',
        slaEscalationBody:     (name) => `${name} sans réponse depuis plus de 5 minutes`,
        newAppointmentTitle:   'Nouveau rendez-vous planifié',
        newOrderTitle:         '🍽️ Nouvelle commande',
        newOrderBody:          (name, type, total) => `${name} · ${type} · ${total}`,
        orderTypeDelivery:     'Livraison',
        orderTypePickup:       'À emporter',
        orderTypeDineIn:       'Sur place',
        orderCancelledTitle:   'Commande annulée',
        orderCancelledBody:    (name) => `${name} a annulé sa commande`,
    },
};

// ─── Convenience getter ───────────────────────────────────────────────────────
export interface PushI18nContext extends PushStrings {
    lang: SupportedLang;
    contactFallback: string;
    conversationFallback: string;
    serviceFallback: string;
}

export function pushI18n(rawLang: string | null | undefined): PushI18nContext {
    const lang = normalisePushLang(rawLang);
    return {
        lang,
        contactFallback:      CONTACT_FALLBACK[lang],
        conversationFallback: CONVERSATION_FALLBACK[lang],
        serviceFallback:      SERVICE_FALLBACK[lang],
        ...PUSH_STRINGS[lang],
    };
}
