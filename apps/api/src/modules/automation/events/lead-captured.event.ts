/**
 * Evento emitido cuando se captura un nuevo lead en el sistema.
 * Fuentes posibles: WhatsApp inbound, formulario de intake, creacion manual.
 */
export interface LeadCapturedEvent {
    tenantId: string;
    schemaName: string;
    leadId: string;
    contactId: string;
    conversationId?: string;
    opportunityId?: string;
    campaignId?: string;
    courseId?: string;
    phone: string;
    name?: string;
    channel?: string;
    source: 'whatsapp_inbound' | 'intake_form' | 'manual';
    isNew?: boolean;
}
