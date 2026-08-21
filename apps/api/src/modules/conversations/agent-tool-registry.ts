import type { ToolDefinition, ToolsConfig } from '@parallext/shared';
import { APPOINTMENT_TOOLS } from './tools/appointment-tools';
import { CATALOG_TOOLS, OFFER_TOOL } from './tools/catalog-tools';
import { FAQ_TOOL, KB_TOOL, POLICY_TOOL } from './tools/knowledge-tools';
import { CUSTOMER_CONTEXT_TOOL, ORDER_TOOL } from './tools/crm-tools';
import { CRM_WRITE_TOOLS } from './tools/crm-write-tools';
import { ECOMMERCE_TOOLS } from './tools/ecommerce-tools';
import { VACATION_RENTAL_TOOLS } from './tools/vacation-rental-tools';
import { TOURS_TOOLS } from './tools/tours-tools';
import { TREATMENT_TOOLS } from './tools/treatment-tools';
import { LISTINGS_TOOLS } from './tools/listings-tools';
import { VEHICLE_TOOLS } from './tools/vehicle-tools';
import { PETS_TOOLS } from './tools/pets-tools';
import { RESTAURANTS_TOOLS } from './tools/restaurants-tools';
import { GYMS_TOOLS } from './tools/gyms-tools';
import { EDUCATION_TOOLS } from './tools/education-tools';
import { INSURANCE_TOOLS } from './tools/insurance-tools';
import {
    HOME_SERVICES_TOOLS,
    PET_SERVICES_TOOLS,
    PHOTOGRAPHY_TOOLS,
    PROFESSIONAL_SERVICES_TOOLS,
} from './tools/tier3-tools';
import { PET_BOARDING_TOOLS, VEHICLE_RENTAL_TOOLS } from './tools/resource-rental-tools';
import { PAYMENT_CREATE_TOOLS, PAYMENT_STATUS_TOOLS, REFUND_PAYMENT_TOOL } from './tools/payment-tools';

/**
 * The one place that maps an agent's saved tool config to tool families.
 *
 * This used to be an inline chain of `if (cfgTools?.x?.enabled)` inside
 * `generateResponse`, duplicated in `agent-test.service` and absent entirely
 * from the procedure engine — which is why a Procedure could call a tool the
 * agent had switched off, and why Agent Test could advertise a different set
 * than production. One list, three consumers.
 *
 * Deliberately synchronous and side-effect free: it answers "what may this
 * agent's config authorise", not "what is executable right now". Plan, quota,
 * provider health and readiness are separate gates applied per turn — a tool
 * can be authorised here and still be refused at execution, which is the
 * correct order.
 */

interface ToolFamily {
    key: keyof ToolsConfig;
    tools: readonly ToolDefinition[];
}

const TOOL_FAMILIES: readonly ToolFamily[] = [
    { key: 'appointments', tools: APPOINTMENT_TOOLS },
    { key: 'catalog', tools: CATALOG_TOOLS },
    { key: 'offers', tools: [OFFER_TOOL] },
    { key: 'faqs', tools: [FAQ_TOOL] },
    { key: 'policies', tools: [POLICY_TOOL] },
    { key: 'knowledge', tools: [KB_TOOL] },
    { key: 'orders', tools: [ORDER_TOOL] },
    { key: 'crm', tools: [CUSTOMER_CONTEXT_TOOL, ...CRM_WRITE_TOOLS] },
    { key: 'ecommerce', tools: ECOMMERCE_TOOLS },
    { key: 'properties', tools: VACATION_RENTAL_TOOLS },
    { key: 'tours', tools: TOURS_TOOLS },
    { key: 'treatments', tools: TREATMENT_TOOLS },
    { key: 'realEstate', tools: LISTINGS_TOOLS },
    { key: 'vehicles', tools: VEHICLE_TOOLS },
    { key: 'pets', tools: PETS_TOOLS },
    { key: 'restaurants', tools: RESTAURANTS_TOOLS },
    { key: 'gyms', tools: GYMS_TOOLS },
    { key: 'education', tools: EDUCATION_TOOLS },
    { key: 'insurance', tools: INSURANCE_TOOLS },
    { key: 'homeServices', tools: HOME_SERVICES_TOOLS },
    { key: 'petServices', tools: PET_SERVICES_TOOLS },
    { key: 'vehicleRentals', tools: VEHICLE_RENTAL_TOOLS },
    { key: 'petBoarding', tools: PET_BOARDING_TOOLS },
    { key: 'photography', tools: PHOTOGRAPHY_TOOLS },
    { key: 'professionalServices', tools: PROFESSIONAL_SERVICES_TOOLS },
];

