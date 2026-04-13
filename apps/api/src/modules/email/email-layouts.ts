/**
 * Parallly — Professional Email Layouts
 * Based on respond.io design language: clean, white, centered, with logo header
 */

const LOGO_URL = 'https://parallext.com/logo.png';
const BRAND_COLOR = '#6c5ce7';
const SITE_URL = 'https://parallext.com';
const SUPPORT_URL = 'https://parallext.com/support';

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
                &copy; ${new Date().getFullYear()} <a href="${SITE_URL}" style="color:#999;text-decoration:underline;">parallext.com</a>
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
  <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111;">Mantente seguro</p>
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
  <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:${BRAND_COLOR};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
    ${text}
  </a>
</div>`;
}

// ── Pre-built email templates ──────────────────────────────

export function verificationEmail(firstName: string, code: string): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Hola ${firstName},</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        Usa este codigo (OTP) para completar tu inicio de sesion en <a href="${SITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;font-weight:600;">Parallly</a>:
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">Valido por 10 minutos. No compartas este codigo con nadie.</p>
      <p style="margin:0;font-size:13px;color:#555;">Si no fuiste tu, <a href="${SITE_URL}/login" style="color:${BRAND_COLOR};">restablece tu contrasena</a>.</p>
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
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Hola ${firstName},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#555;">
        Bienvenido a <strong>Parallly</strong>. Tu cuenta para <strong>${companyName}</strong> ha sido creada exitosamente.
      </p>
      <p style="margin:0 0 4px;font-size:14px;color:#555;">Ya puedes:</p>
      <ul style="margin:8px 0 0;padding:0 0 0 20px;font-size:14px;color:#555;line-height:1.8;">
        <li>Conectar tus canales (WhatsApp, Instagram, Messenger)</li>
        <li>Configurar tu agente de IA</li>
        <li>Gestionar contactos y pipeline de ventas</li>
      </ul>
      ${actionButton('Ir al Dashboard', 'https://admin.parallly-chat.cloud/admin')}
      <p style="margin:0;font-size:13px;color:#999;text-align:center;">Si necesitas ayuda, estamos para ti.</p>
    `);
}

export function passwordChangedEmail(firstName: string): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">Hola ${firstName},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#555;">
        Tu contrasena en <a href="${SITE_URL}" style="color:${BRAND_COLOR};text-decoration:none;font-weight:600;">Parallly</a> ha sido cambiada exitosamente.
      </p>
      <p style="margin:0 0 4px;font-size:13px;color:#555;">Si no realizaste este cambio, contacta a soporte inmediatamente.</p>
      ${securityTips()}
    `,
    `<p style="margin:0;font-size:12px;color:#999;">Necesitas ayuda? <a href="${SUPPORT_URL}" style="color:${BRAND_COLOR};text-decoration:none;">Contacta a soporte</a></p>`
    );
}
