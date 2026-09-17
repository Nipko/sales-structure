import * as fs from "fs";
import * as path from "path";
import { mapConnectFailure } from "./connect-failure";

/**
 * ═══ LO QUE DICE LA TARJETA TIENE QUE SER ALGO QUE LA PERSONA PUEDA HACER ═══
 *
 * La tarjeta de cobertura ya no tiene botón de reintentar (el servicio la marca
 * `retryable: false`): abrir otra ventana de Meta no cambia de qué cuenta de
 * negocio es el número nuevo. Aun así su texto seguía diciendo "vuelve a
 * intentar y autoriza TODAS las cuentas" — una instrucción sin botón y que
 * además no arregla nada. Y el código de Meta que llega ya canjeado ahora sale
 * como `WA_ES_CODE_EXPIRED`, así que "la autorización venció por tardar" dejó
 * de ser la única causa: también puede haberse usado ya.
 *
 * La tarjeta de cobertura habla ahora SOLO de otro número ya conectado. Cuando
 * lo que Meta no nos dio es el número que la persona está conectando, no hay
 * nada que desconectar: esa tarjeta pedía desconectar un número que funciona y
 * escondía el único arreglo real, que es abrir otra ventana de Meta y marcar
 * ese número. Por eso `tokenTargetNotGranted` es una tarjeta aparte, con
 * reintentar, y se le prohíbe hablar de desconectar.
 *
 * Se prueba el texto en los cuatro idiomas porque cada uno se tradujo a mano y
 * una sola traducción vieja basta para repetir el error en ese mercado.
 */
const MESSAGES_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "messages");
const CARD_SOURCE = path.join(__dirname, "WhatsAppEmbeddedSignup.tsx");

type ErrorCopy = Record<string, string>;

function errorsFor(locale: string): Record<string, ErrorCopy> {
  const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8");
  return JSON.parse(raw).channels.whatsapp.errors;
}

/**
 * The sub-keys the failure card actually reads (`te(`${failure.key}.title`)`…),
 * taken from the component itself: a key that lacks one of them renders its
 * raw i18n path to the person, and a list copied into this spec would stop
 * noticing the day the card starts reading a new one.
 */
