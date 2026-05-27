/**
 * Insurance AI tools — Roberto's toolkit. Show plans, quote, look up
 * policy status, file claims. Gated by config.tools.insurance.enabled
 * (set automatically when industry='seguros').
 *
 * Important: calculate_quote returns a sales-friendly estimate based
 * on plan range × age. Real underwriting requires the carrier system —
 * the AI must always disclose this is an estimate, subject to formal
 * review.
 */
import { ToolDefinition } from '@parallext/shared';

export const INSURANCE_TOOLS: ToolDefinition[] = [
    {
        name: 'get_insurance_plans',
        description: 'List available insurance plans. Filter by type (vida, salud, auto, hogar, empresarial, viaje) and/or coverage level (basico, medio, premium). Returns plan id + premium range + what is covered.',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['vida', 'salud', 'auto', 'hogar', 'empresarial', 'viaje'],
                    description: 'Insurance type',
                },
                coverageLevel: {
                    type: 'string',
                    enum: ['basico', 'medio', 'premium'],
                    description: 'Coverage tier',
                },
            },
        },
    },
    {
        name: 'calculate_quote',
        description: 'Generate a quote for a specific plan + applicant age. Returns monthly + annual premium estimate. ALWAYS disclose to the customer that this is a preliminary estimate subject to formal underwriting review.',
        parameters: {
            type: 'object',
            properties: {
                planId: { type: 'string', description: 'Plan UUID from get_insurance_plans' },
                applicantName: { type: 'string', description: 'Full name' },
                applicantAge: { type: 'number', description: 'Age in years' },
                applicantEmail: { type: 'string' },
                applicantPhone: { type: 'string' },
                applicantData: {
                    type: 'object',
                    description: 'Type-specific data: for auto = {brand, model, year, plate}; for life = {dependents, smoker}; for home = {address, area_m2}; etc.',
                },
            },
            required: ['planId'],
        },
    },
    {
        name: 'check_policy_status',
        description: 'Look up an existing policy by its policy_number. Returns status, premium, next payment date, and end date. Use when an existing client asks about their policy.',
        parameters: {
            type: 'object',
            properties: {
                policyNumber: { type: 'string', description: 'Policy number provided by the customer' },
            },
            required: ['policyNumber'],
        },
    },
    {
        name: 'file_claim',
        description: 'File a claim against a policy. Use when the customer reports an incident covered by their policy. The claim enters status="submitted" and a human agent will review. Always escalate to the human team after filing.',
        parameters: {
            type: 'object',
            properties: {
                policyNumber: { type: 'string', description: 'Policy number — system resolves the policy_id' },
                incidentType: { type: 'string', description: 'e.g. accidente_vehicular, robo, hospitalizacion, daño_hogar' },
                incidentAt: { type: 'string', description: 'Date the incident happened (YYYY-MM-DD)' },
                description: { type: 'string', description: 'What happened — customer\'s account' },
                claimedAmount: { type: 'number', description: 'Amount the customer is claiming (optional)' },
            },
            required: ['policyNumber', 'description'],
        },
    },
    {
        name: 'list_my_claims',
        description: 'List all claims filed by the current customer. Use when the customer asks about their claim status or wants to see filed claims.',
        parameters: {
            type: 'object',
            properties: {
                policyNumber: { type: 'string', description: 'Optional — filter by policy number' },
            },
        },
    },
    {
        name: 'cancel_quote',
        description: 'Cancel a pending insurance quote. Only quotes in "pending" status can be cancelled. Use when the customer decides not to proceed with a quoted plan.',
        parameters: {
            type: 'object',
            properties: {
                quoteId: { type: 'string', description: 'Quote UUID returned by calculate_quote' },
            },
            required: ['quoteId'],
        },
    },
];