function familyEnabled(cfgTools: any, key: keyof ToolsConfig): boolean {
    return cfgTools?.[key]?.enabled === true;
}

/**
 * Los subpermisos que el dueño apaga y que hasta acá no apagaban nada.
 *
 * `canBook`, `canCancel`, `canCheckStock` y `canRecommend` existen en el tipo,
 * la pantalla del agente los muestra como casillas y el bootstrap los siembra
 * por vertical. **Ningún lugar los leía.** Un dueño que destildaba "puede
 * cancelar" veía la casilla apagada y el agente cancelaba igual — la clase de
 * control que existe en la interfaz y no en el sistema, que es peor que no
 * tenerlo: el que no está no se confía.
 *
 * `reschedule_appointment` cae bajo `canCancel` a propósito: reprogramar libera
 * el turno original. Que no estuviera cubierta por ninguna de las dos casillas
 * era la fuga más silenciosa — el dueño apagaba cancelar y el agente
 * reprogramaba, que para su agenda es lo mismo.
 *
 * Ausente = permitido, deliberadamente: un agente viejo sin la clave guardada
 * no puede perder capacidades por un cambio de contrato. Sólo un `false`
 * explícito recorta.
 */
const SUBPERMISSION_TOOLS: readonly {
    family: keyof ToolsConfig;
    flag: string;
    tools: readonly string[];
}[] = Object.freeze([
    {
        family: 'appointments', flag: 'canBook',
        tools: Object.freeze(['create_appointment', 'send_booking_link']),
    },
    {
        family: 'appointments', flag: 'canCancel',
        tools: Object.freeze(['cancel_appointment', 'reschedule_appointment']),
    },
    { family: 'catalog', flag: 'canCheckStock', tools: Object.freeze(['check_stock']) },
    { family: 'ecommerce', flag: 'canRecommend', tools: Object.freeze(['recommend_products']) },
]);

/** Los nombres que un `false` explícito del dueño retira de este agente. */
export function subpermissionDeniedToolNames(cfgTools: unknown): Set<string> {
    const denied = new Set<string>();
    for (const rule of SUBPERMISSION_TOOLS) {
        const family = (cfgTools as any)?.[rule.family];
        if (!family) continue;
        if (family[rule.flag] === false) {
            for (const name of rule.tools) denied.add(name);
        }
    }
    return denied;
}

/** Static tool definitions this agent's config authorises, in registration order. */
export function staticToolsForAgentConfig(cfgTools: unknown): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const family of TOOL_FAMILIES) {
        if (familyEnabled(cfgTools, family.key)) tools.push(...family.tools);
    }
    // El subpermiso recorta DESPUÉS de la familia: apagar "puede cancelar" no
    // apaga la familia de citas, sólo saca la tool que cancela.
    const denied = subpermissionDeniedToolNames(cfgTools);
    return denied.size ? tools.filter(tool => !denied.has(String(tool.name))) : tools;
}

/**
 * Names a deterministic Procedure may invoke for this agent.
 *
 * Wider than the static families by exactly the money tools, because a
 * procedure legitimately steps through "collect data → charge → confirm" and
 * the payment family is registered asynchronously against provider health.
 * Authorising the name here does not authorise the call: `create_payment_link`
 * still passes the central guard, which fails closed on plan, provider
 * readiness, ownership and confirmation.
 */
export function procedureAuthorizedToolNames(cfgTools: unknown): Set<string> {
    const names = new Set(staticToolsForAgentConfig(cfgTools).map(tool => String(tool.name)));
    if (familyEnabled(cfgTools, 'payments')) {
        for (const tool of [...PAYMENT_STATUS_TOOLS, ...PAYMENT_CREATE_TOOLS]) {
            names.add(String(tool.name));
        }
        // `refund_payment` is deliberately never advertised to the model, so the
        // LLM cannot choose it. An authored SOP step is a different thing: the
        // tenant wrote it, and the central guard still demands A4 assurance,
        // explicit confirmation, a human approval ticket, ownership and the
        // idempotency ledger before a cent moves.
        names.add(String(REFUND_PAYMENT_TOOL.name));
    }
    return names;
}

/** Tool-family keys this config switches on. Used by diagnostics and tests. */
export function enabledToolFamilies(cfgTools: unknown): string[] {
    return TOOL_FAMILIES
        .filter(family => familyEnabled(cfgTools, family.key))
        .map(family => String(family.key));
}
