/**
 * Verbatim snapshots of every appointment-email body this platform has ever
 * shipped as a default.
 *
 * Why they are kept: `seedDefaults` inserts non-billing templates with
 * `ON CONFLICT DO NOTHING`, so a tenant that already has a row NEVER receives an
 * improved default — the row we shipped in 2026 would outlive every redesign.
 * The refresh in EmailTemplatesService fixes that, but it must not silently
 * overwrite a body the tenant edited by hand. Exact-matching against this list
 * is the only test that tells the two apart: if the stored HTML is byte-identical
 * to something we shipped, nobody customised it.
 *
 * RULES
 *  - Never edit an entry. Editing one makes the platform believe a tenant's
 *    customisation is a stock body and eligible for overwrite.
 *  - When shipping a new default, append the OLD body here first.
 *  - Bodies that originated in the dashboard "create from preset" flow count as
 *    stock too: the tenant clicked a button, they did not write HTML.
 */

/** v1 defaults seeded from DEFAULT_TEMPLATES / TEMPLATE_TRANSLATIONS (May–Aug 2026). */
const V1_CONFIRMATION_ES = `<h2>Tu cita está confirmada</h2>
<p>Hola {{customer_name}},</p>
<p>Tu cita ha sido agendada exitosamente.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Servicio</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{service_name}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Fecha</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{appointment_date}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Hora</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{appointment_time}}</td></tr>
{{#if location}}<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Ubicación</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{location}}</td></tr>{{/if}}
</table>
<p>Si necesitas cancelar o reprogramar, contáctanos con al menos 24 horas de anticipación.</p>`;

const V1_REMINDER_ES = `<h2>Recordatorio de tu cita</h2>
<p>Hola {{customer_name}},</p>
<p>Te recordamos que tienes una cita mañana:</p>
<p><strong>Servicio:</strong> {{service_name}}<br/><strong>Fecha:</strong> {{appointment_date}}<br/><strong>Hora:</strong> {{appointment_time}}</p>
{{#if location}}<p><strong>Ubicación:</strong> {{location}}</p>{{/if}}
<p>¡Te esperamos!</p>`;

const V1_CONFIRMATION_EN = "<h2>Your appointment is confirmed</h2>\n<p>Hello {{customer_name}},</p>\n<p>Your appointment has been successfully scheduled.</p>\n<table style=\"width:100%;border-collapse:collapse;margin:16px 0\">\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Service</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{service_name}}</td></tr>\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Date</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{appointment_date}}</td></tr>\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Time</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{appointment_time}}</td></tr>\n{{#if location}}<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Location</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{location}}</td></tr>{{/if}}\n</table>\n<p>If you need to cancel or reschedule, please contact us at least 24 hours in advance.</p>";

const V1_REMINDER_EN = "<h2>Appointment reminder</h2>\n<p>Hello {{customer_name}},</p>\n<p>This is a reminder that you have an appointment tomorrow:</p>\n<p><strong>Service:</strong> {{service_name}}<br/><strong>Date:</strong> {{appointment_date}}<br/><strong>Time:</strong> {{appointment_time}}</p>\n{{#if location}}<p><strong>Location:</strong> {{location}}</p>{{/if}}\n<p>We look forward to seeing you!</p>";

const V1_CONFIRMATION_PT = "<h2>Sua consulta está confirmada</h2>\n<p>Olá {{customer_name}},</p>\n<p>Sua consulta foi agendada com sucesso.</p>\n<table style=\"width:100%;border-collapse:collapse;margin:16px 0\">\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Serviço</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{service_name}}</td></tr>\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Data</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{appointment_date}}</td></tr>\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Horário</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{appointment_time}}</td></tr>\n{{#if location}}<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Local</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{location}}</td></tr>{{/if}}\n</table>\n<p>Se precisar cancelar ou reagendar, entre em contato conosco com pelo menos 24 horas de antecedência.</p>";

const V1_REMINDER_PT = "<h2>Lembrete da sua consulta</h2>\n<p>Olá {{customer_name}},</p>\n<p>Lembramos que você tem uma consulta amanhã:</p>\n<p><strong>Serviço:</strong> {{service_name}}<br/><strong>Data:</strong> {{appointment_date}}<br/><strong>Horário:</strong> {{appointment_time}}</p>\n{{#if location}}<p><strong>Local:</strong> {{location}}</p>{{/if}}\n<p>Esperamos por você!</p>";

const V1_CONFIRMATION_FR = "<h2>Votre rendez-vous est confirmé</h2>\n<p>Bonjour {{customer_name}},</p>\n<p>Votre rendez-vous a été planifié avec succès.</p>\n<table style=\"width:100%;border-collapse:collapse;margin:16px 0\">\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Service</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{service_name}}</td></tr>\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Date</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{appointment_date}}</td></tr>\n<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Heure</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{appointment_time}}</td></tr>\n{{#if location}}<tr><td style=\"padding:8px;border-bottom:1px solid #eee\"><strong>Lieu</strong></td><td style=\"padding:8px;border-bottom:1px solid #eee\">{{location}}</td></tr>{{/if}}\n</table>\n<p>Si vous devez annuler ou reporter, veuillez nous contacter au moins 24 heures à l'avance.</p>";

const V1_REMINDER_FR = "<h2>Rappel de votre rendez-vous</h2>\n<p>Bonjour {{customer_name}},</p>\n<p>Nous vous rappelons que vous avez un rendez-vous demain :</p>\n<p><strong>Service :</strong> {{service_name}}<br/><strong>Date :</strong> {{appointment_date}}<br/><strong>Heure :</strong> {{appointment_time}}</p>\n{{#if location}}<p><strong>Lieu :</strong> {{location}}</p>{{/if}}\n<p>Nous vous attendons !</p>";

/** Bodies produced by the dashboard "create from preset" cards (settings/email-templates). */
const PRESET_CONFIRMATION_ES = `<h2>Tu cita está confirmada</h2><p>Hola {{customer_name}},</p><p>Tu cita de <strong>{{service_name}}</strong> ha sido agendada para el <strong>{{appointment_date}}</strong> a las <strong>{{appointment_time}}</strong>.</p>{{#if location}}<p>Ubicación: {{location}}</p>{{/if}}<p>Si necesitas cancelar o reprogramar, contáctanos con 24h de anticipación.</p>`;

const PRESET_REMINDER_ES = `<h2>Recordatorio de tu cita</h2><p>Hola {{customer_name}},</p><p>Te recordamos que tienes una cita mañana:</p><p><strong>{{service_name}}</strong><br/>{{appointment_date}} a las {{appointment_time}}</p>{{#if location}}<p>Ubicación: {{location}}</p>{{/if}}<p>¡Te esperamos!</p>`;

/**
 * slug -> every stock body ever shipped for it, in any language. Language is not
 * a key on purpose: a tenant whose locale changed can end up with the English
 * body on the `es` row, and that is still a stock body.
 */
export const LEGACY_STOCK_BODIES: Record<string, string[]> = {
    appointment_confirmation_email: [
        V1_CONFIRMATION_ES, V1_CONFIRMATION_EN, V1_CONFIRMATION_PT, V1_CONFIRMATION_FR,
        PRESET_CONFIRMATION_ES,
    ],
    appointment_reminder_email: [
        V1_REMINDER_ES, V1_REMINDER_EN, V1_REMINDER_PT, V1_REMINDER_FR,
        PRESET_REMINDER_ES,
    ],
};
