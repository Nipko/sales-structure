/**
 * Parallly — Professional Email Layouts
 * Based on respond.io design language: clean, white, centered, with logo header
 *
 * i18n: admin/tenant-user facing strings are resolved via emsg(lang, key, vars)
 * from ./email-i18n. Every exported email-builder takes an optional `lang`
 * (default "es") so existing callers keep the current Spanish behavior.
 * Structure, colors, URLs and emoji entities are NOT translated.
 */

import { emsg } from './email-i18n';

const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://parallly-chat.cloud/parallly-logo.svg';
const BRAND_COLOR = '#3897f0';
const BRAND_DARK = '#2b7cd4';
const SITE_URL = 'https://parallly-chat.cloud';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
const SUPPORT_URL = 'mailto:it.executive@parallext.com';

/** Standard "Need help? Contact support" footer line, translated. */
function supportFooter(lang: string): string {
    return `<p style="margin:0;font-size:12px;color:#999;">${emsg(lang, 'footer.needHelp', { supportUrl: SUPPORT_URL, brandColor: BRAND_COLOR })}</p>`;
}

/**
 * Wraps content in the standard Parallly email layout
 */
export function emailLayout(content: string, footerExtra?: string, lang: string = 'es'): string {
    const langCode = (lang || 'es').substring(0, 2).toLowerCase();
    return `<!DOCTYPE html>
<html lang="${langCode}">
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
                &copy; ${new Date().getFullYear()} <a href="${SITE_URL}" style="color:#999;text-decoration:underline;">Parallly</a> &mdash; ${emsg(lang, 'footer.tagline')}
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
export function securityTips(lang: string = 'es'): string {
    return `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #eee;">
  <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111;">${emsg(lang, 'security.header')}</p>
  <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#555;line-height:1.8;">
    <li>${emsg(lang, 'security.tip1')}</li>
    <li>${emsg(lang, 'security.tip2')}</li>
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
 * Branded fiscal-invoice email — our own email announcing the DIAN invoice with
 * the branded PDF attached (replaces the payment provider's default email).
 */
export function fiscalInvoiceEmail(opts: {
    recipientName?: string | null;
    invoiceNumber: string;
    total: string;
    issuerName: string;
    cufe?: string | null;
    isCredit?: boolean;
    hasXml?: boolean;
    lang?: string;
}): string {
    const docLabel = opts.isCredit ? 'nota crédito electrónica' : 'factura electrónica de venta';
    const greetingName = opts.recipientName ? ` ${opts.recipientName}` : '';
    const content = `
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111;">Tu ${docLabel}</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
        Hola${greetingName}, adjuntamos tu ${docLabel} <strong>N.º ${opts.invoiceNumber}</strong> emitida por <strong>${opts.issuerName}</strong> y validada por la DIAN.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e8e8e8;border-radius:8px;">
        <tr>
          <td style="padding:14px 18px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#777;">Número</td>
          <td style="padding:14px 18px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111;text-align:right;font-weight:600;">${opts.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding:14px 18px;font-size:13px;color:#777;">Total</td>
          <td style="padding:14px 18px;font-size:15px;color:${BRAND_DARK};text-align:right;font-weight:700;">${opts.total}</td>
        </tr>
      </table>
      ${opts.cufe ? `<p style="margin:0 0 8px;font-size:11px;color:#999;word-break:break-all;"><strong>CUFE:</strong> ${opts.cufe}</p>` : ''}
      <p style="margin:16px 0 0;font-size:13px;color:#555;line-height:1.6;">
        Adjuntamos ${opts.hasXml ? 'el <strong>PDF</strong> y el <strong>XML firmado</strong> (documento legal ante la DIAN)' : 'el <strong>PDF</strong>'}. Puedes verificar la validez escaneando el código QR del PDF en el portal de la DIAN.
      </p>`;
    return emailLayout(content, undefined, opts.lang || 'es');
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

export function verificationEmail(firstName: string, code: string, lang: string = 'es'): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">${emsg(lang, 'verification.greeting', { name: firstName })}</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        ${emsg(lang, 'verification.body', { siteUrl: SITE_URL, brandColor: BRAND_COLOR })}
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">${emsg(lang, 'verification.validity')}</p>
      <p style="margin:0;font-size:13px;color:#555;">${emsg(lang, 'verification.ifNotYou', { loginUrl: `${DASHBOARD_URL}/login`, brandColor: BRAND_COLOR })}</p>
      ${securityTips(lang)}
    `,
    supportFooter(lang),
    lang,
    );
}

export function passwordResetEmail(firstName: string, code: string, lang: string = 'es'): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">${emsg(lang, 'verification.greeting', { name: firstName })}</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        ${emsg(lang, 'passwordReset.body', { siteUrl: SITE_URL, brandColor: BRAND_COLOR })}
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">${emsg(lang, 'passwordReset.validity')}</p>
      ${tipBox(emsg(lang, 'passwordReset.tip'))}
      ${securityTips(lang)}
    `,
    supportFooter(lang),
    lang,
    );
}

export function twoFactorEmail(firstName: string, code: string, lang: string = 'es'): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">${emsg(lang, 'verification.greeting', { name: firstName })}</p>
      <p style="margin:0 0 0;font-size:15px;color:#555;">
        ${emsg(lang, 'twoFactor.body', { siteUrl: SITE_URL, brandColor: BRAND_COLOR })}
      </p>
      ${otpBlock(code)}
      <p style="margin:0 0 4px;font-size:13px;color:#555;">${emsg(lang, 'twoFactor.validity')}</p>
      ${securityTips(lang)}
    `,
    supportFooter(lang),
    lang,
    );
}

export function welcomeEmail(firstName: string, companyName: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:20px;">
        <p style="margin:0;font-size:28px;">&#127881;</p>
      </div>
      <h1 style="margin:0 0 8px;font-size:22px;color:#111;text-align:center;">${emsg(lang, 'welcome.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'welcome.subtitle', { companyName })}
      </p>
      ${featureHighlights([
          { icon: '&#128172;', title: emsg(lang, 'welcome.feat1.title'), desc: emsg(lang, 'welcome.feat1.desc') },
          { icon: '&#129302;', title: emsg(lang, 'welcome.feat2.title'), desc: emsg(lang, 'welcome.feat2.desc') },
          { icon: '&#128202;', title: emsg(lang, 'welcome.feat3.title'), desc: emsg(lang, 'welcome.feat3.desc') },
          { icon: '&#128197;', title: emsg(lang, 'welcome.feat4.title'), desc: emsg(lang, 'welcome.feat4.desc') },
      ])}
      ${actionButton(emsg(lang, 'welcome.cta'), `${DASHBOARD_URL}/admin`)}
      ${tipBox(emsg(lang, 'welcome.tip'))}
      <p style="margin:16px 0 0;font-size:13px;color:#999;text-align:center;">${emsg(lang, 'welcome.closing')}</p>
    `,
    supportFooter(lang),
    lang,
    );
}

