/**
 * Vocabulario cerrado de `applies_when`, `criticality.when` y condiciones de override (schema §4.1).
 * Se parsea una vez al compilar; un átomo desconocido es un defecto de la especificación.
 */

export type Expr =
    | { t: 'const'; v: boolean }
    | { t: 'not'; a: Expr }
    | { t: 'and' | 'or'; a: Expr; b: Expr }
    | { t: 'atom'; name: string; args: string[] | null; op?: Op; rhs?: string | number | string[] };

type Op = '=' | '≠' | '>' | '∈';

/** Lo que un átomo puede preguntar sobre el tenant (lo resuelve `facts.ts`). */
export interface ExprEnv {
    object?: string;
    objectEnabled(o: string): boolean;
    variant(o: string): string | null;
    writeMode(o: string): 'direct_commit' | 'request_to_business' | 'none' | null;
    paymentRequired(o: string): boolean;
    availabilityKinds(o: string): string[];
    enabledObjects: string[];
    reservableObjects: ReadonlySet<string>;
    profileId: string | null;
    domains: ReadonlySet<string>;
    /** null = desconocido (el requisito aplica: falla segura). */
    modality: string[] | null;
    deliveryOffered: boolean;
    sellsGoods: boolean;
    hasPrepayment: boolean;
    hoursAlwaysOpen: boolean;
    staffCount: number;
    estimateRequired: boolean;
    booksByStaff: boolean;
    subtype: string | null;
}

/** Átomos admitidos: nombre → forma (args = toma argumentos; cmp = admite comparación). */
export const ATOMS: Readonly<Record<string, { args: 'none' | 'one' | 'list' | 'optional'; cmp?: Op[] }>> = {
    always: { args: 'none' },
    object_enabled: { args: 'one' },
    any_object_with_write: { args: 'none' },
    any_object_reservable: { args: 'none' },
    any_reservable_direct: { args: 'none' },
    profile_in: { args: 'list' },
    domain: { args: 'one' },
    domain_any: { args: 'list' },
    modality_includes: { args: 'one' },
    delivery_offered: { args: 'none' },
    sells_goods: { args: 'none' },
    has_prepayment: { args: 'none' },
    hours_always_open: { args: 'none' },
    staff_count: { args: 'none', cmp: ['>', '='] },
    estimate_required: { args: 'none' },
    books_by_staff: { args: 'none' },
    subtype: { args: 'none', cmp: ['='] },
    variant: { args: 'optional', cmp: ['=', '∈', '≠'] },
    writes: { args: 'one' },
    direct_commit: { args: 'one' },
    direct_commit_any: { args: 'list' },
    payment_required_any: { args: 'none' },
    availability_kinds: { args: 'one', cmp: ['≠', '='] },
};

const TOKEN = /\s*(≠|!=|>=|∈|[()[\],=>]|[A-Za-z_<][\w<>.\-/]*|\d+)/y;

function tokenize(src: string): string[] {
    const out: string[] = [];
    TOKEN.lastIndex = 0;
    let pos = 0;
    while (pos < src.length) {
        if (/^\s*$/.test(src.slice(pos))) break;
        TOKEN.lastIndex = pos;
        const m = TOKEN.exec(src);
        if (!m) throw new Error(`símbolo inesperado en «${src}» (posición ${pos})`);
        out.push(m[1] === '!=' ? '≠' : m[1]);
        pos = TOKEN.lastIndex;
    }
    return out;
}

export function parseExpr(src: string): Expr {
    const s = String(src ?? '').trim();
    if (!s) throw new Error('expresión vacía');
    const tokens = tokenize(s);
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    const expect = (t: string) => { if (next() !== t) throw new Error(`se esperaba «${t}» en «${s}»`); };

    const list = (): string[] => {
        expect('[');
        const items: string[] = [];
        while (peek() !== ']') {
            if (peek() === undefined) throw new Error(`lista sin cerrar en «${s}»`);
            items.push(next());
            if (peek() === ',') next();
        }
        expect(']');
        return items;
    };
    const primary = (): Expr => {
        const tok = peek();
        if (tok === '(') { next(); const e = or(); expect(')'); return e; }
        if (tok === 'not') { next(); return { t: 'not', a: primary() }; }
        if (tok === 'true' || tok === 'false') { next(); return { t: 'const', v: tok === 'true' }; }
        if (!tok || !/^[A-Za-z_]/.test(tok)) throw new Error(`se esperaba un átomo en «${s}»`);
        const name = next();
        let args: string[] | null = null;
        if (peek() === '(') {
            next();
            args = peek() === '[' ? list() : [];
            while (peek() !== ')') {
                if (peek() === undefined) throw new Error(`paréntesis sin cerrar en «${s}»`);
                const a = next();
                if (a !== ',') args.push(a);
            }
            expect(')');
        }
        const atom: Expr = { t: 'atom', name, args };
        const op = peek();
        if (op === '=' || op === '≠' || op === '>' || op === '∈') {
            next();
            atom.op = op as Op;
            const rhs = peek();
            if (rhs === '[') atom.rhs = list();
            else if (rhs !== undefined && /^\d+$/.test(rhs)) atom.rhs = Number(next());
            else if (rhs !== undefined) atom.rhs = next();
            else throw new Error(`comparación sin valor en «${s}»`);
        }
        return atom;
    };
    const and = (): Expr => {
        let e = primary();
        while (peek() === 'and') { next(); e = { t: 'and', a: e, b: primary() }; }
        return e;
    };
    function or(): Expr {
        let e = and();
        while (peek() === 'or') { next(); e = { t: 'or', a: e, b: and() }; }
        return e;
    }
    const e = or();
    if (i !== tokens.length) throw new Error(`sobra «${tokens.slice(i).join(' ')}» en «${s}»`);
    return e;
}

