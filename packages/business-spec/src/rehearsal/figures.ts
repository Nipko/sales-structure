/**
 * Cifras normalizadas del ensayo (C0 §1.4 paso 4, rebanada R7). Un valor del negocio y una respuesta del agente se
 * comparan por sus cifras canónicas, no por su texto: `45000`, `$45.000`, `45 mil` y `45k` son la misma cifra; `09:00`,
 * `9 am` y `9h` son la misma hora. Determinista y sin dependencias: lo usan el generador (qué cifras debe decir o
 * nunca decir el agente) y el calificador (qué cifras dijo).
 *
 * Forma canónica: número → `n:<valor>` (sin ceros de más: `n:45000`, `n:12.5`); hora → `t:H:MM` (`t:9:00`);
 * teléfono → `tel:<últimos 7 dígitos>`.
 */

/** Claves internas de un valor que no son afirmaciones al cliente (identificadores, estados, banderas). */
const SKIP_KEYS = /(^id$|_id$|^ids$|_ids$|status$|^active$|^available$|^version$|_at$|^sort|^order$|^position$)/i;

const canonNumber = (n: number): string => `n:${Number.isInteger(n) ? n : Number(n.toFixed(2))}`;
const canonTime = (h: number, m: number): string | null => (h >= 0 && h <= 24 && m >= 0 && m < 60 ? `t:${h}:${String(m).padStart(2, '0')}` : null);

/** Cifras de un valor guardado (requisito o campo de un ítem), recorriendo listas y objetos. */
export function figuresOfValue(value: unknown, key = ''): string[] {
    if (value === null || value === undefined || typeof value === 'boolean') return [];
    if (key && SKIP_KEYS.test(key)) return [];
    if (typeof value === 'number') return Number.isFinite(value) ? [canonNumber(value)] : [];
    if (typeof value === 'string') return figuresOfText(value, { isValue: true });
    if (Array.isArray(value)) return uniq(value.flatMap(v => figuresOfValue(v, key)));
    if (typeof value === 'object') return uniq(Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => figuresOfValue(v, k)));
    return [];
}

const MULTIPLIERS: Record<string, number> = { mil: 1_000, k: 1_000, millon: 1_000_000, millones: 1_000_000, million: 1_000_000, millions: 1_000_000, milhao: 1_000_000, milhoes: 1_000_000 };

/**
 * Cifras de un texto. En una respuesta del agente (`isValue=false`) se reconocen además las horas habladas
 * (`9 am`, `9 de la mañana` no: solo formatos con cifra y marca), los miles con punto, coma o espacio y los
 * multiplicadores (`45 mil`, `45k`, `1,5 millones`).
 */
export function figuresOfText(text: string, opts: { isValue?: boolean } = {}): string[] {
    let s = ` ${String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()} `;
    const out: string[] = [];
    // fechas ISO (2026-10-21, 2026-10-21T15:00:00Z): no son cifras que se comparen literalmente (lo decide el juez)
    s = s.replace(/\b\d{4}-\d{2}-\d{2}(t\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})?)?\b/g, ' ');
    // ISO 8601 de duración (PT45M, PT1H30M): minutos
    s = s.replace(/\bp(?:(\d+)d)?t(?=\d)(?:(\d+)h)?(?:(\d+)m)?\b/g, (_all, d, h, m) => {
        out.push(canonNumber(Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0)));
        return ' ';
    });
    // horas: 09:00, 9:30 pm, 21h30, 9 am, 9h
    s = s.replace(/\b(\d{1,2})(?::|h)(\d{2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?=\W)/g, (_a, h, m, ap) => {
        const t = canonTime(to24(Number(h), ap), Number(m));
        if (t) out.push(t);
        return ' ';
    });
    s = s.replace(/\b(\d{1,2})\s*(a\.?\s?m\.?|p\.?\s?m\.?|h)(?=[\s.,;:!?)])/g, (a, h, ap) => {
        const t = canonTime(to24(Number(h), ap === 'h' ? undefined : ap), 0);
        if (t) { out.push(t); return ' '; }
        return a;
    });
    // teléfonos: 7+ dígitos con separadores típicos y opcional +indicativo
    s = s.replace(/\+?\d[\d\s().-]{6,}\d/g, (all) => {
        const digits = all.replace(/\D/g, '');
        if (digits.length < 7) return all;
        // un monto con miles (45.000, 1.200.000) no es un teléfono
        if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(all.trim())) return all;
        out.push(`tel:${digits.slice(-7)}`);
        return ' ';
    });
    // números con miles y decimales, y multiplicadores
    for (const m of s.matchAll(/(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)\s*(millones|millon|millions|million|milhoes|milhao|mil|k)?\b/g)) {
        const int = Number(m[1].replace(/[.,\s]/g, ''));
        const n = m[2] ? Number(`${int}.${m[2]}`) : int;
        out.push(canonNumber(m[3] ? n * MULTIPLIERS[m[3]] : n));
        if (!opts.isValue && m[3]) out.push(canonNumber(n));
    }
    return uniq(out);
}

function to24(h: number, ampm?: string): number {
    if (!ampm) return h;
    const pm = ampm.startsWith('p');
    if (pm && h < 12) return h + 12;
    if (!pm && h === 12) return 0;
    return h;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Cifra canónica legible para el informe (`n:45000` → `45000`, `t:9:00` → `9:00`). */
export const figureLabel = (f: string): string => f.replace(/^(n|t|tel):/, (_m, k) => (k === 'tel' ? 'tel. …' : ''));

/** Una cifra de dinero en el texto (moneda o símbolo junto a un número, o un monto ≥ 1.000): COTIZA no admite ninguna. */
export function hasMoneyFigure(text: string): boolean {
    const s = String(text ?? '').toLowerCase();
    if (/(\$|€|£|r\$|\bcop\b|\busd\b|\beur\b|\bmxn\b|\bbrl\b|\bpesos?\b|\bd[oó]lares?\b|\breais\b|\beuros?\b)\s?\d|\d[\d.,]*\s?(\$|€|\bcop\b|\busd\b|\beur\b|\bmxn\b|\bpesos?\b|\bd[oó]lares?\b|\breais\b|\beuros?\b)/.test(s)) return true;
    return figuresOfText(s).some(f => f.startsWith('n:') && Number(f.slice(2)) >= 1000);
}
