/**
 * «Lo averiguo» como acción real (C0 §1.5, rebanada R5, ADR 0011).
 *
 * Se publica solo cuando el contrato del turno lo ofrece (`<offers pending_question="true">`: CORE.PENDING.ROUTING
 * cumple). La llama el agente DESPUÉS de que el cliente aceptó que el equipo averigüe un dato que no consta; nunca para
 * ofrecerlo. Deja la consulta en la bandeja del dueño (`/admin/readiness/pending`) con la espera de esta conversación,
 * y el cliente recibe la respuesta en su idioma cuando el dueño responde.
 */
import { ToolDefinition } from '@parallext/shared';

export const REGISTER_PENDING_QUESTION_TOOL: ToolDefinition = {
    name: 'register_pending_question',
    description: 'Record a question the business must answer, AFTER the customer accepted your offer to ask the team ("lo consulto con el equipo y te aviso"). Only for a business fact that is NOT on record (listed in <knowledge_status><unknown>) or that no tool answers. Never call it to make the offer, never for something a tool or a <fact> already answers. The team answers in the dashboard and the customer receives the answer in this conversation. After it succeeds, tell the customer the team will reply (use expectedWithinHours when present); never claim it was recorded if it failed.',
    parameters: {
        type: 'object',
        properties: {
            question: { type: 'string', description: 'The customer\'s question, in their own words, short and self-contained (e.g. "¿Tienen parqueadero?")' },
            requirementId: { type: 'string', description: 'The id from <knowledge_status><unknown> this question is about (e.g. CORE.LOCATION.PARKING), when there is one' },
            language: { type: 'string', enum: ['es', 'en', 'pt', 'fr'], description: 'The language of the customer\'s message' },
        },
        required: ['question'],
    },
};

export const PENDING_QUESTION_TOOLS: ToolDefinition[] = [REGISTER_PENDING_QUESTION_TOOL];
