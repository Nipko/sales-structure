/**
 * Shared layout for the three appointment emails (confirmation / reminder /
 * cancellation) in the four supported languages.
 *
 * Why a builder instead of 12 hand-written HTML blobs: the copy is the only
 * thing that changes per (kind, language). Writing the markup once means the
 * Portuguese cancellation can never drift from the Spanish confirmation, and a
 * layout fix lands in all twelve rows at the same time.
 *
 * Two hard constraints come from the renderer in email-templates.service.ts:
 *   - `{{#if x}}...{{/if}}` is a flat, non-greedy regex: blocks must NOT nest.
 *   - There is no `{{else}}`. Anything that needs a fallback is written as two
 *     sequential blocks, or as a value the caller pre-resolves.
 *
 * The markup itself is table-based with inline styles because Outlook still
 * drops flex/grid and <style> blocks.
 */

export type AppointmentEmailKind = 'confirmation' | 'reminder' | 'cancellation';

export const APPOINTMENT_EMAIL_SLUGS: Record<AppointmentEmailKind, string> = {
    confirmation: 'appointment_confirmation_email',
    reminder: 'appointment_reminder_email',
    cancellation: 'appointment_cancellation_email',
};

export const APPOINTMENT_EMAIL_KINDS: AppointmentEmailKind[] = ['confirmation', 'reminder', 'cancellation'];

/**
 * Every variable the layout can render. `platform_credit` is a flag: the sender
 * sets it to the credit line only when the tenant is not white-labelled, so an
 * empty value hides the whole paragraph.
 */
const BASE_VARIABLES = [
    'customer_name', 'company_name', 'company_logo', 'company_phone', 'company_email',
    'company_address', 'company_website', 'service_name', 'appointment_date',
    'appointment_time', 'appointment_duration', 'staff_name', 'location', 'meeting_url',
    'platform_credit',
];

export function appointmentEmailVariables(kind: AppointmentEmailKind): string[] {
    return kind === 'cancellation' ? [...BASE_VARIABLES, 'cancellation_reason'] : [...BASE_VARIABLES];
}

interface AppointmentEmailCopy {
    name: string;
    subject: string;
    badge: string;
    heading: string;
    greeting: string;
    intro: string;
    labels: {
        service: string;
        date: string;
        time: string;
        duration: string;
        staff: string;
        location: string;
        meeting: string;
        notes: string;
        reason: string;
    };
    meetingCta: string;
    calendarNote: string;
    policy: string;
    replyHint: string;
    contactHeading: string;
}

const ACCENTS: Record<AppointmentEmailKind, { fg: string; bg: string; border: string; icon: string }> = {
    confirmation: { fg: '#067647', bg: '#ecfdf3', border: '#abefc6', icon: '&#10003;' },
    reminder: { fg: '#b54708', bg: '#fffaeb', border: '#fedf89', icon: '&#9200;' },
    cancellation: { fg: '#b42318', bg: '#fef3f2', border: '#fecdca', icon: '&#10007;' },
};

