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
        subject: 'Tu prueba gratuita de {{trial_days}} dias arranco — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#6c5ce7,#0984e3);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Tu prueba empezo</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Activaste el plan <strong>{{plan_name}}</strong> y tienes <strong>{{trial_days}} dias</strong> para probarlo sin costo.</p>
    <div style="background:#f0f4ff;padding:16px;border-radius:8px;border-left:3px solid #6c5ce7;margin:16px 0;">
      <p style="margin:4px 0;font-size:14px;"><strong>Tu prueba termina el:</strong> {{trial_ends_at}}</p>
    </div>
    <p style="font-size:14px;color:#555;">Aprovecha estos dias para conectar tus canales, cargar tus servicios y configurar tu agente IA.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{dashboard_url}}" style="background:#6c5ce7;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Ir a mi dashboard</a>
    </div>
    <p style="font-size:12px;color:#999;margin-top:20px;">Si tienes dudas, responde a este correo.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'trial_days', 'trial_ends_at', 'dashboard_url'],
        isActive: true,
    },

    {
        name: 'Trial por vencer',
        slug: 'billing_trial_ending_soon',
        subject: 'Tu prueba termina en 3 dias — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#f39c12,#e67e22);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Tu prueba termina pronto</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Tu prueba del plan <strong>{{plan_name}}</strong> termina el <strong>{{trial_ends_at}}</strong>.</p>
    <p style="font-size:14px;color:#555;">Para seguir usando {{company_name}} sin interrupcion, agrega un metodo de pago antes de esa fecha.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{update_payment_url}}" style="background:#e67e22;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Agregar metodo de pago</a>
    </div>
    <p style="font-size:12px;color:#999;margin-top:20px;">Si no haces nada, tu cuenta pasara a modo lectura el {{trial_ends_at}}. Podes reactivarla en cualquier momento desde tu dashboard.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'trial_ends_at', 'update_payment_url'],
        isActive: true,
    },

    {
        name: 'Trial vencido',
        slug: 'billing_trial_ended',
        subject: 'Tu prueba gratuita termino — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Tu prueba termino</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Tu prueba gratuita del plan <strong>{{plan_name}}</strong> termino. Tu cuenta entro en <strong>modo lectura</strong>: podes ver tu informacion pero el bot y las automatizaciones estan pausadas.</p>
    <p style="font-size:14px;color:#555;">Agrega un metodo de pago para reactivar tu cuenta. Tenes <strong>22 dias</strong> antes de que archivemos tu informacion.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{update_payment_url}}" style="background:#6c5ce7;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reactivar mi cuenta</a>
    </div>
    <p style="font-size:12px;color:#999;margin-top:20px;">Si tenes dudas o necesitas mas tiempo, respondenos a este correo.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'update_payment_url'],
        isActive: true,
    },

    {
        name: 'Pago recibido',
        slug: 'billing_payment_succeeded',
        subject: 'Recibimos tu pago — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#00b894,#00cec9);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Pago confirmado</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Recibimos tu pago. Gracias por seguir con {{company_name}}.</p>
    <div style="background:#f0fff4;padding:16px;border-radius:8px;border-left:3px solid #00b894;margin:16px 0;">
      <p style="margin:4px 0;font-size:14px;"><strong>Plan:</strong> {{plan_name}}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Monto:</strong> {{amount_charged}} {{currency}}</p>
      <p style="margin:4px 0;font-size:14px;"><strong>Proximo cobro:</strong> {{next_billing_date}}</p>
    </div>
    {{#if invoice_url}}<div style="text-align:center;margin:20px 0;">
      <a href="{{invoice_url}}" style="background:#00b894;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Ver recibo</a>
    </div>{{/if}}
    <p style="font-size:12px;color:#999;margin-top:20px;">Si tenes dudas sobre tu factura, respondenos a este correo.</p>
  </div>
</div>`,
        bodyJson: {},
        variables: ['customer_name', 'company_name', 'company_logo', 'plan_name', 'amount_charged', 'currency', 'next_billing_date', 'invoice_url'],
        isActive: true,
    },

    {
        name: 'Pago fallido',
        slug: 'billing_payment_failed',
        subject: 'No pudimos cobrar tu suscripcion — {{company_name}}',
        bodyHtml: `<div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:0;">
  <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    {{#if company_logo}}<img src="{{company_logo}}" alt="{{company_name}}" style="max-height:40px;margin-bottom:12px;" />{{/if}}
    <h2 style="color:white;margin:0;font-size:20px;">Problema con tu pago</h2>
  </div>
  <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="font-size:15px;color:#333;">Hola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;">Intentamos cobrar tu suscripcion del plan <strong>{{plan_name}}</strong> por <strong>{{amount_charged}} {{currency}}</strong> pero la transaccion no pudo completarse.</p>
    {{#if failure_reason}}<div style="background:#fff5f5;padding:12px;border-radius:8px;border-left:3px solid #e74c3c;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#c0392b;"><strong>Motivo:</strong> {{failure_reason}}</p>
    </div>{{/if}}
    <p style="font-size:14px;color:#555;">Vamos a reintentar el cobro automaticamente en las proximas horas. Para evitar la suspension, actualiza tu metodo de pago ahora.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{update_payment_url}}" style="background:#e74c3c;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Actualizar metodo de pago</a>
    </div>
    <p style="font-size:12px;color:#999;margin-top:20px;">Tu cuenta sigue activa. Si despues de varios intentos no logramos cobrar, te avisaremos antes de suspender.</p>
  </div>
</div>`,
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
        const template = await this.getBySlug(schemaName, slug);
        if (!template) {
            this.logger.warn(`Template "${slug}" not found — email not sent`);
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
            company_name: 'Mi Empresa SAS',
            company_logo: '',
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
        };
        return samples[varName] || `[${varName}]`;
    }

    private async seedDefaults(schemaName: string): Promise<void> {
        this.logger.log(`Seeding default email templates for ${schemaName}`);
        for (const tpl of DEFAULT_TEMPLATES) {
            const id = randomUUID();
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO email_templates (id, name, slug, subject, body_html, body_json, variables, is_active, created_at, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())
                 ON CONFLICT (slug) DO NOTHING`,
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