/** Errores de vocabulario: átomo desconocido, aridad o comparación no admitida, objeto/dominio inexistente. */
export function validateExpr(e: Expr, known: { objects: ReadonlySet<string>; domains: ReadonlySet<string>; profiles: ReadonlySet<string> }): string[] {
    const errors: string[] = [];
    const walk = (x: Expr): void => {
        if (x.t === 'const') return;
        if (x.t === 'not') return walk(x.a);
        if (x.t !== 'atom') { walk(x.a); walk(x.b); return; }
        const def = ATOMS[x.name];
        if (!def) { errors.push(`átomo desconocido «${x.name}»`); return; }
        if (def.args === 'none' && x.args !== null) errors.push(`«${x.name}» no admite argumentos`);
        if ((def.args === 'one' || def.args === 'list') && (x.args === null || x.args.length === 0)) errors.push(`«${x.name}» exige argumentos`);
        if (def.args === 'one' && x.args && x.args.length !== 1) errors.push(`«${x.name}» admite un solo argumento`);
        if (x.op && !(def.cmp ?? []).includes(x.op)) errors.push(`«${x.name}» no admite «${x.op}»`);
        if (!x.op && def.cmp && x.name !== 'variant' && x.name !== 'availability_kinds') errors.push(`«${x.name}» exige comparación`);
        const objectArgs = ['object_enabled', 'writes', 'direct_commit', 'direct_commit_any', 'availability_kinds', 'variant'];
        if (objectArgs.includes(x.name)) for (const a of x.args ?? []) if (!known.objects.has(a)) errors.push(`objeto desconocido «${a}» en «${x.name}»`);
        if (x.name === 'domain' || x.name === 'domain_any') for (const a of x.args ?? []) if (!known.domains.has(a)) errors.push(`dominio desconocido «${a}»`);
        if (x.name === 'profile_in') for (const a of x.args ?? []) if (!known.profiles.has(a)) errors.push(`perfil desconocido «${a}»`);
        if (x.name === 'variant' && !x.args && !x.op) errors.push('«variant» exige comparación');
    };
    walk(e);
    return errors;
}

const cmp = (left: unknown, op: Op | undefined, rhs: unknown): boolean => {
    if (!op) return Boolean(left);
    if (op === '∈') return Array.isArray(rhs) && rhs.includes(left as string);
    if (op === '>') return Number(left) > Number(rhs);
    const eq = Array.isArray(rhs) && Array.isArray(left)
        ? left.length === rhs.length && left.every((v, k) => v === rhs[k])
        : left === rhs;
    return op === '=' ? eq : !eq;
};

export function evalExpr(e: Expr, env: ExprEnv): boolean {
    switch (e.t) {
        case 'const': return e.v;
        case 'not': return !evalExpr(e.a, env);
        case 'and': return evalExpr(e.a, env) && evalExpr(e.b, env);
        case 'or': return evalExpr(e.a, env) || evalExpr(e.b, env);
        default: break;
    }
    const a = e.args ?? [];
    const writes = (o: string) => { const m = env.writeMode(o); return m !== null && m !== 'none'; };
    switch (e.name) {
        case 'always': return true;
        case 'object_enabled': return env.objectEnabled(a[0]);
        case 'any_object_with_write': return env.enabledObjects.some(writes);
        case 'any_object_reservable': return env.enabledObjects.some(o => env.reservableObjects.has(o));
        case 'any_reservable_direct': return env.enabledObjects.some(o => env.reservableObjects.has(o) && env.writeMode(o) === 'direct_commit');
        case 'profile_in': return env.profileId !== null && a.includes(env.profileId);
        case 'domain': return env.domains.has(a[0]);
        case 'domain_any': return a.some(d => env.domains.has(d));
        case 'modality_includes': return env.modality === null ? true : env.modality.includes(a[0]);
        case 'delivery_offered': return env.deliveryOffered;
        case 'sells_goods': return env.sellsGoods;
        case 'has_prepayment': return env.hasPrepayment;
        case 'hours_always_open': return env.hoursAlwaysOpen;
        case 'staff_count': return cmp(env.staffCount, e.op, e.rhs);
        case 'estimate_required': return env.estimateRequired;
        case 'books_by_staff': return env.booksByStaff;
        case 'subtype': return cmp(env.subtype, e.op, e.rhs);
        case 'variant': {
            const o = a[0] ?? env.object;
            return o ? cmp(env.variant(o), e.op, e.rhs) : false;
        }
        case 'writes': return writes(a[0]);
        case 'direct_commit': return env.writeMode(a[0]) === 'direct_commit';
        case 'direct_commit_any': return a.some(o => env.writeMode(o) === 'direct_commit');
        case 'payment_required_any': return env.enabledObjects.some(o => writes(o) && env.paymentRequired(o));
        case 'availability_kinds': return cmp(env.availabilityKinds(a[0]), e.op ?? '≠', e.rhs ?? []);
        default: throw new Error(`átomo desconocido «${e.name}»`);
    }
}

export function exprToString(e: Expr): string {
    switch (e.t) {
        case 'const': return String(e.v);
        case 'not': return `not ${exprToString(e.a)}`;
        case 'and': case 'or': return `(${exprToString(e.a)} ${e.t} ${exprToString(e.b)})`;
        default: {
            const args = e.args === null ? '' : `(${e.args.join(', ')})`;
            const rhs = e.rhs === undefined ? '' : ` ${e.op} ${Array.isArray(e.rhs) ? `[${e.rhs.join(', ')}]` : e.rhs}`;
            return `${e.name}${args}${rhs}`;
        }
    }
}