export function passwordChangedEmail(firstName: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#dcfce7;border-radius:50%;line-height:48px;font-size:22px;">&#9989;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'passwordChanged.title')}</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'passwordChanged.body', { name: firstName, siteUrl: SITE_URL, brandColor: BRAND_COLOR })}
      </p>
      <div style="margin:20px 0;padding:16px;background-color:#fef3c7;border-radius:8px;border-left:3px solid #f59e0b;">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
          ${emsg(lang, 'passwordChanged.warning', { resetUrl: `${DASHBOARD_URL}/forgot-password`, brandColor: BRAND_COLOR })}
        </p>
      </div>
      ${securityTips(lang)}
    `,
    supportFooter(lang),
    lang,
    );
}

export function newTrustedDeviceEmail(firstName: string, deviceName: string, ipAddress: string, dateStr: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#dbeafe;border-radius:50%;line-height:48px;font-size:22px;">&#128274;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'trustedDevice.title')}</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'trustedDevice.body', { name: firstName, siteUrl: SITE_URL, brandColor: BRAND_COLOR })}
      </p>
      <div style="margin:16px 0;padding:16px;background-color:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">${emsg(lang, 'trustedDevice.labelDevice')}</td><td style="padding:4px 0;font-size:13px;color:#1e293b;text-align:right;font-weight:600;">${deviceName}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">${emsg(lang, 'trustedDevice.labelIp')}</td><td style="padding:4px 0;font-size:13px;color:#1e293b;text-align:right;">${ipAddress}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">${emsg(lang, 'trustedDevice.labelDate')}</td><td style="padding:4px 0;font-size:13px;color:#1e293b;text-align:right;">${dateStr}</td></tr>
        </table>
      </div>
      <p style="margin:16px 0 0;font-size:13px;color:#555;text-align:center;">
        ${emsg(lang, 'trustedDevice.note')}
      </p>
      <div style="margin:20px 0;padding:16px;background-color:#fef3c7;border-radius:8px;border-left:3px solid #f59e0b;">
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
          ${emsg(lang, 'trustedDevice.warning', { securityUrl: `${DASHBOARD_URL}/admin/settings/security`, brandColor: BRAND_COLOR })}
        </p>
      </div>
    `,
    supportFooter(lang),
    lang,
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
}, lang: string = 'es'): string {
    const intro = input.inviterName
        ? emsg(lang, 'invitation.introNamed', { inviter: input.inviterName, tenant: input.tenantName, role: input.roleLabel })
        : emsg(lang, 'invitation.introAnon', { tenant: input.tenantName, role: input.roleLabel });

    const tenantLogoBlock = input.tenantLogoUrl
        ? `<div style="text-align:center;margin:0 0 18px;">
             <img src="${input.tenantLogoUrl}" alt="${input.tenantName}" height="48" style="height:48px;border-radius:8px;" />
           </div>`
        : '';

    return emailLayout(`
        ${tenantLogoBlock}
        <h1 style="margin:0 0 12px;font-size:22px;color:#111;text-align:center;">${emsg(lang, 'invitation.title')}</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6;text-align:center;">${intro}</p>
        ${actionButton(emsg(lang, 'invitation.cta'), input.acceptUrl)}
        ${featureHighlights([
            { icon: '&#128236;', title: emsg(lang, 'invitation.feat1.title'), desc: emsg(lang, 'invitation.feat1.desc') },
            { icon: '&#129302;', title: emsg(lang, 'invitation.feat2.title'), desc: emsg(lang, 'invitation.feat2.desc') },
            { icon: '&#128200;', title: emsg(lang, 'invitation.feat3.title'), desc: emsg(lang, 'invitation.feat3.desc') },
        ])}
        <p style="margin:18px 0 0;font-size:13px;color:#777;text-align:center;">
            ${emsg(lang, 'invitation.expires', { expires: input.expiresText })}
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:#999;text-align:center;">
            ${emsg(lang, 'invitation.ignore')}
        </p>
    `, undefined, lang);
}

