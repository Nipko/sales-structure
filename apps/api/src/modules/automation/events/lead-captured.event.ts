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
    /** El TIPO de canal (`whatsapp`, `instagram`…), no la conexión. */
    channel?: string;
    /**
     * La conexión concreta por la que llegó el lead: el `phone_number_id` de la
     * WABA, la cuenta de IG, el bot de Telegram.
     *
     * `channel` dice de qué clase de canal se trata y nunca alcanzó para
     * responder. Desde el 1 de octubre de 2026 Meta cobra cada mensaje de
     * servicio entregado a la cuenta del negocio, así que una regla de
     * automatización que manda una plantilla tiene que decir CUÁL de los números
     * del tenant paga. Sin esto el resolvedor elegía el más antiguo y la cuenta
     * que pagaba era una propiedad del orden de las filas.
     *
     * Opcional porque hay un origen que legítimamente no lo tiene: un lead de
     * formulario no llegó por ninguna conexión. Ese caso se resuelve nombrando
     * la conexión en la acción de la regla; y si nadie la nombra y el tenant
     * tiene más de una, el envío se rechaza en vez de cobrarle a cualquiera.
     */
    channelAccountId?: string;
    /**
     * El TIPO de canal de esa conexión, junto a ella y no aparte.
     *
     * `channelAccountId` sin su canal no significa nada: un id de Instagram y
     * un `phone_number_id` de WhatsApp son dos cadenas indistinguibles. Se
     * emitían juntas con `source: 'whatsapp_inbound'` fijo, así que un lead de
     * Instagram terminaba pidiéndole al resolvedor de WhatsApp una conexión
     * llamada `IG_ACCOUNT`. Van juntas o no van.
     */
    channelAccountType?: string;
    source: 'whatsapp_inbound' | 'intake_form' | 'manual';
    isNew?: boolean;
}
