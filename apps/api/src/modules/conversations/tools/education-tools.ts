/**
 * Education AI tools — Pablo's toolkit. Lets the agent show available
 * cohorts, send placement test links, and enroll students.
 *
 * Important: enrollment operates on cohort_id (a specific scheduled
 * group) — not on course_id. Always call get_course_schedule first
 * to surface the cohorts the user can pick from.
 */
import { ToolDefinition } from '@parallext/shared';

export const EDUCATION_TOOLS: ToolDefinition[] = [
    {
        name: 'get_courses',
        description: 'List active courses in the catalog. Optional filters by subject (idiomas, programacion, contabilidad), level (A1-C2 or principiante/intermedio/avanzado) and modality (presencial / online / hybrid).',
        parameters: {
            type: 'object',
            properties: {
                subject: { type: 'string', description: 'Subject keyword (ingles, frances, programacion, etc.)' },
                level: { type: 'string', description: 'Level filter (A1, B2, principiante, etc.)' },
                modality: { type: 'string', enum: ['presencial', 'online', 'hybrid'], description: 'Class modality' },
            },
        },
    },
    {
        name: 'get_course_schedule',
        description: 'List upcoming open cohorts (specific scheduled groups) the student can enroll in. Returns cohort_id, start date, schedule string, available seats, instructor and price. Use BEFORE enroll_student to pick a cohort.',
        parameters: {
            type: 'object',
            properties: {
                subject: { type: 'string' },
                level: { type: 'string' },
                modality: { type: 'string', enum: ['presencial', 'online', 'hybrid'] },
                daysAhead: { type: 'number', description: 'Look ahead this many days (default 60, max 180)' },
            },
        },
    },
    {
        name: 'enroll_student',
        description: 'Enroll a student in a specific cohort. Decrements available seats atomically. Always confirm name + email + phone with the student before calling. Use cohort_id from get_course_schedule.',
        parameters: {
            type: 'object',
            properties: {
                cohortId: { type: 'string', description: 'Cohort UUID from get_course_schedule' },
                studentName: { type: 'string', description: 'Full name of the student' },
                studentEmail: { type: 'string', description: 'Email for course communications' },
                studentPhone: { type: 'string', description: 'Phone in international format' },
            },
            required: ['cohortId', 'studentName'],
        },
    },
    {
        name: 'get_placement_test_link',
        description: 'Generate / look up the placement test link for the current contact. Use when the student wants to know their level before enrolling. Subject is optional — if omitted, returns the most recent test for the contact.',
        parameters: {
            type: 'object',
            properties: {
                subject: { type: 'string', description: 'Subject of the placement test (ingles, frances, etc.)' },
            },
        },
    },
    {
        name: 'cancel_enrollment',
        description: 'Cancel a student enrollment. Seat is restored to the cohort. Only enrollments in "pending" or "enrolled" status can be cancelled. Use when the student wants to withdraw from a course.',
        parameters: {
            type: 'object',
            properties: {
                enrollmentId: { type: 'string', description: 'Enrollment UUID returned by enroll_student' },
                reason: { type: 'string', description: 'Reason for cancellation' },
            },
            required: ['enrollmentId'],
        },
    },
    {
        name: 'list_my_enrollments',
        description: 'List all enrollments for the current student. Use before cancel_enrollment so the student can identify which enrollment to cancel.',
        parameters: { type: 'object', properties: {} },
    },
];
