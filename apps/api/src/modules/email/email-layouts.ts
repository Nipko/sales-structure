/**
 * Parallly — Professional Email Layouts
 * Based on respond.io design language: clean, white, centered, with logo header
 */

const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://parallly-chat.cloud/parallly-logo.svg';
const BRAND_COLOR = '#3897f0';
const BRAND_DARK = '#2b7cd4';
const SITE_URL = 'https://parallly-chat.cloud';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
const SUPPORT_URL = 'mailto:it.executive@parallext.com';

/**
 * Wraps content in the standard Parallly email layout
 */
export function emailLayout(content: string, footerExtra?: string): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Parallly</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <a href="${SITE_URL}" style="text-decoration:none;">
                <img src="${LOGO_URL}" alt="Parallly" height="36" style="height:36px;" />
              </a>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:12px;border:1px solid #e8e8e8;padding:40px 36px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              ${footerExtra || ''}
              <p style="margin:12px 0 0;font-size:12px;color:#999;">
                &copy; ${new Date().getFullYear()} <a href="${SITE_URL}" style="color:#999;text-decoration:underline;">Parallly</a> &mdash; Automatización conversacional inteligente
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * OTP code block — big centered code with border
 */
export function otpBlock(code: string): string {
    return `<div style="margin:24px auto;text-align:center;">
  <div style="display:inline-block;padding:14px 32px;border:2px solid #222;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;color:#111;font-family:'Courier New',monospace;">
    ${code}
  </div>
</div>`;
}

/**
 * Security tips section
 */
export function securityTips(): string {
    return `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;">
  <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111;">&#128274; Mantente seguro</p>
  <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#555;line-height:1.8;">
    <li>Nunca compartas tu contrasena o codigo de acceso con nadie. El equipo de Parallly <strong>nunca</strong> te pedira tus datos de acceso.</li>
    <li>Activa la <strong>autenticacion de dos factores (2FA)</strong> en tu perfil para mayor seguridad.</li>
  </ul>
</div>`;
}

/**
 * Primary action button
 */
export function actionButton(text: string, url: string): string {
    return `<div style="text-align:center;margin:24px 0;">
  <a href="${url}" style="display:inline-block;padding:14px 36px;background-color:${BRAND_COLOR};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;box-shadow:0 2px 8px rgba(56,151,240,0.25);">
    ${text}
  </a>
</div>`;
}

/**
 * Feature highlight row (icon + title + description)
 */
function featureRow(icon: string, title: string, description: string): string {
    return `<tr>
  <td style="padding:8px 0;vertical-align:top;width:28px;font-size:18px;">${icon}</td>
  <td style="padding:8px 0 8px 12px;vertical-align:top;">
    <p style="margin:0;font-size:13px;font-weight:600;color:#222;">${title}</p>
    <p style="margin:2px 0 0;font-size:12px;color:#666;line-height:1.5;">${description}</p>
  </td>
</tr>`;
}

/**
 * Feature highlights block
 */
function featureHighlights(features: { icon: string; title: string; desc: string }[]): string {
    const rows = features.map(f => featureRow(f.icon, f.title, f.desc)).join('');
    return `<div style="margin-top:24px;padding:20px;background-color:#f9fafb;border-radius:10px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
</div>`;
}

/**
 * Tip/info box
 */
function tipBox(text: string): string {
    return `<div style="margin-top:20px;padding:14px 16px;background-color:#eef6ff;border-left:3px solid ${BRAND_COLOR};border-radius:6px;">
  <p style="margin:0;font-size:13px;color:#333;line-height:1.6;">&#128161; ${text}</p>
</div>`;
}

// ── Pre-built email templates ──────────────────────────────

export function verificationEmail(firstName: string, code: string): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Hola ${firstName},</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        Usa este codigo para completar tu inicio de sesion en <a href="${SITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;font-weight:600;">Parallly</a>:
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">Valido por 10 minutos. No compartas este codigo con nadie.</p>
      <p style="margin:0;font-size:13px;color:#555;">Si no fuiste tu, <a href="${DASHBOARD_URL}/login" style="color:${BRAND_COLOR};">restablece tu contrasena</a> inmediatamente.</p>
      ${securityTips()}
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}

