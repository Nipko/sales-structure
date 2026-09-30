import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(await readFile(path.join(directory, 'messages.json'), 'utf8'));
const languages = ['es', 'en', 'pt', 'fr'];

// All content and attributes are escaped, including the editable URLs.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

for (const [name, value] of Object.entries(input.links)) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(name === 'support' && url.protocol === 'mailto:')) {
    throw new Error(`Unsupported URL protocol for ${name}`);
  }
}

const paragraph = (value, extra = '') => `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#35465b;${extra}">${escapeHtml(value)}</p>`;
const heading = (value) => `<h2 style="margin:24px 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:25px;color:#172f4d;">${escapeHtml(value)}</h2>`;
const link = (label, href) => `<a href="${escapeHtml(href)}" style="color:#176eaf;text-decoration:underline;">${escapeHtml(label)}</a>`;

for (const language of languages) {
  const localized = input.locales[language];
  if (!localized || localized.banner.length > 500) throw new Error(`Missing locale or banner too long: ${language}`);
  const message = localized.email;
  for (const [key, value] of Object.entries(message)) {
    if (typeof value === 'string' && !value.trim()) throw new Error(`Empty field: ${language}.${key}`);
  }
  if (message.steps.length !== 4 || message.changes.length !== 3) throw new Error(`Unexpected content structure: ${language}`);

  const changes = `<ul style="margin:0;padding-left:22px;">${message.changes.map((item) => `<li style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#35465b;">${escapeHtml(item)}</li>`).join('')}</ul>`;
  const steps = `<ol style="margin:0;padding-left:22px;">${message.steps.map((item) => `<li style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#35465b;">${escapeHtml(item)}</li>`).join('')}</ol>`;
  const html = `<!doctype html>
<html lang="${language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(message.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;font-size:1px;line-height:1px;color:#f1f5f9;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(message.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
<tr><td style="padding:28px 24px 22px;border-bottom:1px solid #e2e8f0;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:31px;line-height:36px;font-weight:700;letter-spacing:-1px;color:#3897f0;">Parallly</div>
<p style="margin:18px 0 9px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;letter-spacing:1.2px;font-weight:700;color:#526985;">${escapeHtml(message.eyebrow)}</p>
<h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:27px;line-height:34px;font-weight:700;color:#172f4d;">${escapeHtml(message.title)}</h1>
</td></tr>
<tr><td style="padding:24px;">
${paragraph(message.greeting)}${paragraph(message.intro)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#edf6ff;border-left:4px solid #3897f0;"><tr><td style="padding:16px;">
<h2 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:25px;color:#172f4d;">${escapeHtml(message.changesTitle)}</h2>
${changes}</td></tr></table>
${heading(message.stepsTitle)}${steps}
<p style="margin:8px 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">${link(message.managerLabel, input.links.whatsappManager)}</p>
<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">${link(message.pdfGuideLabel, input.links.pdfGuide)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;width:100%;"><tr><td align="center" bgcolor="#176eaf" style="background-color:#176eaf;border-radius:8px;">
<a href="${escapeHtml(input.links.paymentMethods)}" style="display:block;padding:15px 18px;border:1px solid #176eaf;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;font-weight:700;text-decoration:none;color:#ffffff;">${escapeHtml(message.cta)}</a>
</td></tr></table>
${paragraph(message.important)}${paragraph(message.provider)}${paragraph(message.reassurance)}${paragraph(message.support)}
<p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;">${link(message.supportLabel, input.links.support)}</p>
${paragraph(message.signoff, 'font-weight:700;')}
</td></tr>
<tr><td style="padding:20px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;">
<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#596b80;">${escapeHtml(message.footer)}</p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:22px;">${link(message.helpLabel, input.links.metaHelp)}<br>${link(message.pricingLabel, input.links.metaPricing)}</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
  const text = [
    message.subject, '', message.greeting, '', message.intro, '', message.changesTitle,
    ...message.changes.map((item) => `• ${item}`), '', message.stepsTitle,
    ...message.steps.map((item, index) => `${index + 1}. ${item}`), '',
    `${message.managerLabel}: ${input.links.whatsappManager}`, '',
    `${message.pdfGuideLabel}: ${input.links.pdfGuide}`, '',
    `${message.cta}: ${input.links.paymentMethods}`, '',
    message.important, '', message.provider, '', message.reassurance, '', message.support, '',
    `${message.supportLabel}: ${input.links.support.replace(/^mailto:/, '')}`, '', message.signoff, '',
    message.footer, `${message.helpLabel}: ${input.links.metaHelp}`,
    `${message.pricingLabel}: ${input.links.metaPricing}`, '',
  ].join('\n');
  await writeFile(path.join(directory, `email-${language}.html`), html, 'utf8');
  await writeFile(path.join(directory, `email-${language}.txt`), text, 'utf8');
  const wordCount = Object.values(message).flat().join(' ').trim().split(/\s+/u).length;
  console.log(`${language}: HTML + plain text generated; banner ${localized.banner.length}/500 characters; ${wordCount} words including subject, headings, preheader and footer.`);
}
