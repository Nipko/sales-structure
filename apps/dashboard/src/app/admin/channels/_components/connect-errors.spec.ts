import * as fs from "fs";
import * as path from "path";
import { META_CONNECT_ERROR, META_CONNECT_ERROR_CODES } from "@parallext/shared";
import {
  connectCardKeys,
  connectFailureForCode,
  mapConnectFailure,
  readConnectErrorCode,
  readConnectEvidence,
  readConnectRetryable,
} from "./connect-errors";

/**
 * ═══ META'S TEXT NEVER REACHES THE SCREEN, AND EVERY FAILURE HAS ONE ACTION ═══
 *
 * In the recording the owner hit Meta's wall and the screen handed her Meta's
 * own sentence with nothing to press. Three things have to hold for that not to
 * happen again, and all three are checkable here:
 *
 *  1. Prose can never be mistaken for a code. `apiPost` puts the service's
 *     stable code in `errorCode` and the server's PROSE in `error` for the same
 *     non-2xx response, so "read the code" has to mean "read a code we know".
 *  2. Every code a channel maps has a card in all four locales, with both lines
 *     the card renders. A missing one ships the raw i18n path.
 *  3. The two windows stopped printing what the provider said. That is a
 *     property of the source files, so it is asserted against the source files.
 */

const MESSAGES_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "messages");
const LOCALES = ["es", "en", "pt", "fr"] as const;
const CHANNELS = ["instagram", "messenger"] as const;

function errorsFor(locale: string, channel: string): Record<string, any> {
  const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8");
  return JSON.parse(raw).channels[channel].errors;
}

function triageFor(locale: string, channel: string): Record<string, any> {
  const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8");
  return JSON.parse(raw).channels[channel].triage;
}

describe("reading a failed connect response", () => {
  it("takes the code from `errorCode`, where a non-2xx puts it", () => {
    expect(readConnectErrorCode({ success: false, errorCode: META_CONNECT_ERROR.NOT_PAGE_ADMIN, error: "Forbidden" }))
      .toBe(META_CONNECT_ERROR.NOT_PAGE_ADMIN);
  });

  it("takes the code from `error`, where a 200 body that failed puts it", () => {
    expect(readConnectErrorCode({ success: false, error: META_CONNECT_ERROR.PLAN_LIMIT })).toBe(META_CONNECT_ERROR.PLAN_LIMIT);
  });

  it("never mistakes the server's prose for a code", () => {
    // This is the whole point: on a non-2xx `error` holds `json.message`, which
    // for an unmapped 500 is literally "Internal server error".
    expect(readConnectErrorCode({ success: false, error: "Internal server error" })).toBeNull();
    expect(readConnectErrorCode({ success: false, error: "La ventana se cerró antes de terminar" })).toBeNull();
    expect(readConnectErrorCode({ success: false, errorCode: "something_new" })).toBeNull();
  });

  it("unwraps the object Nest hides under `message`", () => {
    expect(readConnectErrorCode({ message: { error: META_CONNECT_ERROR.WINDOW_CANCELLED, retryable: true } }))
      .toBe(META_CONNECT_ERROR.WINDOW_CANCELLED);
    expect(readConnectRetryable({ message: { error: META_CONNECT_ERROR.WINDOW_CANCELLED, retryable: false } })).toBe(false);
  });

  it("returns no verdict on retrying when the service sent none", () => {
    expect(readConnectRetryable({ success: false, errorCode: META_CONNECT_ERROR.UNAVAILABLE })).toBeNull();
  });

  it("hands the evidence back for the console and nowhere else", () => {
    expect(readConnectEvidence({ evidence: { metaMessage: "…" } })).toEqual({ metaMessage: "…" });
    expect(readConnectEvidence({ success: false })).toBeUndefined();
  });
});

