/**
 * Lo que el agente usa del bucle de conocimiento pendiente (C0 §1.5, rebanada R5, ADR 0011): aceptar «lo averiguo».
 *
 * Es un token y no la clase PendingQuestionsService a propósito, igual que `business-readiness.port.ts`: el ejecutor de
 * herramientas lo cargan también los scripts de auditoría (docs/audits) sin el paquete @parallext/business-spec
 * compilado, y la clase lo arrastra en tiempo de ejecución. ConversationsModule lo enlaza a PendingQuestionsService
 * (`useExisting`).
 */
export const PENDING_QUESTIONS = 'PENDING_QUESTIONS';

export interface PendingQuestionsPort {
    acceptWait(tenantId: string, input: {
        question: string;
        requirementId?: string | null;
        itemRef?: string | null;
        conversationId: string;
        contactId?: string | null;
        language?: string | null;
    }): Promise<{ id: string; status: string; slaDueAt: string | null; waitersCount: number; alreadyWaiting: boolean }>;
}