function subKeysTheCardReads(): string[] {
  const source = fs.readFileSync(CARD_SOURCE, "utf8");
  const found = Array.from(source.matchAll(/\$\{failure\.key\}\.(\w+)`/g), (match) => match[1]);
  return Array.from(new Set(found)).sort();
}

interface LocaleExpectations {
  /** Telling the person to open Meta again or to authorize every account. */
  retry: RegExp;
  /** The number belongs to another business account. */
  otherBusiness: RegExp;
  disconnect: RegExp;
  support: RegExp;
  /** The Meta authorization may have been used already, not only expired. */
  alreadyUsed: RegExp;
  /** Finish the Meta window without closing it. */
  withoutClosing: RegExp;
  reopen: RegExp;
  /** Meta did not give us access (to the number being connected). */
  notGranted: RegExp;
  /** Pick the business account that holds that number. */
  chooseBusiness: RegExp;
}

const LOCALES: Record<string, LocaleExpectations> = {
  es: {
    retry: /vuelve a intentar|intenta de nuevo|intentarlo|autoriza todas/i,
    otherBusiness: /otra cuenta de negocio/i,
    disconnect: /desconect/i,
    support: /soporte/i,
    alreadyUsed: /ya se us/i,
    withoutClosing: /sin cerrarla/i,
    reopen: /abre de nuevo la ventana de meta|vuelve a abrir la ventana de meta/i,
    notGranted: /no nos dio acceso/i,
    chooseBusiness: /elige la cuenta de negocio/i,
  },
  en: {
    retry: /try again|authori[sz]e all/i,
    otherBusiness: /(different|another) business account/i,
    disconnect: /disconnect/i,
    support: /support/i,
    alreadyUsed: /already used/i,
    withoutClosing: /without closing/i,
    reopen: /open the meta window again/i,
    notGranted: /did(n't| not) give us access/i,
    chooseBusiness: /choose the business account/i,
  },
  pt: {
    retry: /tente de novo|tentar de novo|autorize todas/i,
    otherBusiness: /outra conta (comercial|de negócio)/i,
    disconnect: /desconect/i,
    support: /suporte/i,
    alreadyUsed: /já (foi )?usad/i,
    withoutClosing: /sem fech/i,
    reopen: /abra (de novo|novamente) a janela da meta/i,
    notGranted: /não nos deu acesso/i,
    chooseBusiness: /escolha a conta (comercial|de negócio)/i,
  },
  fr: {
    retry: /réessayez|autorisez tous/i,
    otherBusiness: /autre compte (d'entreprise|professionnel)/i,
    disconnect: /déconnect/i,
    support: /support/i,
    alreadyUsed: /déjà (été )?utilisée/i,
    withoutClosing: /sans la fermer/i,
    reopen: /rouvrez la fenêtre meta/i,
    notGranted: /ne nous a pas donné accès/i,
    chooseBusiness: /choisissez le compte (d'entreprise|professionnel)/i,
  },
};

/** Words that mean nothing to a business owner reading this card. */
const JARGON = /\bwaba\b|\btoken\b|credencial|credential|identifiant|escopo|scope|portf/i;

describe.each(Object.keys(LOCALES))("WhatsApp connect failure copy (%s)", (locale) => {
  const expected = LOCALES[locale];
  const errors = errorsFor(locale);

  it("tokenCoverage explains the other business account and offers what actually fixes it", () => {
    const { title, action } = errors.tokenCoverage;

    expect(action).not.toMatch(expected.retry);
    expect(`${title} ${action}`).toMatch(expected.otherBusiness);
    expect(action).toMatch(expected.disconnect);
    expect(action).toMatch(expected.support);
    expect(`${title} ${action}`).not.toMatch(JARGON);
  });

  it("tokenTargetNotGranted has every line the card reads", () => {
    const card = errors.tokenTargetNotGranted;
    const subKeys = subKeysTheCardReads();

    // Guard against the extraction silently finding nothing.
    expect(subKeys).toEqual(expect.arrayContaining(["action", "title"]));
    expect(card).toBeDefined();
    for (const subKey of subKeys) {
      expect(typeof card[subKey]).toBe("string");
      expect(card[subKey].trim()).not.toBe("");
    }
    // Same shape as its sibling card, so neither renders a raw i18n path.
    expect(Object.keys(card).sort()).toEqual(Object.keys(errors.tokenCoverage).sort());
  });

  it("tokenTargetNotGranted says Meta did not give access to this number and to pick it again, never to disconnect", () => {
    const { title, action } = errors.tokenTargetNotGranted;
    const text = `${title} ${action}`;

    expect(text).toMatch(expected.notGranted);
    expect(action).toMatch(expected.reopen);
    expect(action).toMatch(expected.chooseBusiness);
    expect(action).toMatch(expected.support);
    expect(text).not.toMatch(expected.disconnect);
    expect(text).not.toMatch(expected.otherBusiness);
    expect(text).not.toMatch(JARGON);
  });

  it("codeExpired covers an authorization already used, and says to finish the window without closing it", () => {
    const { title, action } = errors.codeExpired;

    expect(`${title} ${action}`).toMatch(expected.alreadyUsed);
    expect(action).toMatch(expected.reopen);
    expect(action).toMatch(expected.withoutClosing);
    expect(`${title} ${action}`).not.toMatch(JARGON);
  });
});

describe("the card behind that copy", () => {
  it("offers no retry for coverage, matching a text that no longer asks for one", () => {
    expect(mapConnectFailure(409, { code: "WHATSAPP_TOKEN_COVERAGE_REQUIRED" }).retryable).toBe(false);
  });

  it("offers a retry when Meta left out the number being connected, which is what its text asks for", () => {
    expect(mapConnectFailure(409, { code: "WHATSAPP_TOKEN_TARGET_NOT_GRANTED" })).toMatchObject({
      key: "tokenTargetNotGranted",
      retryable: true,
    });
  });

  it("offers a retry for a used or expired code, which is what its text asks for", () => {
    expect(mapConnectFailure(400, { code: "WA_ES_CODE_EXPIRED" }).retryable).toBe(true);
  });
});