/**
 * Welcome email for invited team members — sent after accepting an invitation.
 */
export function welcomeTeamMemberEmail(firstName: string, tenantName: string, roleLabel: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:20px;">
        <p style="margin:0;font-size:28px;">&#127881;</p>
      </div>
      <h1 style="margin:0 0 8px;font-size:22px;color:#111;text-align:center;">${emsg(lang, 'teamWelcome.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'teamWelcome.subtitle', { name: firstName, tenant: tenantName, role: roleLabel })}
      </p>
      ${featureHighlights([
          { icon: '&#128236;', title: emsg(lang, 'teamWelcome.feat1.title'), desc: emsg(lang, 'teamWelcome.feat1.desc') },
          { icon: '&#128172;', title: emsg(lang, 'teamWelcome.feat2.title'), desc: emsg(lang, 'teamWelcome.feat2.desc') },
          { icon: '&#129302;', title: emsg(lang, 'teamWelcome.feat3.title'), desc: emsg(lang, 'teamWelcome.feat3.desc') },
          { icon: '&#128202;', title: emsg(lang, 'teamWelcome.feat4.title'), desc: emsg(lang, 'teamWelcome.feat4.desc') },
      ])}
      ${actionButton(emsg(lang, 'teamWelcome.cta'), `${DASHBOARD_URL}/admin`)}
      ${tipBox(emsg(lang, 'teamWelcome.tip'))}
    `,
    supportFooter(lang),
    lang,
    );
}

/**
 * Fallback message notification — when WhatsApp/channel is unavailable
 */
export function fallbackMessageEmail(leadName: string, message: string, lang: string = 'es'): string {
    return emailLayout(`
      <p style="margin:0 0 4px;font-size:15px;color:#333;">${emsg(lang, 'fallback.heading')}</p>
      <p style="margin:0 0 16px;font-size:14px;color:#555;">
        ${emsg(lang, 'fallback.body', { leadName })}
      </p>
      <div style="padding:16px;background-color:#f9fafb;border-radius:8px;border-left:3px solid ${BRAND_COLOR};">
        <p style="margin:0;font-size:15px;color:#333;line-height:1.6;">${message}</p>
      </div>
      ${actionButton(emsg(lang, 'fallback.cta'), `${DASHBOARD_URL}/admin/inbox`)}
      <p style="margin:0;font-size:12px;color:#999;text-align:center;">
        ${emsg(lang, 'fallback.note')}
      </p>
    `, undefined, lang);
}

/**
 * Agent assignment notification
 */
export function agentAssignmentEmail(leadName: string, stage: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#dbeafe;border-radius:50%;line-height:48px;font-size:22px;">&#127919;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'assignment.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'assignment.body', { leadName, stage })}
      </p>
      ${actionButton(emsg(lang, 'assignment.cta'), `${DASHBOARD_URL}/admin/contacts`)}
      ${tipBox(emsg(lang, 'assignment.tip'))}
    `, undefined, lang);
}

// ── Billing lifecycle emails ──────────────────────────────────

export function trialEndingSoonEmail(firstName: string, daysLeft: number, planName: string, lang: string = 'es'): string {
    const daysWord = emsg(lang, daysLeft !== 1 ? 'common.days' : 'common.day');
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#fef3c7;border-radius:50%;line-height:48px;font-size:22px;">&#9200;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'trial.endingTitle')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'trial.endingBody', { name: firstName, planName, days: String(daysLeft), daysWord })}
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'trial.endingDetail')}
      </p>
      ${actionButton(emsg(lang, 'trial.endingCta'), `${DASHBOARD_URL}/admin/settings/billing`)}
      ${tipBox(emsg(lang, 'trial.endingTip'))}
    `, undefined, lang);
}

export function trialEndedEmail(firstName: string, planName: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#fee2e2;border-radius:50%;line-height:48px;font-size:22px;">&#128680;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'trialEnded.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'trialEnded.body', { name: firstName, planName })}
      </p>
      <p style="margin:0 0 12px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'trialEnded.graceIntro')}
      </p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#666;">
        <li style="margin-bottom:6px;">${emsg(lang, 'trialEnded.grace1')}</li>
        <li style="margin-bottom:6px;">${emsg(lang, 'trialEnded.grace2')}</li>
        <li>${emsg(lang, 'trialEnded.grace3')}</li>
      </ul>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'trialEnded.dataSafe')}
      </p>
      ${actionButton(emsg(lang, 'trialEnded.cta'), `${DASHBOARD_URL}/admin/settings/billing`)}
    `, undefined, lang);
}