export function passwordResetEmail(firstName: string, code: string): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Hola ${firstName},</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        Recibimos una solicitud para restablecer tu contrasena en <a href="${SITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;font-weight:600;">Parallly</a>. Usa este codigo:
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">Valido por 10 minutos. Si no solicitaste esto, ignora este correo.</p>
      ${tipBox('Despues de restablecer tu contrasena, te recomendamos activar la autenticacion de dos factores (2FA) para mayor proteccion.')}
      ${securityTips()}
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}

export function twoFactorEmail(firstName: string, code: string): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Hola ${firstName},</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        Tu codigo de autenticacion de dos factores para <a href="${SITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;font-weight:600;">Parallly</a> es:
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">Valido por 5 minutos. Si no intentaste iniciar sesion, cambia tu contrasena inmediatamente.</p>
      ${securityTips()}
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}

export function welcomeEmail(firstName: string, companyName: string): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:20px;">
        <p style="margin:0;font-size:28px;">&#127881;</p>
      </div>
      <h1 style="margin:0 0 8px;font-size:22px;color:#111;text-align:center;">Bienvenido a Parallly</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        Tu cuenta para <strong>${companyName}</strong> ha sido creada exitosamente.
      </p>
      ${featureHighlights([
          { icon: '&#128172;', title: 'Conecta tus canales', desc: 'WhatsApp, Instagram, Messenger, Telegram y SMS en un solo lugar.' },
          { icon: '&#129302;', title: 'Configura tu agente de IA', desc: 'Personaliza respuestas, horarios y personalidad para automatizar ventas.' },
          { icon: '&#128202;', title: 'Pipeline de ventas', desc: 'Gestiona contactos, oportunidades y seguimiento desde el CRM integrado.' },
          { icon: '&#128197;', title: 'Agenda citas', desc: 'Booking automatizado con Google Calendar y confirmacion por chat.' },
      ])}
      ${actionButton('Ir al Dashboard', `${DASHBOARD_URL}/admin`)}
      ${tipBox('Comienza conectando tu primer canal de comunicacion. El agente IA puede empezar a responder en minutos.')}
      <p style="margin:16px 0 0;font-size:13px;color:#999;text-align:center;">Si necesitas ayuda, estamos para ti.</p>
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}

export function passwordChangedEmail(firstName: string): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#dcfce7;border-radius:50%;line-height:48px;font-size:22px;">&#9989;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">Contrasena actualizada</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#555;text-align:center;">
        Hola ${firstName}, tu contrasena en <a href="${SITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;font-weight:600;">Parallly</a> ha sido cambiada exitosamente.
      </p>
      <div style="margin:20px 0;padding:16px;background-color:#fef3c7;border-radius:8px;border-left:3px solid #f59e0b;">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
          <strong>&#9888;&#65039; Si no realizaste este cambio</strong>, alguien podria tener acceso a tu cuenta. <a href="${DASHBOARD_URL}/forgot-password" style="color:${BRAND_COLOR};font-weight:600;">Restablece tu contrasena</a> y contacta a soporte inmediatamente.
        </p>
      </div>
      ${securityTips()}
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}

/**
 * Invitation email — sent when a team member is invited.
 * Used by InvitationsService.
 */
