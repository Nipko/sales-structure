import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { randomUUID } from 'crypto';

export interface EmailTemplate {
    id: string;
    name: string;
    slug: string;
    subject: string;
    bodyHtml: string;
    bodyJson: Record<string, any>;
    variables: string[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

// Default templates seeded on first access
const DEFAULT_TEMPLATES: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
        name: 'Confirmacion de cita',
        slug: 'appointment_confirmation',
        subject: 'Tu cita ha sido confirmada — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#6c5ce7,#9b59b6);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Cita Confirmada</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Tu cita ha sido confirmada con los siguientes detalles:</p>
    <div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:3px solid #6c5ce7;margin:16px 0;">
      <p style="margin:4px 0;font-size:14px;"><strong>Servicio:</strong> {{service_name}}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Fecha:</strong> {{appointment_date}}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Hora:</strong> {{appointment_time}}</p>
      {{#if location}}<p style="margin:4px 0;font-size:14px;"><strong>Lugar:</strong> {{location}}</p>{{/if}}
      {{#if agent_name}}<p style="margin:4px 0;font-size:14px;"><strong>Atendido por:</strong> {{agent_name}}</p>{{/if}}
    </div>
    <p style="font-size:12px;color:#999;margin-top:20px;">Si necesitas cancelar o reprogramar, responde a este correo o contactanos por WhatsApp.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'customer_email', 'company_name', 'company_logo', 'service_name', 'appointment_date', 'appointment_time', 'location', 'agent_name'],
        isActive: true,
    },
    {
        name: 'Recordatorio de cita',
        slug: 'appointment_reminder',
        subject: 'Recordatorio: Tu cita es manana — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#00b894,#00cec9);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Recordatorio de Cita</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Te recordamos que tienes una cita programada:</p>
    <div style="background:#f0fff4;padding:16px;border-radius:8px;border-left:3px solid #00b894;margin:16px 0;">
      <p style="margin:4px 0;font-size:14px;"><strong>Servicio:</strong> {{service_name}}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Fecha:</strong> {{appointment_date}}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Hora:</strong> {{appointment_time}}</p>
      {{#if location}}<p style="margin:4px 0;font-size:14px;"><strong>Lugar:</strong> {{location}}</p>{{/if}}
    </div>
    <p style="font-size:12px;color:#999;margin-top:20px;">Te esperamos. Si no puedes asistir, por favor avisanos con anticipacion.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'service_name', 'appointment_date', 'appointment_time', 'location'],
        isActive: true,
    },
    {
        name: 'Confirmacion de compra',
        slug: 'order_confirmation',
        subject: 'Pedido #{{order_id}} confirmado — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#6c5ce7,#9b59b6);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Pedido Confirmado</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Tu pedido <strong>#{{order_id}}</strong> ha sido confirmado.</p>
    <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:16px 0;">
      {{order_items_html}}
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;" />
      <p style="margin:4px 0;font-size:16px;text-align:right;"><strong>Total: {{order_total}}</strong></p>
    </div>
    <p style="font-size:14px;color:#555;"><strong>Metodo de pago:</strong> {{payment_method}}</p>
    <p style="font-size:12px;color:#999;margin-top:20px;">Gracias por tu compra. Si tienes preguntas, contactanos por WhatsApp.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'customer_email', 'company_name', 'company_logo', 'order_id', 'order_items_html', 'order_total', 'payment_method'],
        isActive: true,
    },
    {
        name: 'Bienvenida',
        slug: 'welcome',
        subject: 'Bienvenido a {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#6c5ce7,#9b59b6);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Bienvenido!</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Gracias por unirte a <strong>{{company_name}}</strong>. Estamos para ayudarte.</p>
    <p style="font-size:14px;color:#555;">Si necesitas algo, no dudes en contactarnos por WhatsApp o responder a este correo.</p>
    <p style="font-size:12px;color:#999;margin-top:20px;">— El equipo de {{company_name}}</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'customer_email', 'company_name', 'company_logo'],
        isActive: true,
    },

    // -----------------------------------------------------------------------
    // Billing templates — triggered by BillingService via EventEmitter2.
    // Variables convention for all billing templates:
    //   customer_name, plan_name, trial_days, trial_ends_at, amount_charged,
    //   currency, next_billing_date, update_payment_url, dashboard_url,
    //   invoice_url, failure_reason.
    // -----------------------------------------------------------------------

    {
        name: 'Trial iniciado',
        slug: 'billing_trial_started',
        subject: 'Bienvenido a Parallly — Tu plan {{plan_name}} esta listo',
        bodyHtml: `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="text-align:center;padding:0 0 24px;">{{#if company_logo}}<img src="{{company_logo}}" alt="Parallly" style="height:36px;"/>{{/if}}</td></tr>
<tr><td style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:4px;background:linear-gradient(90deg,#3897f0,#6c5ce7);"></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:linear-gradient(135deg,#3897f0,#2b7cd4);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:40px;line-height:1;">&#127881;</p>
<h1 style="margin:0 0 8px;color:#fff;font-size:26px;font-weight:700;">Tu prueba comenzo</h1>
<p style="margin:0;font-size:15px;color:rgba(255,255,255,.9);">Tienes <strong>{{trial_days}} dias</strong> para descubrir todo lo que Parallly puede hacer por tu negocio.</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px;">
<p style="margin:0 0 4px;font-size:16px;color:#1f2937;">Hola <strong>{{customer_name}}</strong>,</p>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Activaste el plan <strong style="color:#3897f0;">{{plan_name}}</strong>. Aprovecha cada dia para configurar tu operacion y empezar a ver resultados.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7ff;border-radius:12px;border:1px solid #dbeafe;margin-bottom:28px;">
<tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#6b7280;">Tu prueba termina el</td><td style="text-align:right;font-size:14px;font-weight:600;color:#1f2937;">{{trial_ends_at}}</td></tr></table></td></tr>
</table>
<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Lo que puedes hacer ahora</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:10px 0;vertical-align:top;width:40px;"><div style="width:36px;height:36px;background:#f0f7ff;border-radius:10px;text-align:center;line-height:36px;font-size:18px;">&#128172;</div></td>
<td style="padding:10px 0 10px 14px;"><p style="margin:0;font-size:14px;font-weight:600;color:#1f2937;">Conectar tus canales</p><p style="margin:2px 0 0;font-size:13px;color:#6b7280;">WhatsApp, Instagram, Messenger, Telegram y SMS en un solo lugar.</p></td></tr>
<tr><td style="padding:10px 0;vertical-align:top;width:40px;"><div style="width:36px;height:36px;background:#f0f7ff;border-radius:10px;text-align:center;line-height:36px;font-size:18px;">&#129302;</div></td>
<td style="padding:10px 0 10px 14px;"><p style="margin:0;font-size:14px;font-weight:600;color:#1f2937;">Agente de IA 24/7</p><p style="margin:2px 0 0;font-size:13px;color:#6b7280;">Tu vendedor virtual que responde, agenda citas y califica leads automaticamente.</p></td></tr>
<tr><td style="padding:10px 0;vertical-align:top;width:40px;"><div style="width:36px;height:36px;background:#f0f7ff;border-radius:10px;text-align:center;line-height:36px;font-size:18px;">&#128200;</div></td>
<td style="padding:10px 0 10px 14px;"><p style="margin:0;font-size:14px;font-weight:600;color:#1f2937;">CRM y pipeline de ventas</p><p style="margin:2px 0 0;font-size:13px;color:#6b7280;">Gestiona contactos, oportunidades y seguimiento de cada negociacion.</p></td></tr>
<tr><td style="padding:10px 0;vertical-align:top;width:40px;"><div style="width:36px;height:36px;background:#f0f7ff;border-radius:10px;text-align:center;line-height:36px;font-size:18px;">&#128197;</div></td>
<td style="padding:10px 0 10px 14px;"><p style="margin:0;font-size:14px;font-weight:600;color:#1f2937;">Agenda inteligente</p><p style="margin:2px 0 0;font-size:13px;color:#6b7280;">Booking automatizado con Google Calendar y confirmacion directa por chat.</p></td></tr>
</table>
<div style="text-align:center;padding:28px 0 8px;"><a href="{{dashboard_url}}" style="display:inline-block;padding:14px 44px;background:linear-gradient(135deg,#3897f0,#2b7cd4);color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(56,151,240,.3);">Ir a mi dashboard</a></div>
<p style="margin:12px 0 0;text-align:center;font-size:12px;color:#9ca3af;">Configura tu primer canal en menos de 5 minutos</p>
</td></tr></table>
</td></tr>
<tr><td style="text-align:center;padding:24px 0 8px;">
<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Parallly &mdash; Automatizacion conversacional inteligente</p>
<p style="margin:0;font-size:11px;color:#d1d5db;"><a href="https://parallly-chat.cloud" style="color:#3897f0;text-decoration:none;">parallly-chat.cloud</a> &middot; <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Soporte</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'trial_days', 'trial_ends_at', 'dashboard_url'],
        isActive: true,
    },

    {
        name: 'Trial por vencer',
        slug: 'billing_trial_ending_soon',
        subject: 'Tu prueba termina en 3 dias — No pierdas lo que construiste',
        bodyHtml: `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="text-align:center;padding:0 0 24px;">{{#if company_logo}}<img src="{{company_logo}}" alt="Parallly" style="height:36px;"/>{{/if}}</td></tr>
<tr><td style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:4px;background:linear-gradient(90deg,#3897f0,#6c5ce7);"></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:40px;line-height:1;">&#9200;</p>
<h1 style="margin:0 0 8px;color:#fff;font-size:26px;font-weight:700;">Tu prueba termina pronto</h1>
<p style="margin:0;font-size:15px;color:rgba(255,255,255,.9);">El plan <strong>{{plan_name}}</strong> se desactiva el <strong>{{trial_ends_at}}</strong></p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px;">
<p style="margin:0 0 4px;font-size:16px;color:#1f2937;">Hola <strong>{{customer_name}}</strong>,</p>
<p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">En estos dias Parallly ha estado trabajando para tu negocio. Para no perder el acceso, agrega un metodo de pago antes de que termine tu prueba.</p>
<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Esto es lo que tienes activo hoy</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#10b981;font-size:16px;">&#10003;</span></td>
<td style="padding:8px 0;font-size:14px;color:#1f2937;"><strong>Agente de IA 24/7</strong> <span style="color:#6b7280;">&mdash; respondiendo consultas y cerrando ventas mientras duermes</span></td></tr>
<tr><td colspan="2" style="height:1px;background:#f3f4f6;"></td></tr>
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#10b981;font-size:16px;">&#10003;</span></td>
<td style="padding:8px 0;font-size:14px;color:#1f2937;"><strong>Canales conectados</strong> <span style="color:#6b7280;">&mdash; WhatsApp, Instagram, Messenger y mas, todo centralizado</span></td></tr>
<tr><td colspan="2" style="height:1px;background:#f3f4f6;"></td></tr>
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#10b981;font-size:16px;">&#10003;</span></td>
<td style="padding:8px 0;font-size:14px;color:#1f2937;"><strong>CRM y pipeline</strong> <span style="color:#6b7280;">&mdash; tus leads, oportunidades y seguimiento de ventas</span></td></tr>
<tr><td colspan="2" style="height:1px;background:#f3f4f6;"></td></tr>
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#10b981;font-size:16px;">&#10003;</span></td>
<td style="padding:8px 0;font-size:14px;color:#1f2937;"><strong>Agenda automatizada</strong> <span style="color:#6b7280;">&mdash; citas que se agendan solas con Google Calendar</span></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-radius:12px;border:1px solid #fde68a;margin-bottom:4px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0;font-size:14px;color:#92400e;line-height:1.6;"><strong>&#9888; Si no agregas un metodo de pago</strong>, tu cuenta pasara a modo lectura: el bot se detiene, las automatizaciones se pausan y no podras recibir mensajes nuevos.</p>
</td></tr></table>
<div style="text-align:center;padding:28px 0 8px;"><a href="{{update_payment_url}}" style="display:inline-block;padding:14px 44px;background:linear-gradient(135deg,#3897f0,#2b7cd4);color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(56,151,240,.3);">Suscribirme ahora</a></div>
<p style="margin:12px 0 0;text-align:center;font-size:12px;color:#9ca3af;">Sin compromisos &mdash; cancela cuando quieras</p>
</td></tr></table>
</td></tr>
<tr><td style="text-align:center;padding:24px 0 8px;">
<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Parallly &mdash; Automatizacion conversacional inteligente</p>
<p style="margin:0;font-size:11px;color:#d1d5db;"><a href="https://parallly-chat.cloud" style="color:#3897f0;text-decoration:none;">parallly-chat.cloud</a> &middot; <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Soporte</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'trial_ends_at', 'update_payment_url'],
        isActive: true,
    },

    {
        name: 'Trial vencido',
        slug: 'billing_trial_ended',
        subject: 'Tu cuenta esta en pausa — Reactiva tu plan en un clic',
        bodyHtml: `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="text-align:center;padding:0 0 24px;">{{#if company_logo}}<img src="{{company_logo}}" alt="Parallly" style="height:36px;"/>{{/if}}</td></tr>
<tr><td style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:4px;background:linear-gradient(90deg,#3897f0,#6c5ce7);"></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:40px;line-height:1;">&#128274;</p>
<h1 style="margin:0 0 8px;color:#fff;font-size:26px;font-weight:700;">Tu prueba termino</h1>
<p style="margin:0;font-size:15px;color:rgba(255,255,255,.9);">Tu cuenta entro en <strong>modo lectura</strong></p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px;">
<p style="margin:0 0 4px;font-size:16px;color:#1f2937;">Hola <strong>{{customer_name}}</strong>,</p>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Tu prueba gratuita del plan <strong>{{plan_name}}</strong> termino. Podes ver tu informacion pero el bot, los canales y las automatizaciones estan pausados.</p>
<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Esto es lo que estas perdiendo ahora mismo</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#ef4444;font-size:16px;">&#10007;</span></td>
<td style="padding:8px 0;font-size:14px;color:#6b7280;"><strong style="color:#1f2937;">Agente de IA detenido</strong> &mdash; tus clientes escriben pero nadie responde</td></tr>
<tr><td colspan="2" style="height:1px;background:#f3f4f6;"></td></tr>
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#ef4444;font-size:16px;">&#10007;</span></td>
<td style="padding:8px 0;font-size:14px;color:#6b7280;"><strong style="color:#1f2937;">Canales desconectados</strong> &mdash; mensajes de WhatsApp, Instagram y Messenger sin atender</td></tr>
<tr><td colspan="2" style="height:1px;background:#f3f4f6;"></td></tr>
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#ef4444;font-size:16px;">&#10007;</span></td>
<td style="padding:8px 0;font-size:14px;color:#6b7280;"><strong style="color:#1f2937;">Citas y automatizaciones pausadas</strong> &mdash; tus clientes no pueden agendar</td></tr>
<tr><td colspan="2" style="height:1px;background:#f3f4f6;"></td></tr>
<tr><td style="padding:8px 0;vertical-align:middle;width:28px;"><span style="color:#ef4444;font-size:16px;">&#10007;</span></td>
<td style="padding:8px 0;font-size:14px;color:#6b7280;"><strong style="color:#1f2937;">CRM congelado</strong> &mdash; leads y oportunidades sin seguimiento</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border-radius:12px;border:1px solid #fecaca;margin-bottom:4px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0;font-size:14px;color:#991b1b;line-height:1.6;">Tienes <strong>22 dias</strong> para reactivar antes de que archivemos tu informacion. Despues de eso, tus datos seran eliminados permanentemente.</p>
</td></tr></table>
<div style="text-align:center;padding:28px 0 8px;"><a href="{{update_payment_url}}" style="display:inline-block;padding:14px 44px;background:linear-gradient(135deg,#3897f0,#2b7cd4);color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(56,151,240,.3);">Reactivar mi cuenta</a></div>
<p style="margin:12px 0 0;text-align:center;font-size:12px;color:#9ca3af;">Necesitas mas tiempo? <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Escribenos</a></p>
</td></tr></table>
</td></tr>
<tr><td style="text-align:center;padding:24px 0 8px;">
<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Parallly &mdash; Automatizacion conversacional inteligente</p>
<p style="margin:0;font-size:11px;color:#d1d5db;"><a href="https://parallly-chat.cloud" style="color:#3897f0;text-decoration:none;">parallly-chat.cloud</a> &middot; <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Soporte</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'update_payment_url'],
        isActive: true,
    },

    {
        name: 'Pago recibido',
        slug: 'billing_payment_succeeded',
        subject: 'Pago confirmado — Gracias por confiar en Parallly',
        bodyHtml: `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="text-align:center;padding:0 0 24px;">{{#if company_logo}}<img src="{{company_logo}}" alt="Parallly" style="height:36px;"/>{{/if}}</td></tr>
<tr><td style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:4px;background:linear-gradient(90deg,#3897f0,#6c5ce7);"></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:linear-gradient(135deg,#10b981,#059669);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:40px;line-height:1;">&#9989;</p>
<h1 style="margin:0 0 8px;color:#fff;font-size:26px;font-weight:700;">Pago confirmado</h1>
<p style="margin:0;font-size:15px;color:rgba(255,255,255,.9);">Gracias por seguir confiando en Parallly</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px;">
<p style="margin:0 0 4px;font-size:16px;color:#1f2937;">Hola <strong>{{customer_name}}</strong>,</p>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Recibimos tu pago exitosamente. Tu suscripcion sigue activa y todas tus herramientas estan funcionando.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;margin-bottom:24px;">
<tr><td style="padding:20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Plan</td><td style="padding:6px 0;text-align:right;font-size:14px;font-weight:600;color:#1f2937;">{{plan_name}}</td></tr>
<tr><td colspan="2" style="height:1px;background:#dcfce7;"></td></tr>
<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Monto cobrado</td><td style="padding:6px 0;text-align:right;font-size:14px;font-weight:600;color:#1f2937;">{{amount_charged}} {{currency}}</td></tr>
<tr><td colspan="2" style="height:1px;background:#dcfce7;"></td></tr>
<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Proximo cobro</td><td style="padding:6px 0;text-align:right;font-size:14px;font-weight:600;color:#1f2937;">{{next_billing_date}}</td></tr>
</table>
</td></tr></table>
{{#if invoice_url}}<div style="text-align:center;margin-bottom:24px;"><a href="{{invoice_url}}" style="font-size:13px;color:#3897f0;text-decoration:none;font-weight:600;">&#128196; Ver recibo completo</a></div>{{/if}}
<div style="text-align:center;padding:4px 0 8px;"><a href="{{dashboard_url}}" style="display:inline-block;padding:14px 44px;background:linear-gradient(135deg,#3897f0,#2b7cd4);color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(56,151,240,.3);">Ir a mi dashboard</a></div>
<p style="margin:16px 0 0;text-align:center;font-size:12px;color:#9ca3af;">Dudas sobre tu factura? <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Contactanos</a></p>
</td></tr></table>
</td></tr>
<tr><td style="text-align:center;padding:24px 0 8px;">
<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Parallly &mdash; Automatizacion conversacional inteligente</p>
<p style="margin:0;font-size:11px;color:#d1d5db;"><a href="https://parallly-chat.cloud" style="color:#3897f0;text-decoration:none;">parallly-chat.cloud</a> &middot; <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Soporte</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'amount_charged', 'currency', 'next_billing_date', 'invoice_url', 'dashboard_url'],
        isActive: true,
    },

    // -----------------------------------------------------------------------
    // Property / Vacation-rental templates
    // -----------------------------------------------------------------------

    {
        name: 'Confirmación de Reserva de Propiedad',
        slug: 'property_booking_confirmation',
        subject: 'Reserva confirmada — {{property_name}}',
        bodyHtml: `<h2>¡Tu reserva está confirmada!</h2>
<p>Hola {{guest_name}},</p>
<p>Tu reserva en <strong>{{property_name}}</strong> ha sido confirmada.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Check-in</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{check_in}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Check-out</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{check_out}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Noches</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{nights}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Total</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{total_price}} {{currency}}</td></tr>
</table>
{{#if check_in_instructions}}<h3>Instrucciones de check-in</h3><p>{{check_in_instructions}}</p>{{/if}}
<p>Si tienes alguna pregunta, no dudes en contactarnos.</p>`,
        bodyJson: {},
        variables: ['guest_name', 'property_name', 'check_in', 'check_out', 'nights', 'total_price', 'currency', 'check_in_instructions'],
        isActive: true,
    },

    {
        name: 'Confirmación de Reserva de Tour',
        slug: 'tour_booking_confirmation',
        subject: 'Reserva de aventura confirmada — {{package_name}}',
        bodyHtml: `<h2>¡Tu aventura está confirmada!</h2>
<p>Hola {{guest_name}},</p>
<p>Tu reserva para el paquete/tour <strong>{{package_name}}</strong> ha sido confirmada con éxito.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Fecha de salida</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{departure_date}}</td></tr>
{{#if departure_time}}<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Hora de salida</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{departure_time}}</td></tr>{{/if}}
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Personas (Grupo)</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{party_size}} ({{adults}} adultos, {{children}} niños)</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Total</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{total_price}} {{currency}}</td></tr>
</table>
{{#if departure_location}}<h3>Punto de encuentro / Salida</h3><p>{{departure_location}}</p>{{/if}}
<p>Por favor, asegúrate de llegar con 15 minutos de anticipación. ¡Prepárate para una experiencia inolvidable!</p>`,
        bodyJson: {},
        variables: ['guest_name', 'package_name', 'departure_date', 'departure_time', 'party_size', 'adults', 'children', 'total_price', 'currency', 'departure_location'],
        isActive: true,
    },

    {
        name: 'Recordatorio de Check-in',
        slug: 'property_check_in_reminder',
        subject: 'Mañana es tu check-in — {{property_name}}',
        bodyHtml: `<h2>¡Tu llegada es mañana!</h2>
<p>Hola {{guest_name}},</p>
<p>Te recordamos que tu check-in en <strong>{{property_name}}</strong> es mañana.</p>
<p><strong>Fecha:</strong> {{check_in_date}}<br/><strong>Hora:</strong> {{check_in_time}}</p>
{{#if address}}<p><strong>Dirección:</strong> {{address}}</p>{{/if}}
{{#if check_in_instructions}}<h3>Instrucciones de llegada</h3><p>{{check_in_instructions}}</p>{{/if}}
<p>¡Te esperamos!</p>`,
        bodyJson: {},
        variables: ['guest_name', 'property_name', 'check_in_date', 'check_in_time', 'address', 'check_in_instructions'],
        isActive: true,
    },

    // -----------------------------------------------------------------------
    // Appointment email-specific templates (complement the WhatsApp channel
    // notifications already sent by AppointmentNotificationsService)
    // -----------------------------------------------------------------------

    {
        name: 'Confirmación de Cita (Email)',
        slug: 'appointment_confirmation_email',
        subject: 'Cita confirmada — {{service_name}}',
        bodyHtml: `<h2>Tu cita está confirmada</h2>
<p>Hola {{customer_name}},</p>
<p>Tu cita ha sido agendada exitosamente.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Servicio</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{service_name}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Fecha</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{appointment_date}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Hora</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{appointment_time}}</td></tr>
{{#if location}}<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Ubicación</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{location}}</td></tr>{{/if}}
</table>
<p>Si necesitas cancelar o reprogramar, contáctanos con al menos 24 horas de anticipación.</p>`,
        bodyJson: {},
        variables: ['customer_name', 'service_name', 'appointment_date', 'appointment_time', 'location'],
        isActive: true,
    },

    {
        name: 'Recordatorio de Cita (Email)',
        slug: 'appointment_reminder_email',
        subject: 'Recordatorio: tu cita mañana — {{service_name}}',
        bodyHtml: `<h2>Recordatorio de tu cita</h2>
<p>Hola {{customer_name}},</p>
<p>Te recordamos que tienes una cita mañana:</p>
<p><strong>Servicio:</strong> {{service_name}}<br/><strong>Fecha:</strong> {{appointment_date}}<br/><strong>Hora:</strong> {{appointment_time}}</p>
{{#if location}}<p><strong>Ubicación:</strong> {{location}}</p>{{/if}}
<p>¡Te esperamos!</p>`,
        bodyJson: {},
        variables: ['customer_name', 'service_name', 'appointment_date', 'appointment_time', 'location'],
        isActive: true,
    },

    // -----------------------------------------------------------------------
    // Handoff / escalation notification template
    // -----------------------------------------------------------------------

    {
        name: 'Notificación de Escalación',
        slug: 'handoff_notification',
        subject: '🔴 Escalación: {{contact_name}} necesita atención',
        bodyHtml: `<h2>Conversación escalada</h2>
<p>Hola {{agent_name}},</p>
<p>Un cliente necesita atención humana.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Cliente</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{contact_name}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Teléfono</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{contact_phone}}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Razón</strong></td><td style="padding:8px;border-bottom:1px solid #eee">{{reason}}</td></tr>
</table>
{{#if last_message}}<p><strong>Último mensaje:</strong></p><blockquote style="border-left:3px solid #ddd;padding:8px 12px;margin:8px 0;color:#666">{{last_message}}</blockquote>{{/if}}
<p><a href="{{inbox_url}}" style="display:inline-block;padding:10px 20px;background:#6c5ce7;color:white;border-radius:8px;text-decoration:none">Abrir Inbox</a></p>`,
        bodyJson: {},
        variables: ['agent_name', 'contact_name', 'contact_phone', 'reason', 'last_message', 'inbox_url'],
        isActive: true,
    },

    {
        name: 'Pago fallido',
        slug: 'billing_payment_failed',
        subject: 'Accion requerida: Problema con tu pago — Parallly',
        bodyHtml: `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="text-align:center;padding:0 0 24px;">{{#if company_logo}}<img src="{{company_logo}}" alt="Parallly" style="height:36px;"/>{{/if}}</td></tr>
<tr><td style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:4px;background:linear-gradient(90deg,#3897f0,#6c5ce7);"></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:40px;line-height:1;">&#9888;</p>
<h1 style="margin:0 0 8px;color:#fff;font-size:26px;font-weight:700;">Problema con tu pago</h1>
<p style="margin:0;font-size:15px;color:rgba(255,255,255,.9);">No pudimos procesar el cobro de tu suscripcion</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px;">
<p style="margin:0 0 4px;font-size:16px;color:#1f2937;">Hola <strong>{{customer_name}}</strong>,</p>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Intentamos cobrar tu suscripcion del plan <strong>{{plan_name}}</strong> por <strong>{{amount_charged}} {{currency}}</strong> pero la transaccion no pudo completarse.</p>
{{#if failure_reason}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border-radius:12px;border:1px solid #fecaca;margin-bottom:24px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0;font-size:14px;color:#991b1b;"><strong>Motivo:</strong> {{failure_reason}}</p>
</td></tr></table>{{/if}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7ff;border-radius:12px;border:1px solid #dbeafe;margin-bottom:24px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0 0 4px;font-size:13px;color:#6b7280;">&#128260; Vamos a reintentar el cobro automaticamente en las proximas horas.</p>
<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Para evitar la suspension de tu cuenta, actualiza tu metodo de pago ahora.</p>
</td></tr></table>
<div style="text-align:center;padding:4px 0 8px;"><a href="{{update_payment_url}}" style="display:inline-block;padding:14px 44px;background:linear-gradient(135deg,#3897f0,#2b7cd4);color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(56,151,240,.3);">Actualizar metodo de pago</a></div>
<p style="margin:16px 0 0;text-align:center;font-size:12px;color:#9ca3af;">Tu cuenta sigue activa. Te avisaremos antes de tomar cualquier accion.</p>
</td></tr></table>
</td></tr>
<tr><td style="text-align:center;padding:24px 0 8px;">
<p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Parallly &mdash; Automatizacion conversacional inteligente</p>
<p style="margin:0;font-size:11px;color:#d1d5db;"><a href="https://parallly-chat.cloud" style="color:#3897f0;text-decoration:none;">parallly-chat.cloud</a> &middot; <a href="mailto:it.executive@parallext.com" style="color:#3897f0;text-decoration:none;">Soporte</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'amount_charged', 'currency', 'failure_reason', 'update_payment_url'],
        isActive: true,
    },
];

@Injectable()
export class EmailTemplatesService {
    private readonly logger = new Logger(EmailTemplatesService.name);

    constructor(
        private prisma: PrismaService,
        private emailService: EmailService,
    ) {}

    /**
     * List all templates for a tenant (seeds defaults on first call)
     */
    async list(schemaName: string): Promise<EmailTemplate[]> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT id, name, slug, subject, body_html, body_json, variables, is_active, created_at, updated_at
             FROM email_templates ORDER BY created_at ASC`,
            [],
        );

        if ((rows as any[]).length === 0) {
            await this.seedDefaults(schemaName);
            return this.list(schemaName);
        }

        return (rows as any[]).map(this.mapRow);
    }

    async getById(schemaName: string, templateId: string): Promise<EmailTemplate> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT id, name, slug, subject, body_html, body_json, variables, is_active, created_at, updated_at
             FROM email_templates WHERE id = $1::uuid`,
            [templateId],
        );
        const row = (rows as any[])[0];
        if (!row) throw new NotFoundException('Template not found');
        return this.mapRow(row);
    }

    async getBySlug(schemaName: string, slug: string): Promise<EmailTemplate | null> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT id, name, slug, subject, body_html, body_json, variables, is_active, created_at, updated_at
             FROM email_templates WHERE slug = $1 AND is_active = true`,
            [slug],
        );
        const row = (rows as any[])[0];
        return row ? this.mapRow(row) : null;
    }

    async create(schemaName: string, data: {
        name: string; slug: string; subject: string;
        bodyHtml: string; bodyJson?: any; variables?: string[];
    }): Promise<EmailTemplate> {
        const id = randomUUID();
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO email_templates (id, name, slug, subject, body_html, body_json, variables, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())`,
            [id, data.name, data.slug, data.subject, data.bodyHtml, JSON.stringify(data.bodyJson || {}), data.variables || []],
        );
        return this.getById(schemaName, id);
    }

    async update(schemaName: string, templateId: string, data: {
        name?: string; subject?: string; bodyHtml?: string;
        bodyJson?: any; variables?: string[]; isActive?: boolean;
    }): Promise<EmailTemplate> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
        if (data.subject !== undefined) { sets.push(`subject = $${idx++}`); params.push(data.subject); }
        if (data.bodyHtml !== undefined) { sets.push(`body_html = $${idx++}`); params.push(data.bodyHtml); }
        if (data.bodyJson !== undefined) { sets.push(`body_json = $${idx++}::jsonb`); params.push(JSON.stringify(data.bodyJson)); }
        if (data.variables !== undefined) { sets.push(`variables = $${idx++}`); params.push(data.variables); }
        if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
        sets.push(`updated_at = NOW()`);

        params.push(templateId);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE email_templates SET ${sets.join(', ')} WHERE id = $${idx}::uuid`,
            params,
        );
        return this.getById(schemaName, templateId);
    }

    async delete(schemaName: string, templateId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM email_templates WHERE id = $1::uuid`,
            [templateId],
        );
    }

    /**
     * Render a template with variables and send it
     */
    async renderAndSend(
        schemaName: string,
        slug: string,
        to: string,
        variables: Record<string, string>,
    ): Promise<boolean> {
        let template = await this.getBySlug(schemaName, slug);
        if (!template) {
            await this.seedDefaults(schemaName);
            template = await this.getBySlug(schemaName, slug);
        }
        if (!template) {
            this.logger.warn(`Template "${slug}" not found after seeding — email not sent`);
            return false;
        }

        const subject = this.renderVariables(template.subject, variables);
        const html = this.renderVariables(template.bodyHtml, variables);

        return this.emailService.send({ to, subject, html });
    }

    /**
     * Send a test email with sample data
     */
    async sendTest(schemaName: string, templateId: string, to: string): Promise<boolean> {
        const template = await this.getById(schemaName, templateId);

        // Fill with sample values
        const sampleVars: Record<string, string> = {};
        for (const v of template.variables) {
            sampleVars[v] = this.getSampleValue(v);
        }

        const subject = `[TEST] ${this.renderVariables(template.subject, sampleVars)}`;
        const html = this.renderVariables(template.bodyHtml, sampleVars);

        return this.emailService.send({ to, subject, html });
    }

    // ── Private ───────────────────────────────────────────────

    private renderVariables(text: string, vars: Record<string, string>): string {
        let result = text;

        // Handle {{#if var}}...{{/if}} conditionals
        result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
            return vars[varName] ? content : '';
        });

        // Replace {{variable}} placeholders
        result = result.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
            return vars[varName] || '';
        });

        return result;
    }

    private getSampleValue(varName: string): string {
        const samples: Record<string, string> = {
            customer_name: 'Juan Perez',
            customer_email: 'juan@ejemplo.com',
            customer_phone: '+57 300 123 4567',
            company_name: 'Parallly',
            company_logo: 'https://parallly-chat.cloud/parallly-logo.svg',
            service_name: 'Consulta General',
            appointment_date: '15 de abril, 2026',
            appointment_time: '3:00 PM',
            location: 'Oficina Principal, Cra 7 #72-41',
            agent_name: 'Maria Lopez',
            order_id: 'ORD-001234',
            order_items_html: '<p style="margin:4px 0;font-size:14px;">1x Producto A — $50,000</p><p style="margin:4px 0;font-size:14px;">2x Producto B — $30,000</p>',
            order_total: '$110,000 COP',
            payment_method: 'Transferencia bancaria',
            cancel_link: '#',
            plan_name: 'Starter',
            trial_days: '14',
            trial_ends_at: '17 de mayo, 2026',
            amount_charged: '29.99',
            currency: 'USD',
            next_billing_date: '17 de junio, 2026',
            dashboard_url: 'https://admin.parallly-chat.cloud/admin',
            update_payment_url: 'https://admin.parallly-chat.cloud/admin/settings/billing',
            invoice_url: '#',
            failure_reason: 'Fondos insuficientes',
        };
        return samples[varName] || `[${varName}]`;
    }

    private readonly platformRefreshed = new Set<string>();

    async refreshPlatformTemplates(schemaName: string): Promise<void> {
        if (this.platformRefreshed.has(schemaName)) return;
        const billingTpls = DEFAULT_TEMPLATES.filter(t => t.slug.startsWith('billing_'));
        for (const tpl of billingTpls) {
            const id = randomUUID();
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO email_templates (id, name, slug, subject, body_html, body_json, variables, is_active, created_at, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())
                 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, subject = EXCLUDED.subject,
                   body_html = EXCLUDED.body_html, variables = EXCLUDED.variables, updated_at = NOW()`,
                [id, tpl.name, tpl.slug, tpl.subject, tpl.bodyHtml, JSON.stringify(tpl.bodyJson), tpl.variables, tpl.isActive],
            );
        }
        this.platformRefreshed.add(schemaName);
    }

    private async seedDefaults(schemaName: string): Promise<void> {
        this.logger.log(`Seeding default email templates for ${schemaName}`);
        for (const tpl of DEFAULT_TEMPLATES) {
            const id = randomUUID();
            const isBilling = tpl.slug.startsWith('billing_');
            const conflict = isBilling
                ? `ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, subject = EXCLUDED.subject,
                     body_html = EXCLUDED.body_html, variables = EXCLUDED.variables, updated_at = NOW()`
                : `ON CONFLICT (slug) DO NOTHING`;
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO email_templates (id, name, slug, subject, body_html, body_json, variables, is_active, created_at, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())
                 ${conflict}`,
                [id, tpl.name, tpl.slug, tpl.subject, tpl.bodyHtml, JSON.stringify(tpl.bodyJson), tpl.variables, tpl.isActive],
            );
        }
    }

    private mapRow(row: any): EmailTemplate {
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            subject: row.subject,
            bodyHtml: row.body_html,
            bodyJson: row.body_json || {},
            variables: row.variables || [],
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