describe("turning a code into a card", () => {
  it("gives every code it maps a card, and everything else the generic one", () => {
    expect(mapConnectFailure("instagram", { errorCode: META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL }).key)
      .toBe("accountNotProfessional");
    expect(mapConnectFailure("messenger", { errorCode: META_CONNECT_ERROR.NOT_PAGE_ADMIN }).key).toBe("notPageAdmin");
    expect(mapConnectFailure("instagram", { errorCode: "wat" }).key).toBe("generic");
    expect(mapConnectFailure("instagram", null).key).toBe("generic");
  });

  it("refuses to tell an Instagram owner about a Facebook page", () => {
    // Instagram connects through Instagram Business Login: there is no page in
    // that flow, so a page card there would be an instruction nobody can follow.
    // The help copy says the same thing, and this keeps the two honest together.
    expect(mapConnectFailure("instagram", { errorCode: META_CONNECT_ERROR.NO_PAGE }).key).toBe("generic");
    expect(mapConnectFailure("instagram", { errorCode: META_CONNECT_ERROR.NOT_PAGE_ADMIN }).key).toBe("generic");
    expect(mapConnectFailure("messenger", { errorCode: META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL }).key).toBe("generic");
  });

  it("offers retry where the card's text asks for one, and not where it does not", () => {
    expect(connectFailureForCode("instagram", META_CONNECT_ERROR.WINDOW_CANCELLED).retryable).toBe(true);
    expect(connectFailureForCode("messenger", "popup_blocked").retryable).toBe(true);
    // Its action says to go and look first; a retry button would contradict it.
    expect(connectFailureForCode("instagram", "timeout").retryable).toBe(false);
    expect(connectFailureForCode("instagram", "already_used").retryable).toBe(false);
    // Ours to fix, not theirs to retry.
    expect(connectFailureForCode("messenger", "config_missing").retryable).toBe(false);
  });

  it("sends a plan limit to billing instead of back into Meta's window", () => {
    expect(connectFailureForCode("instagram", META_CONNECT_ERROR.PLAN_LIMIT)).toEqual({
      key: "planLimit",
      retryable: false,
      href: "/admin/settings/billing",
      hrefLabelKey: "goToBilling",
    });
  });

  it("lets the service overrule the default verdict on retrying", () => {
    expect(mapConnectFailure("messenger", { errorCode: META_CONNECT_ERROR.UNAVAILABLE, retryable: false }).retryable).toBe(false);
    expect(mapConnectFailure("messenger", { errorCode: META_CONNECT_ERROR.PLAN_LIMIT, retryable: true }).retryable).toBe(true);
  });

  it("maps at least one code per channel out of the shared union", () => {
    // Guards the guard: an empty map would make every assertion above say
    // "generic" and pass.
    for (const channel of CHANNELS) {
      const mapped = META_CONNECT_ERROR_CODES
        .filter((code) => mapConnectFailure(channel, { errorCode: code }).key !== "generic");
      expect(mapped.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe.each(LOCALES)("connect failure copy (%s)", (locale) => {
  it.each(CHANNELS)("%s has both lines of every card it can render", (channel) => {
    const errors = errorsFor(locale, channel);
    const keys = connectCardKeys(channel);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(typeof errors[key]?.title).toBe("string");
      expect(typeof errors[key]?.action).toBe("string");
      expect(errors[key].title.trim()).not.toBe("");
      expect(errors[key].action.trim()).not.toBe("");
    }
    // The two labels the card renders outside a card key.
    expect(typeof errors.retry).toBe("string");
    expect(typeof errors.goToBilling).toBe("string");
  });

  it.each(CHANNELS)("%s asks one question with three answers and exactly three steps", (channel) => {
    const triage = triageFor(locale, channel);
    for (const key of ["question", "yes", "no", "unsure", "ready", "stepsTitle", "alwaysAvailable"]) {
      expect(typeof triage[key]).toBe("string");
      expect(triage[key].trim()).not.toBe("");
    }
    // "At most three lines" is the whole design of the hint: a fourth turns it
    // back into the wall of guidance the diagnosis blamed.
    expect(Array.isArray(triage.steps)).toBe(true);
    expect(triage.steps).toHaveLength(3);
  });

  it("never tells an Instagram owner they need a Facebook page", () => {
    const text = JSON.stringify([errorsFor(locale, "instagram"), triageFor(locale, "instagram")]);
    expect(text).not.toMatch(/página de Facebook|Facebook page|página do Facebook|page Facebook/i);
  });
});

describe("the windows that used to print what Meta said", () => {
  /**
   * Source with comments removed.
   *
   * These files name the old strings on purpose, in the comments that explain
   * why they went. Scanning the raw text would make writing that history
   * impossible, and a guard that forbids explaining itself gets deleted.
   */
  const read = (...segments: string[]) =>
    fs.readFileSync(path.join(__dirname, "..", ...segments), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("no longer renders the provider's own wording in the Instagram callback", () => {
    const source = read("instagram", "callback", "page.tsx");
    // Each of these WAS rendered to the person. `error_description` and
    // `error_reason` survive only as things read off the URL and logged.
    expect(source).not.toMatch(/Missing authorization code/);
    expect(source).not.toMatch(/possible CSRF attack/);
    expect(source).not.toMatch(/data\.error \|\| data\.message/);
    expect(source).not.toMatch(/setErrorMessage/);
    // And the result that travels to the opening screen is a code.
    expect(source).toMatch(/type: "ig_oauth_error", code:/);
  });

  it("no longer renders the service's own wording on the Messenger screen", () => {
    const source = read("messenger", "page.tsx");
    expect(source).not.toMatch(/text: result\.error/);
    expect(source).not.toMatch(/text: err\.message/);
  });

  it("no longer renders the service's own wording on the Instagram screen", () => {
    const source = read("instagram", "page.tsx");
    expect(source).not.toMatch(/text: err\.message/);
    expect(source).not.toMatch(/event\.data\.message/);
  });
});
