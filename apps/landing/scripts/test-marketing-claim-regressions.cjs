const path = require("node:path");
const { spawnSync } = require("node:child_process");

const validator = path.join(__dirname, "validate-marketing-claims.cjs");
const probes = [
  "18 verticals with pre-configured services and automated support tickets",
  "Tu agente nunca inventa precios y garantiza que dos clientes jamás reserven el mismo horario. Ahorrá 17% anual.",
  "Two-way sync with Google Calendar. You only pay extra if you exceed AI limits.",
  "Automatically reply to comments and DMs on Instagram.",
  // Meta bills the tenant's own WhatsApp account and revises its rates
  // quarterly: both halves of this sentence must be rejected.
  "Parallly pays Meta for you, so each WhatsApp reply costs you US$0.0008.",
];

for (const probe of probes) {
  const result = spawnSync(process.execPath, [validator], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      MARKETING_CLAIM_PROBE: probe,
    },
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error(`Claim-freeze regression failed: the validator accepted: ${probe}`);
    process.exit(1);
  }

  if (!/frozen marketing claim/.test(result.stderr)) {
    console.error("Claim-freeze regression failed for an unexpected reason:\n" + result.stderr);
    process.exit(1);
  }
}

console.log(`Claim-freeze regression passed: ${probes.length} forbidden fixtures were rejected.`);

// ─── The hidden-fees answer must not narrow again ───────────────────────────
//
// The copy below is what /precios actually shipped with: one external charge
// named precisely — the service messages — and the catch-all that used to cover
// everything else deleted in the same edit. It mentions Meta, it mentions
// WhatsApp Business, it carries the date and the thousand, so the original
// disclosure check passed it while the page stayed silent about the marketing,
// utility and authentication templates Meta bills to the same account.
//
// Fed to the rules directly rather than through the messages files, because the
// point is to keep an answer that no longer exists in the repo permanently
// rejectable. If someone narrows the copy back, the fixtures here are what it
// will look like, and this exits non-zero before the page is built.
const { metaChargeDisclosureFailures } = require("./meta-charge-disclosure.cjs");

const narrowedDisclosures = [
  {
    locale: "es",
    label: "es (pre-fix, service messages only)",
    faqA3: "De nuestra parte no: los límites de IA no generan cobros automáticos; al alcanzarlos se pausa esa automatización y te mostramos opciones de ampliación. Aparte del plan sí hay un cobro que no es nuestro: desde el 1 de octubre de 2026, Meta le cobra a tu propia cuenta de WhatsApp Business los mensajes de servicio que entrega, con el medio de pago que cargues en Meta.",
    faqA9: "No: son dos pagos distintos. El plan paga el software de Parallly. Desde el 1 de octubre de 2026, Meta le cobra a tu propia cuenta de WhatsApp Business cada mensaje de servicio entregado, con el medio de pago que cargues en las herramientas de Meta; ese dinero no pasa por Parallly. Cada número recibe 1.000 mensajes de servicio gratis por mes calendario, y la tarifa a partir de ahí la publica Meta según el país de quien recibe. Si esa cuenta se queda sin medio de pago válido, WhatsApp deja de entregar los mensajes de servicio.",
    allowanceText: "1.000",
    datePattern: /\b1\s+de\s+octubre\s+de\s+2026\b/i,
  },
  {
    locale: "en",
    label: "en (pre-fix, service messages only)",
    faqA3: "Not from us: AI limits do not trigger automatic overage charges; once reached, that automation pauses and upgrade options are shown. There is one charge outside the plan that is not ours: from 1 October 2026, Meta bills your own WhatsApp Business account for the service messages it delivers, with the payment method you add on Meta.",
    faqA9: "No: they are two separate payments. The plan pays for Parallly's software. From 1 October 2026, Meta bills your own WhatsApp Business account for every delivered service message, with the payment method you add in Meta's tools; that money never passes through Parallly. Each number gets 1,000 free service messages per calendar month, and the rate beyond that is published by Meta according to the recipient's country.",
    allowanceText: "1,000",
    datePattern: /\b1\s+October\s+2026\b/i,
  },
  {
    locale: "pt",
    label: "pt (pre-fix, service messages only)",
    faqA3: "Da nossa parte não: os limites de IA não geram cobrança excedente automática. Fora do plano há uma cobrança que não é nossa: a partir de 1º de outubro de 2026, a Meta cobra da sua própria conta do WhatsApp Business as mensagens de serviço que ela entrega, com a forma de pagamento que você cadastrar na Meta.",
    faqA9: "Não: são dois pagamentos separados. A partir de 1º de outubro de 2026, a Meta cobra da sua própria conta do WhatsApp Business cada mensagem de serviço entregue. Cada número recebe 1.000 mensagens de serviço grátis por mês civil, e a tarifa a partir daí é publicada pela Meta conforme o país de quem recebe.",
    allowanceText: "1.000",
    datePattern: /\b1º?\s+de\s+outubro\s+de\s+2026\b/i,
  },
  {
    locale: "fr",
    label: "fr (pre-fix, service messages only)",
    faqA3: "Pas de notre côté : les limites IA ne déclenchent pas de frais de dépassement automatiques. Il existe en revanche une facturation hors forfait qui n'est pas la nôtre : à partir du 1er octobre 2026, Meta facture à votre propre compte WhatsApp Business les messages de service qu'elle livre, avec le moyen de paiement que vous enregistrez chez Meta.",
    faqA9: "Non : ce sont deux paiements distincts. À partir du 1er octobre 2026, Meta facture à votre propre compte WhatsApp Business chaque message de service livré. Chaque numéro reçoit 1 000 messages de service gratuits par mois civil, et le tarif au-delà est publié par Meta selon le pays du destinataire.",
    allowanceText: "1 000",
    datePattern: /\b1(?:er)?\s+octobre\s+2026\b/i,
  },
];

for (const fixture of narrowedDisclosures) {
  const problems = metaChargeDisclosureFailures(fixture);
  if (problems.length === 0) {
    console.error(
      `Disclosure regression failed: the narrowed answer was accepted for ${fixture.label}`,
    );
    process.exit(1);
  }
  // Rejected for the right reason: a missing date or a missing thousand would
  // also fail, and would prove nothing about how wide the answer is.
  const aboutScope = problems.some((problem) => /template|catch-all|categor/i.test(problem));
  if (!aboutScope) {
    console.error(
      `Disclosure regression failed for ${fixture.label}: rejected, but not for naming `
      + `only part of what Meta bills:\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }
}

console.log(
  `Disclosure regression passed: ${narrowedDisclosures.length} service-messages-only answers were rejected.`,
);
