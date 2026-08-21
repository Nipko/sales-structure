import { ToolDefinition } from '@parallext/shared';

/**
 * Lo que el agente aprende y no podía anotar en ningún lado.
 *
 * El CRM tenía dos tools y las dos LEÍAN. El agente descubría en la
 * conversación que el cliente prefiere los martes, que le interesa el plan
 * anual, que ya lo llamaron dos veces sin respuesta — y nada de eso llegaba al
 * CRM. Quedaba en el historial del hilo, que ningún vendedor lee, y el humano
 * que tomaba la conversación después empezaba de cero.
 *
 * ── Por qué SÓLO estas tres ──────────────────────────────────────────────
 *
 * Un writer de CRM manejado por un modelo es una superficie peligrosa distinta
 * de una reserva: no falla ruidosamente, **ensucia**. Un lead con la etapa
 * equivocada, una etiqueta inventada o un campo pisado no se nota hasta que
 * alguien construye un reporte encima.
 *
 * Por eso las tres son **aditivas y no destructivas**: agregan una nota, suman
 * una etiqueta, marcan un intento de contacto. Ninguna pisa un valor que una
 * persona escribió, ninguna mueve la etapa del embudo —eso lo decide el motor
 * de reglas, que mira señales y no la opinión del modelo— y ninguna borra.
 *
 * `update_lead_stage` **no está a propósito**: existe un motor de transiciones
 * con reglas que el dueño configuró, y dejar que el modelo salte por encima
 * volvería decorativo ese motor.
 */

export const ADD_CONTACT_NOTE_TOOL: ToolDefinition = {
    name: 'add_contact_note',
    description:
        'Record a short, factual note about the current customer in the CRM so the team sees it later: '
        + 'a stated preference, a constraint, an objection, or what was agreed. '
        + 'Use it when the customer says something a human would want to know before calling them back. '
        + 'Write facts the customer stated, never your interpretation or a summary of your own reply. '
        + 'The contact is already resolved — no contactId parameter needed.',
    parameters: {
        type: 'object',
        properties: {
            note: {
                type: 'string',
                description: 'The fact to record, in one or two sentences, in the customer\'s language.',
            },
        },
        required: ['note'],
    },
};

export const TAG_CONTACT_TOOL: ToolDefinition = {
    name: 'tag_contact',
    description:
        'Add an existing CRM tag to the current customer. '
        + 'Only tags the business already created can be applied — if the tag does not exist the call fails, '
        + 'and that is deliberate: inventing tags makes the CRM unusable for filtering. '
        + 'Use it to mark a segment the customer clearly belongs to based on what they said.',
    parameters: {
        type: 'object',
        properties: {
            tag: { type: 'string', description: 'An existing tag name, exactly as the business wrote it.' },
        },
        required: ['tag'],
    },
};

export const RECORD_CONTACT_INTEREST_TOOL: ToolDefinition = {
    name: 'record_contact_interest',
    description:
        'Record what the customer said they are interested in (a service, a product, a plan) '
        + 'so the team can follow up on the right thing. '
        + 'This does NOT move the customer through the sales funnel and does not promise anything to them.',
    parameters: {
        type: 'object',
        properties: {
            interest: {
                type: 'string',
                description: 'What the customer named, in their own words.',
            },
        },
        required: ['interest'],
    },
};

export const CRM_WRITE_TOOLS: ToolDefinition[] = [
    ADD_CONTACT_NOTE_TOOL,
    TAG_CONTACT_TOOL,
    RECORD_CONTACT_INTEREST_TOOL,
];
