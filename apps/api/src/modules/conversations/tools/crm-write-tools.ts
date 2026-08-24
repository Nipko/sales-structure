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

/**
 * Create the CRM spine deliberately, instead of making every informational
 * conversation a lead as a side effect.  The current contact is trusted
 * server context; the model never supplies a contact or phone identifier.
 */
export const ENSURE_CRM_LEAD_TOOL: ToolDefinition = {
    name: 'ensure_crm_lead',
    description:
        'Create the CRM lead for the current customer only after the customer has shown a concrete '
        + 'commercial or service interest. If the lead already exists, return it without duplicating it. '
        + 'Do not use for greetings, FAQs, support-only questions, or unsolicited prospecting. '
        + 'The current contact is resolved by the server; never ask for or invent a contact ID.',
    parameters: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'Short factual reason the customer should enter the CRM, based only on what they said.',
            },
        },
        required: ['reason'],
    },
};

export const CREATE_CRM_OPPORTUNITY_TOOL: ToolDefinition = {
    name: 'create_crm_opportunity',
    description:
        'Create one sales/service opportunity for the current CRM lead when the customer is pursuing a '
        + 'specific outcome. It starts in the tenant\'s first configured pipeline stage and is deduplicated '
        + 'within this conversation. Never claim it is won, approved, booked, or paid.',
    parameters: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Concise factual name of the outcome the customer is pursuing.',
            },
            summary: {
                type: 'string',
                description: 'Optional factual context stated by the customer; no inference or recommendation.',
            },
            estimatedValue: {
                type: 'number',
                description: 'Optional amount only when the customer or canonical catalog explicitly supplied it.',
            },
            currency: {
                type: 'string',
                description: 'ISO-4217 currency paired with estimatedValue.',
            },
        },
        required: ['title'],
    },
};

export const MOVE_CRM_OPPORTUNITY_STAGE_TOOL: ToolDefinition = {
    name: 'move_crm_opportunity_stage',
    description:
        'Request a reviewed change of pipeline stage for an opportunity owned by the current customer. '
        + 'This action always requires human approval and the target must be an existing tenant stage. '
        + 'Never use it to infer qualification, approval, winning, loss, payment, or regulatory eligibility.',
    parameters: {
        type: 'object',
        properties: {
            opportunityId: { type: 'string', description: 'Existing opportunity UUID for the current customer.' },
            targetStage: { type: 'string', description: 'Exact configured pipeline stage slug.' },
            reason: {
                type: 'string',
                description: 'Factual evidence for the requested transition, stated by the customer or an executed tool.',
            },
        },
        required: ['opportunityId', 'targetStage', 'reason'],
    },
};

export const CREATE_FOLLOW_UP_TASK_TOOL: ToolDefinition = {
    name: 'create_follow_up_task',
    description:
        'Create a non-destructive follow-up task for the human team about the current CRM lead. '
        + 'Use only when the customer asks to be contacted later or a concrete next action cannot be completed now. '
        + 'The task is deduplicated; do not create reminders for ordinary FAQs.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Short actionable task title.' },
            description: { type: 'string', description: 'Optional factual context from the conversation.' },
            dueAt: {
                type: 'string',
                description: 'Optional future ISO-8601 timestamp with timezone; omit when the customer gave no time.',
            },
            opportunityId: {
                type: 'string',
                description: 'Optional opportunity UUID owned by the current customer.',
            },
            type: {
                type: 'string',
                enum: ['follow_up', 'call', 'meeting', 'email', 'handoff'],
            },
        },
        required: ['title'],
    },
};

export const RECORD_CONTACT_CONSENT_TOOL: ToolDefinition = {
    name: 'record_contact_consent',
    description:
        'Record the current customer\'s explicit acknowledgement of the tenant\'s active Privacy or Terms policy. '
        + 'The server resolves and hashes the active policy and asks the final confirmation; the model must not '
        + 'supply legal text, a version, a hash, or claim consent before that confirmation succeeds.',
    parameters: {
        type: 'object',
        properties: {
            policyType: {
                type: 'string',
                enum: ['privacy', 'terms'],
                description: 'The active tenant policy being acknowledged.',
            },
            scope: {
                type: 'string',
                description: 'Narrow purpose disclosed to the customer, for example contact_follow_up.',
            },
        },
        required: ['policyType', 'scope'],
    },
};

export const CRM_WRITE_TOOLS: ToolDefinition[] = [
    ENSURE_CRM_LEAD_TOOL,
    CREATE_CRM_OPPORTUNITY_TOOL,
    MOVE_CRM_OPPORTUNITY_STAGE_TOOL,
    CREATE_FOLLOW_UP_TASK_TOOL,
    RECORD_CONTACT_CONSENT_TOOL,
    ADD_CONTACT_NOTE_TOOL,
    TAG_CONTACT_TOOL,
    RECORD_CONTACT_INTEREST_TOOL,
];
