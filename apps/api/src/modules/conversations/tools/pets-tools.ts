/**
 * Pets / Veterinaria tools — let the AI agent look up the tutor's pets,
 * register a new pet during conversation, check vaccination status, and
 * triage emergencies. Registered when config.tools.pets.enabled === true.
 *
 * Hard rule: emergency triage NEVER prescribes treatment or diagnoses —
 * it only categorises severity (urgent / non-urgent) and routes to a
 * human handoff when severity is urgent.
 */
import { ToolDefinition } from '@parallext/shared';

export const PETS_TOOLS: ToolDefinition[] = [
    {
        name: 'list_pets_for_contact',
        description: 'List all pets registered to the current tutor (the contact in this conversation). Returns name, species, breed, age, weight, allergies and a summary of upcoming and overdue vaccinations. Always call this BEFORE booking an appointment so the user knows which pet the appointment is for.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'register_pet',
        description: 'Register a new pet for the current tutor. Use when the contact mentions a pet not yet on file. Only requires name and species — other fields are optional and can be filled in later by the clinic.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Pet name (required)' },
                species: {
                    type: 'string',
                    enum: ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'rodent', 'fish', 'other'],
                    description: 'Species — defaults to dog',
                },
                breed: { type: 'string', description: 'Breed (e.g. Golden Retriever, Persian)' },
                sex: { type: 'string', enum: ['male', 'female', 'unknown'], description: 'Sex' },
                isNeutered: { type: 'boolean', description: 'Spayed / neutered?' },
                birthDate: { type: 'string', description: 'Date of birth YYYY-MM-DD if known' },
                weightKg: { type: 'number', description: 'Approximate weight in kg' },
                color: { type: 'string', description: 'Coat color' },
                allergies: { type: 'string', description: 'Known allergies (food, medication)' },
                chronicConditions: { type: 'string', description: 'Chronic conditions (diabetes, heart, kidney, etc.)' },
            },
            required: ['name'],
        },
    },
    {
        name: 'get_vaccination_status',
        description: 'Get the vaccination calendar for a specific pet — last applied dates, next due dates and any overdue vaccinations. Use when the tutor asks "is my pet up to date?", "when is the next rabies shot?", or before recommending vaccination services.',
        parameters: {
            type: 'object',
            properties: {
                petId: { type: 'string', description: 'Pet UUID — get this from list_pets_for_contact first' },
            },
            required: ['petId'],
        },
    },
    {
        name: 'triage_pet_emergency',
        description: 'Categorise an emergency description as "urgent" (immediate handoff to clinic) or "non-urgent" (can be scheduled). Use when the tutor describes symptoms, accidents or behavioural changes. NEVER suggest specific treatment, medications or diagnoses — only severity assessment.',
        parameters: {
            type: 'object',
            properties: {
                symptoms: { type: 'string', description: 'Free-text description of what the tutor is reporting' },
                petId: { type: 'string', description: 'Optional pet UUID if known' },
            },
            required: ['symptoms'],
        },
    },
    {
        name: 'update_pet',
        description: 'Update information for an existing pet. Use when the tutor provides updated data (new weight, allergies, chronic conditions, neutering status). Only the tutor who owns the pet can update it.',
        parameters: {
            type: 'object',
            properties: {
                petId: { type: 'string', description: 'Pet UUID from list_pets_for_contact' },
                name: { type: 'string', description: 'Updated name' },
                weightKg: { type: 'number', description: 'Updated weight in kg' },
                allergies: { type: 'string', description: 'Updated allergies' },
                chronicConditions: { type: 'string', description: 'Updated chronic conditions' },
                isNeutered: { type: 'boolean', description: 'Updated neutering status' },
                color: { type: 'string', description: 'Updated coat color' },
            },
            required: ['petId'],
        },
    },
];
