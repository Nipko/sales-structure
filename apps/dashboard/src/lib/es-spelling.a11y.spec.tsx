import * as fs from "fs";
import * as path from "path";
// Runs in the jsdom project because intl-messageformat is ESM-only and that
// project is the one that compiles it.
import { IntlMessageFormat } from "intl-messageformat";

/**
 * Review of 2026-10-08: the Spanish panel shipped words without their accent
 * ("Mios", "dias", "Ultima", "Analitica") and counted "1 clientes".
 *
 * This is not a spell checker. It pins the words the review found, anywhere in
 * the Spanish catalogue, so they do not come back through a copy-paste.
 */
const MESSAGES_DIR = path.join(__dirname, "..", "..", "messages");
const es = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, "es.json"), "utf8"));

function strings(node: unknown, trail: string[] = []): { key: string; value: string }[] {
  if (typeof node === "string") return [{ key: trail.join("."), value: node }];
  if (Array.isArray(node)) return node.flatMap((child, i) => strings(child, [...trail, String(i)]));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => strings(v, [...trail, k]));
  }
  return [];
}

const ALL = strings(es);

const MISSING_ACCENT: [RegExp, string][] = [
  [/\bMios\b/, "Míos"],
  [/\bdias\b/i, "días"],
  [/\bUltima\b/, "Última"],
  [/\bAnalitica\b/, "Analítica"],
  [/\bMetricas\b/, "Métricas"],
  [/\bNotas rapidas\b/, "Notas rápidas"],
  [/\bCopiar telefono\b/, "Copiar teléfono"],
  [/\bcomunicacion\b/, "comunicación"],
  [/\bsincronizacion\b/i, "sincronización"],
  [/\bresolucion\b/i, "resolución"],
  [/\bintegracion\b/i, "integración"],
  [/\bempatico\b/, "empático"],
  [/\bvia (Meta|Graph|Twilio|integración)\b/, "vía"],
];

describe("Spanish catalogue spelling", () => {
  it.each(MISSING_ACCENT)("has no %s", (pattern, fix) => {
    const hits = ALL.filter(({ value }) => pattern.test(value)).map(({ key, value }) => `${key}: ${value} (-> ${fix})`);
    expect(hits).toEqual([]);
  });

  it("writes the week-day count with the accent", () => {
    expect(es.agent.scheduleDaysPerWeek).toContain("días");
  });
});

describe("counts agree with their noun", () => {
  const format = (message: string, values: Record<string, number>) =>
    new IntlMessageFormat(message, "es").format(values) as string;

  it("pluralises the schedule, the deals and the users header", () => {
    expect(format(es.agent.scheduleDaysPerWeek, { count: 0 })).toBe("0 días/semana");
    expect(format(es.agent.scheduleDaysPerWeek, { count: 1 })).toBe("1 día/semana");
    expect(format(es.pipeline.dealsCount, { count: 1 })).toBe("1 negocio");
    expect(format(es.pipeline.dealsCount, { count: 3 })).toBe("3 negocios");
    expect(format(es.users.subtitleStats, { total: 1, active: 1, agents: 1 })).toBe("1 usuario · 1 activo · 1 agente");
    expect(format(es.users.subtitleStats, { total: 4, active: 2, agents: 0 })).toBe("4 usuarios · 2 activos · 0 agentes");
  });
});