const COPY: Record<string, Record<AppointmentEmailKind, AppointmentEmailCopy>> = {
    es: {
        confirmation: {
            name: 'Confirmación de cita (Email)',
            subject: 'Cita confirmada — {{service_name}} · {{company_name}}',
            badge: 'Cita confirmada',
            heading: 'Tu cita quedó agendada',
            greeting: 'Hola <strong>{{customer_name}}</strong>,',
            intro: 'Confirmamos tu cita en <strong>{{company_name}}</strong>. Estos son los detalles:',
            labels: {
                service: 'Servicio', date: 'Fecha', time: 'Hora', duration: 'Duración',
                staff: 'Te atiende', location: 'Dirección', meeting: 'Reunión virtual',
                notes: 'Notas', reason: 'Motivo',
            },
            meetingCta: 'Entrar a la reunión',
            calendarNote: 'Adjuntamos un archivo de calendario: ábrelo para agregar la cita a tu agenda.',
            policy: 'Si necesitas cancelar o reprogramar, avísanos con al menos 24 horas de anticipación.',
            replyHint: 'Puedes responder directamente a este correo.',
            contactHeading: 'Cómo contactarnos',
        },
        reminder: {
            name: 'Recordatorio de cita (Email)',
            subject: 'Recordatorio: tu cita de {{service_name}} — {{company_name}}',
            badge: 'Recordatorio de cita',
            heading: 'Te esperamos mañana',
            greeting: 'Hola <strong>{{customer_name}}</strong>,',
            intro: 'Te recordamos tu cita en <strong>{{company_name}}</strong>:',
            labels: {
                service: 'Servicio', date: 'Fecha', time: 'Hora', duration: 'Duración',
                staff: 'Te atiende', location: 'Dirección', meeting: 'Reunión virtual',
                notes: 'Notas', reason: 'Motivo',
            },
            meetingCta: 'Entrar a la reunión',
            calendarNote: 'Adjuntamos un archivo de calendario por si aún no tienes la cita en tu agenda.',
            policy: 'Si no puedes asistir, avísanos cuanto antes para liberar el horario.',
            replyHint: 'Puedes responder directamente a este correo.',
            contactHeading: 'Cómo contactarnos',
        },
        cancellation: {
            name: 'Cancelación de cita (Email)',
            subject: 'Cita cancelada — {{service_name}} · {{company_name}}',
            badge: 'Cita cancelada',
            heading: 'Tu cita fue cancelada',
            greeting: 'Hola <strong>{{customer_name}}</strong>,',
            intro: 'Cancelamos la siguiente cita en <strong>{{company_name}}</strong>:',
            labels: {
                service: 'Servicio', date: 'Fecha', time: 'Hora', duration: 'Duración',
                staff: 'Te atendía', location: 'Dirección', meeting: 'Reunión virtual',
                notes: 'Notas', reason: 'Motivo',
            },
            meetingCta: 'Entrar a la reunión',
            calendarNote: 'Adjuntamos la cancelación en formato de calendario para que se retire de tu agenda.',
            policy: 'Si quieres reagendar, escríbenos y buscamos un nuevo horario.',
            replyHint: 'Puedes responder directamente a este correo.',
            contactHeading: 'Cómo contactarnos',
        },
    },
    en: {
        confirmation: {
            name: 'Appointment Confirmation (Email)',
            subject: 'Appointment confirmed — {{service_name}} · {{company_name}}',
            badge: 'Appointment confirmed',
            heading: 'Your appointment is booked',
            greeting: 'Hi <strong>{{customer_name}}</strong>,',
            intro: 'We confirmed your appointment at <strong>{{company_name}}</strong>. Here are the details:',
            labels: {
                service: 'Service', date: 'Date', time: 'Time', duration: 'Duration',
                staff: 'With', location: 'Address', meeting: 'Online meeting',
                notes: 'Notes', reason: 'Reason',
            },
            meetingCta: 'Join the meeting',
            calendarNote: 'We attached a calendar file — open it to add the appointment to your calendar.',
            policy: 'If you need to cancel or reschedule, please let us know at least 24 hours in advance.',
            replyHint: 'You can reply directly to this email.',
            contactHeading: 'How to reach us',
        },
        reminder: {
            name: 'Appointment Reminder (Email)',
            subject: 'Reminder: your {{service_name}} appointment — {{company_name}}',
            badge: 'Appointment reminder',
            heading: 'See you tomorrow',
            greeting: 'Hi <strong>{{customer_name}}</strong>,',
            intro: 'A reminder about your appointment at <strong>{{company_name}}</strong>:',
            labels: {
                service: 'Service', date: 'Date', time: 'Time', duration: 'Duration',
                staff: 'With', location: 'Address', meeting: 'Online meeting',
                notes: 'Notes', reason: 'Reason',
            },
            meetingCta: 'Join the meeting',
            calendarNote: 'We attached a calendar file in case the appointment is not in your calendar yet.',
            policy: 'If you cannot make it, let us know as soon as possible so we can free up the slot.',
            replyHint: 'You can reply directly to this email.',
            contactHeading: 'How to reach us',
        },
        cancellation: {
            name: 'Appointment Cancellation (Email)',
            subject: 'Appointment cancelled — {{service_name}} · {{company_name}}',
            badge: 'Appointment cancelled',
            heading: 'Your appointment was cancelled',
            greeting: 'Hi <strong>{{customer_name}}</strong>,',
            intro: 'We cancelled the following appointment at <strong>{{company_name}}</strong>:',
            labels: {
                service: 'Service', date: 'Date', time: 'Time', duration: 'Duration',
                staff: 'With', location: 'Address', meeting: 'Online meeting',
                notes: 'Notes', reason: 'Reason',
            },
            meetingCta: 'Join the meeting',
            calendarNote: 'We attached the cancellation as a calendar file so it is removed from your calendar.',
            policy: 'If you would like to rebook, write to us and we will find a new time.',
            replyHint: 'You can reply directly to this email.',
            contactHeading: 'How to reach us',
        },
    },
    pt: {
        confirmation: {
            name: 'Confirmação de agendamento (Email)',
            subject: 'Agendamento confirmado — {{service_name}} · {{company_name}}',
            badge: 'Agendamento confirmado',
            heading: 'Seu agendamento está marcado',
            greeting: 'Olá <strong>{{customer_name}}</strong>,',
            intro: 'Confirmamos seu agendamento em <strong>{{company_name}}</strong>. Veja os detalhes:',
            labels: {
                service: 'Serviço', date: 'Data', time: 'Horário', duration: 'Duração',
                staff: 'Atendimento com', location: 'Endereço', meeting: 'Reunião online',
                notes: 'Observações', reason: 'Motivo',
            },
            meetingCta: 'Entrar na reunião',
            calendarNote: 'Anexamos um arquivo de calendário: abra-o para adicionar o agendamento à sua agenda.',
            policy: 'Se precisar cancelar ou reagendar, avise com pelo menos 24 horas de antecedência.',
            replyHint: 'Você pode responder diretamente a este e-mail.',
            contactHeading: 'Como falar conosco',
        },
        reminder: {
            name: 'Lembrete de agendamento (Email)',
            subject: 'Lembrete: seu agendamento de {{service_name}} — {{company_name}}',
            badge: 'Lembrete de agendamento',
            heading: 'Esperamos você amanhã',
            greeting: 'Olá <strong>{{customer_name}}</strong>,',
            intro: 'Lembrete do seu agendamento em <strong>{{company_name}}</strong>:',
            labels: {
                service: 'Serviço', date: 'Data', time: 'Horário', duration: 'Duração',
                staff: 'Atendimento com', location: 'Endereço', meeting: 'Reunião online',
                notes: 'Observações', reason: 'Motivo',
            },
            meetingCta: 'Entrar na reunião',
            calendarNote: 'Anexamos um arquivo de calendário caso o agendamento ainda não esteja na sua agenda.',
            policy: 'Se não puder comparecer, avise o quanto antes para liberarmos o horário.',
            replyHint: 'Você pode responder diretamente a este e-mail.',
            contactHeading: 'Como falar conosco',
        },
        cancellation: {
            name: 'Cancelamento de agendamento (Email)',
            subject: 'Agendamento cancelado — {{service_name}} · {{company_name}}',
            badge: 'Agendamento cancelado',
            heading: 'Seu agendamento foi cancelado',
            greeting: 'Olá <strong>{{customer_name}}</strong>,',
            intro: 'Cancelamos o seguinte agendamento em <strong>{{company_name}}</strong>:',
            labels: {
                service: 'Serviço', date: 'Data', time: 'Horário', duration: 'Duração',
                staff: 'Atendimento com', location: 'Endereço', meeting: 'Reunião online',
                notes: 'Observações', reason: 'Motivo',
            },
            meetingCta: 'Entrar na reunião',
            calendarNote: 'Anexamos o cancelamento em formato de calendário para que saia da sua agenda.',
            policy: 'Se quiser remarcar, escreva para nós e encontramos um novo horário.',
            replyHint: 'Você pode responder diretamente a este e-mail.',
            contactHeading: 'Como falar conosco',
        },
    },
    fr: {
        confirmation: {
            name: 'Confirmation de rendez-vous (Email)',
            subject: 'Rendez-vous confirmé — {{service_name}} · {{company_name}}',
            badge: 'Rendez-vous confirmé',
            heading: 'Votre rendez-vous est réservé',
            greeting: 'Bonjour <strong>{{customer_name}}</strong>,',
            intro: 'Nous confirmons votre rendez-vous chez <strong>{{company_name}}</strong>. Voici les détails :',
            labels: {
                service: 'Service', date: 'Date', time: 'Heure', duration: 'Durée',
                staff: 'Avec', location: 'Adresse', meeting: 'Réunion en ligne',
                notes: 'Notes', reason: 'Motif',
            },
            meetingCta: 'Rejoindre la réunion',
            calendarNote: 'Nous joignons un fichier de calendrier : ouvrez-le pour ajouter le rendez-vous à votre agenda.',
            policy: 'Si vous devez annuler ou reporter, prévenez-nous au moins 24 heures à l\'avance.',
            replyHint: 'Vous pouvez répondre directement à cet e-mail.',
            contactHeading: 'Nous contacter',
        },
        reminder: {
            name: 'Rappel de rendez-vous (Email)',
            subject: 'Rappel : votre rendez-vous {{service_name}} — {{company_name}}',
            badge: 'Rappel de rendez-vous',
            heading: 'À demain',
            greeting: 'Bonjour <strong>{{customer_name}}</strong>,',
            intro: 'Un rappel concernant votre rendez-vous chez <strong>{{company_name}}</strong> :',
            labels: {
                service: 'Service', date: 'Date', time: 'Heure', duration: 'Durée',
                staff: 'Avec', location: 'Adresse', meeting: 'Réunion en ligne',
                notes: 'Notes', reason: 'Motif',
            },
            meetingCta: 'Rejoindre la réunion',
            calendarNote: 'Nous joignons un fichier de calendrier si le rendez-vous n\'est pas encore dans votre agenda.',
            policy: 'Si vous ne pouvez pas venir, prévenez-nous au plus vite pour libérer le créneau.',
            replyHint: 'Vous pouvez répondre directement à cet e-mail.',
            contactHeading: 'Nous contacter',
        },
        cancellation: {
            name: 'Annulation de rendez-vous (Email)',
            subject: 'Rendez-vous annulé — {{service_name}} · {{company_name}}',
            badge: 'Rendez-vous annulé',
            heading: 'Votre rendez-vous a été annulé',
            greeting: 'Bonjour <strong>{{customer_name}}</strong>,',
            intro: 'Nous avons annulé le rendez-vous suivant chez <strong>{{company_name}}</strong> :',
            labels: {
                service: 'Service', date: 'Date', time: 'Heure', duration: 'Durée',
                staff: 'Avec', location: 'Adresse', meeting: 'Réunion en ligne',
                notes: 'Notes', reason: 'Motif',
            },
            meetingCta: 'Rejoindre la réunion',
            calendarNote: 'Nous joignons l\'annulation au format calendrier afin qu\'elle disparaisse de votre agenda.',
            policy: 'Si vous souhaitez reprendre rendez-vous, écrivez-nous et nous trouverons un nouveau créneau.',
            replyHint: 'Vous pouvez répondre directement à cet e-mail.',
            contactHeading: 'Nous contacter',
        },
    },
};