export function invitationEmail(input: {
    inviterName: string | null;
    tenantName: string;
    tenantLogoUrl: string | null;
    roleLabel: string;
    acceptUrl: string;
    expiresText: string;
}): string {
    const intro = input.inviterName
        ? `<strong>${input.inviterName}</strong> te invito a unirte a <strong>${input.tenantName}</strong> en Parallly como <strong>${input.roleLabel}</strong>.`
        : `Te invitaron a unirte a <strong>${input.tenantName}</strong> en Parallly como <strong>${input.roleLabel}</strong>.`;

    const tenantLogoBlock = input.tenantLogoUrl
        ? `<div style="text-align:center;margin:0 0 18px;">
             <img src="${input.tenantLogoUrl}" alt="${input.tenantName}" height="48" style="height:48px;border-radius:8px;" />
           </div>`
        : '';

    return emailLayout(`
        ${tenantLogoBlock}
        <h1 style="margin:0 0 12px;font-size:22px;color:#111;text-align:center;">Te estamos esperando</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6;text-align:center;">${intro}</p>
        ${actionButton('Aceptar invitacion', input.acceptUrl)}
        ${featureHighlights([
            { icon: '&#128236;', title: 'Bandeja unificada', desc: 'Atiende conversaciones de todos los canales en un solo lugar.' },
            { icon: '&#129302;', title: 'Asistente IA', desc: 'Un copiloto inteligente que te sugiere respuestas y automatiza tareas.' },
            { icon: '&#128200;', title: 'CRM integrado', desc: 'Contactos, pipeline y seguimiento sin salir de la plataforma.' },
        ])}
        <p style="margin:18px 0 0;font-size:13px;color:#777;text-align:center;">
            Este enlace expira el <strong>${input.expiresText}</strong>.
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:#999;text-align:center;">
            Si no esperabas esta invitacion, podes ignorar este correo.
        </p>
    `);
}

/**
 * Welcome email for invited team members — sent after accepting an invitation.
 */
export function welcomeTeamMemberEmail(firstName: string, tenantName: string, roleLabel: string): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:20px;">
        <p style="margin:0;font-size:28px;">&#127881;</p>
      </div>
      <h1 style="margin:0 0 8px;font-size:22px;color:#111;text-align:center;">Bienvenido al equipo</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        Hola ${firstName}, ya formas parte de <strong>${tenantName}</strong> como <strong>${roleLabel}</strong>.
      </p>
      ${featureHighlights([
          { icon: '&#128236;', title: 'Bandeja de entrada', desc: 'Accede a las conversaciones asignadas desde el inbox.' },
          { icon: '&#128172;', title: 'Respuestas rapidas', desc: 'Usa macros y respuestas predefinidas para agilizar la atencion.' },
          { icon: '&#129302;', title: 'Copiloto IA', desc: 'El asistente te sugiere respuestas basadas en el contexto de cada conversacion.' },
          { icon: '&#128202;', title: 'CRM y contactos', desc: 'Consulta el perfil de cada contacto, historial y notas en un solo lugar.' },
      ])}
      ${actionButton('Ir al Dashboard', `${DASHBOARD_URL}/admin`)}
      ${tipBox('Explora la bandeja de entrada y familiarizate con las herramientas. Si tenes dudas, tu administrador puede ayudarte.')}
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}

/**
 * Fallback message notification — when WhatsApp/channel is unavailable
 */
export function fallbackMessageEmail(leadName: string, message: string): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Nuevo mensaje recibido</p>
      <p style="margin:0 0 16px;font-size:14px;color:#555;">
        Recibiste un mensaje de <strong>${leadName}</strong> que no pudo ser entregado por el canal original.
      </p>
      <div style="padding:16px;background-color:#f9fafb;border-radius:8px;border-left:3px solid ${BRAND_COLOR};">
        <p style="margin:0;font-size:15px;color:#333;line-height:1.6;">${message}</p>
      </div>
      ${actionButton('Ver en Inbox', `${DASHBOARD_URL}/admin/inbox`)}
      <p style="margin:0;font-size:12px;color:#999;text-align:center;">
        Este mensaje fue enviado como fallback porque el canal de comunicacion no estuvo disponible.
      </p>
    `);
}

/**
 * Agent assignment notification
 */
export function agentAssignmentEmail(leadName: string, stage: string): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#dbeafe;border-radius:50%;line-height:48px;font-size:22px;">&#127919;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">Nuevo lead asignado</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        <strong>${leadName}</strong> ha sido asignado a ti en etapa <strong>${stage}</strong>.
      </p>
      ${actionButton('Ver contacto', `${DASHBOARD_URL}/admin/contacts`)}
      ${tipBox('Revisa el perfil del contacto y su historial de conversaciones para dar seguimiento efectivo.')}
    `);
}