export function paymentFailedEmail(firstName: string, planName: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#fee2e2;border-radius:50%;line-height:48px;font-size:22px;">&#128179;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'paymentFailed.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'paymentFailed.body', { name: firstName, planName })}
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'paymentFailed.detail')}
      </p>
      ${actionButton(emsg(lang, 'paymentFailed.cta'), `${DASHBOARD_URL}/admin/settings/billing`)}
      ${tipBox(emsg(lang, 'paymentFailed.tip'))}
    `, undefined, lang);
}

export function softLockEmail(firstName: string, daysRemaining: number, lang: string = 'es'): string {
    const daysWord = emsg(lang, daysRemaining !== 1 ? 'common.days' : 'common.day');
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#fef3c7;border-radius:50%;line-height:48px;font-size:22px;">&#128274;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'softLock.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'softLock.body', { name: firstName })}
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'softLock.detail', { days: String(daysRemaining), daysWord })}
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'softLock.restore')}
      </p>
      ${actionButton(emsg(lang, 'softLock.cta'), `${DASHBOARD_URL}/admin/settings/billing`)}
    `, undefined, lang);
}

export function accountSuspendedEmail(firstName: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#fee2e2;border-radius:50%;line-height:48px;font-size:22px;">&#128683;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'suspended.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'suspended.body', { name: firstName })}
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'suspended.detail')}
      </p>
      ${actionButton(emsg(lang, 'suspended.cta'), `${DASHBOARD_URL}/admin/settings/billing`)}
      ${tipBox(emsg(lang, 'suspended.tip'))}
    `, undefined, lang);
}

export function paymentSucceededEmail(firstName: string, planName: string, amountFormatted: string, lang: string = 'es'): string {
    return emailLayout(`
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:48px;height:48px;background-color:#dcfce7;border-radius:50%;line-height:48px;font-size:22px;">&#9989;</div>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;color:#111;text-align:center;">${emsg(lang, 'paymentOk.title')}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#555;text-align:center;">
        ${emsg(lang, 'paymentOk.body', { name: firstName, amount: amountFormatted, planName })}
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#666;text-align:center;">
        ${emsg(lang, 'paymentOk.detail')}
      </p>
      ${actionButton(emsg(lang, 'paymentOk.cta'), `${DASHBOARD_URL}/admin`)}
    `, undefined, lang);
}