const detailRow = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;font-size:13px;color:#667085;width:36%;vertical-align:top;">${label}</td>`
    + `<td style="padding:7px 0;font-size:14px;color:#101828;font-weight:600;vertical-align:top;">${value}</td></tr>`;

const optionalRow = (variable: string, label: string) =>
    `{{#if ${variable}}}${detailRow(label, `{{${variable}}}`)}{{/if}}`;

const contactLine = (variable: string, icon: string) =>
    `{{#if ${variable}}}<p style="margin:3px 0;font-size:13px;color:#475467;">${icon} {{${variable}}}</p>{{/if}}`;

/**
 * Build the full HTML body for one (kind, language) pair.
 * The result is stored verbatim as the tenant's template, so it must stay
 * deterministic — no timestamps, no random ids.
 */
export function buildAppointmentEmail(kind: AppointmentEmailKind, lang: string): string {
    const copy = (COPY[lang] ?? COPY['es'])[kind];
    const accent = ACCENTS[kind];
    const strike = kind === 'cancellation' ? 'text-decoration:line-through;' : '';

    const rows = [
        detailRow(copy.labels.service, `<span style="${strike}">{{service_name}}</span>`),
        detailRow(copy.labels.date, `<span style="${strike}">{{appointment_date}}</span>`),
        detailRow(copy.labels.time, `<span style="${strike}">{{appointment_time}}</span>`),
        optionalRow('appointment_duration', copy.labels.duration),
        optionalRow('staff_name', copy.labels.staff),
        optionalRow('location', copy.labels.location),
        // `appointments.notes` is deliberately NOT rendered: the AI booking path
        // stuffs the conversation transcript into that column, so surfacing it
        // would mail the customer their own chat log.
        kind === 'cancellation' ? optionalRow('cancellation_reason', copy.labels.reason) : '',
    ].filter(Boolean).join('\n');

    // The join button only makes sense while the appointment is alive.
    const meetingBlock = kind === 'cancellation'
        ? ''
        : `<tr><td style="padding:18px 28px 0;">
{{#if meeting_url}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:2px 0;"><a href="{{meeting_url}}" style="display:inline-block;padding:13px 34px;background:#6c5ce7;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;">${copy.meetingCta}</a></td></tr></table>{{/if}}
</td></tr>`;

    return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(16,24,40,.08);">

<tr><td style="padding:26px 28px 0;text-align:center;">
{{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:44px;max-width:220px;border:0;display:inline-block;"/>{{/if}}
<p style="margin:10px 0 0;font-size:17px;font-weight:700;color:#101828;letter-spacing:.2px;">{{company_name}}</p>
</td></tr>

<tr><td style="padding:20px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${accent.bg};border:1px solid ${accent.border};border-radius:10px;">
<tr><td style="padding:13px 18px;text-align:center;">
<p style="margin:0;font-size:15px;font-weight:700;color:${accent.fg};">${accent.icon} ${copy.badge}</p>
</td></tr></table>
</td></tr>

<tr><td style="padding:22px 28px 0;">
<h1 style="margin:0 0 12px;font-size:19px;font-weight:700;color:#101828;">${copy.heading}</h1>
<p style="margin:0 0 6px;font-size:15px;color:#101828;">${copy.greeting}</p>
<p style="margin:0;font-size:14px;color:#475467;line-height:1.6;">${copy.intro}</p>
</td></tr>

<tr><td style="padding:18px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #eaecf0;border-radius:10px;">
<tr><td style="padding:14px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows}
</table>
</td></tr></table>
</td></tr>
${meetingBlock}
<tr><td style="padding:20px 28px 0;">
<p style="margin:0 0 8px;font-size:13px;color:#475467;line-height:1.6;">${copy.policy}</p>
{{#if company_email}}<p style="margin:0 0 8px;font-size:13px;color:#475467;line-height:1.6;">${copy.replyHint}</p>{{/if}}
<p style="margin:0;font-size:12px;color:#98a2b3;line-height:1.6;">${copy.calendarNote}</p>
</td></tr>

<tr><td style="padding:22px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eaecf0;padding-top:16px;">
<p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.8px;">${copy.contactHeading}</p>
${contactLine('company_address', '&#128205;')}
${contactLine('company_phone', '&#128222;')}
${contactLine('company_email', '&#9993;&#65039;')}
${contactLine('company_website', '&#127760;')}
</td></tr></table>
</td></tr>

<tr><td style="padding:18px 28px 26px;text-align:center;">
{{#if platform_credit}}<p style="margin:0;font-size:11px;color:#98a2b3;">{{platform_credit}}</p>{{/if}}
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function appointmentEmailName(kind: AppointmentEmailKind, lang: string): string {
    return (COPY[lang] ?? COPY['es'])[kind].name;
}

export function appointmentEmailSubject(kind: AppointmentEmailKind, lang: string): string {
    return (COPY[lang] ?? COPY['es'])[kind].subject;
}
