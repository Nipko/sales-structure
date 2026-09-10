#!/usr/bin/env node
/**
 * Every place in this repository that can put a message on a customer's
 * messaging channel — derived from the source, not from memory.
 *
 * From 1 October 2026 Meta charges per delivered WhatsApp service message, so
 * "how many separate remote effects does one logical answer produce" stopped
 * being a latency question and became a bill. The answer depends on which
 * producer spoke, which lane it used, and how many items it split its answer
 * into — and nobody could state that list, because it was spread over forty
 * files and two processes.
 *
 * This script is that list. It is a script rather than a document because a
 * document is trusted and a script is checked: run it again and the table
 * either still matches the code or the diff says what moved.
 *
 * ── HOW IT DECIDES ──────────────────────────────────────────────────────────
 *
 *   1. It sweeps every non-spec `.ts` file under `apps/api/src` and
 *      `apps/whatsapp/src` for CALL SITES of an egress primitive — a method
 *      that hands a message to a channel, or a queue that will. Call sites, not
 *      files, so the output carries `file:line` and a reader can go and look.
 *   2. The file that DEFINES a primitive is a road, not a producer. Transports,
 *      adapters, the gateway, the queue and the outbox itself are excluded by
 *      path, and the exclusion list is printed so it can be argued with.
 *   3. The lane comes from the primitive: `enqueueDispatch` is the durable
 *      outbox, `enqueue` is the legacy Redis queue, a bare adapter call is
 *      inline with no record at all.
 *   4. The channel set comes from the literal argument when there is one, and
 *      is otherwise `dynamic` — a producer that passes a variable can reach any
 *      connected channel, and pretending otherwise would understate exposure.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────
 *
 * Stated here rather than in a footnote, because a producer this misses is a
 * producer that spends silently:
 *
 *   · A producer that reaches a channel through a name this script does not
 *     know. New primitives must be added to EGRESS below. The
 *     `external-effect-inventory` cross-check exists for exactly this: it
 *     compares what this sweep finds against what that file claims, in both
 *     directions, and prints the disagreements.
 *   · Effects a tenant's own automation causes at a third party (an HTTP action,
 *     an MCP tool that writes). Those are effects, but not WhatsApp messages.
 *   · Anything outside these two processes: the dashboard, the mobile app and
 *     the landing site cannot send; they call this API.
 *   · Effect COUNTS marked `derived` come from reading the loop that emits them.
 *     Counts marked `1` are single-shot call sites. `unknown` means the count
 *     depends on runtime data this script will not guess.
 *
 * Usage:  node apps/api/scripts/outbound-producer-inventory.cjs [--out <path>]
 *         node apps/api/scripts/outbound-producer-inventory.cjs --check
 */

'use strict';

const fs = require('fs');
const path = require('path');

const API_SRC = path.resolve(__dirname, '..', 'src');
const WA_SRC = path.resolve(__dirname, '..', '..', 'whatsapp', 'src');
const REPO = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_OUT = path.join(REPO, 'docs', 'audits', '2026-09-10', 'outbound-producer-inventory.md');

// ---------------------------------------------------------------------------
// The doors. Each entry is one way a message can start travelling to a phone.
// ---------------------------------------------------------------------------

/**
 * `lane` is what the effect's durability answers to, and it is the single most
 * useful column: a producer on `inline` has no row, no lease and no receipt, so
 * a crash between the decision and the POST loses the effect or repeats it.
 */
const EGRESS = [
    { primitive: 'outboundQueue.enqueueDispatch(', lane: 'dispatch_outbox',
        note: 'publishes an already-committed `agent_dispatch_outbox` row' },
    { primitive: 'dispatchOutbox.prepare(', lane: 'dispatch_outbox',
        note: 'commits the batch of items one answer becomes' },
    { primitive: 'prepareDispatchBatch(', lane: 'dispatch_outbox',
        note: 'the batch primitive itself' },
    { primitive: 'enqueueApprovedEffect(', lane: 'approved_effect',
        note: '`tool_approval_effects` row a person approved' },
    { primitive: 'enqueueOperationalNotice(', lane: 'operational_notice',
        note: '`operational_notice_outbox`, written in the business transaction' },
    { primitive: 'admitHandoffEffect(', lane: 'handoff_effects',
        note: 'one row per destination of one transfer' },
    { primitive: 'outboundQueue.enqueue(', lane: 'outbound_queue',
        note: 'legacy BullMQ `send` job; Redis is the only record' },
    { primitive: 'channelGateway.sendMessage(', lane: 'inline',
        note: 'straight to the adapter, on the caller\'s stack' },
    { primitive: 'transport.sendStrict(', lane: 'dispatch_outbox',
        note: 'the one POST a committed dispatch row authorises' },
    { primitive: '.sendTextMessage(', lane: 'inline', note: 'adapter text POST' },
    { primitive: '.sendMediaMessage(', lane: 'inline', note: 'adapter media POST' },
    { primitive: '.sendTemplate(', lane: 'inline', note: 'adapter template POST' },
    { primitive: '.sendTemplateMessage(', lane: 'inline', note: 'adapter template POST' },
    { primitive: '.sendInteractiveMessage(', lane: 'inline', note: 'adapter interactive POST' },
    { primitive: '.sendFlowMessage(', lane: 'inline', note: 'adapter Flow POST' },
    { primitive: '.sendLocationMessage(', lane: 'inline', note: 'adapter location POST' },
    // Listed so it is visibly accounted for, and flagged so it never inflates
    // the spend count: Meta bills delivered messages, and a typing indicator is
    // not one. Calling it a producer would make the exposure figure wrong in the
    // direction that reads as caution and is actually noise.
    { primitive: '.sendTypingIndicator(', lane: 'inline', billable: false,
        note: 'presence, not a message: Meta does not bill a typing indicator' },
];

/**
 * Roads, not producers.
 *
 * A file that DEFINES an egress primitive matches its own pattern. Listing it
 * as a producer would be like listing the road as a driver. Every exclusion is
 * printed in the output so the reader can disagree with it.
 */
const ROADS = [
    'modules/channels/whatsapp/whatsapp.adapter.ts',
    'modules/channels/instagram/instagram.adapter.ts',
    'modules/channels/messenger/messenger.adapter.ts',
    'modules/channels/telegram/telegram.adapter.ts',
    'modules/channels/email/email.adapter.ts',
    'modules/channels/sms/sms.adapter.ts',
    'modules/channels/channel-gateway.service.ts',
    'modules/channels/outbound-queue.service.ts',
    'modules/channels/outbound-queue.processor.ts',
    'modules/channels/agent-dispatch-outbox.ts',
    'modules/channels/agent-dispatch-outbox.store.ts',
    'modules/channels/dispatch-items.ts',
    'modules/channels/external-effect-inventory.ts',
    'modules/channels/strict-dispatch.ts',
    'modules/widget/widget.adapter.ts',
    // These define an egress primitive rather than calling one, and the curated
    // inventory classifies them the same way (`EGRESS_INFRASTRUCTURE`).
    'modules/handoff/handoff-effects.ts',
    'modules/operational-notices/operational-notice-outbox.ts',
    'modules/sms-notifications/sms-sender.service.ts',
];

const CHANNEL_LITERALS = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget', 'email', 'sms'];

/** Meta bills a delivered service message on this one, from 1 October 2026. */
const BILLED = new Set(['whatsapp']);

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            walk(full, out);
        } else if (entry.name.endsWith('.ts')
            && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

function sources() {
    const files = [];
    for (const file of walk(API_SRC)) {
        files.push({ app: 'api', rel: path.relative(API_SRC, file).split(path.sep).join('/'), full: file });
    }
    for (const file of walk(WA_SRC)) {
        files.push({ app: 'whatsapp', rel: path.relative(WA_SRC, file).split(path.sep).join('/'), full: file });
    }
    return files;
}

/**
 * Which channels can this call site reach?
 *
 * A literal in the surrounding lines is evidence; a variable is not, and a
 * producer that passes a variable reaches whatever the tenant connected. That
 * is reported as `dynamic` rather than guessed, because guessing narrow is the
 * error that costs money.
 */
function channelsFor(lines, index) {
    const window = lines.slice(Math.max(0, index - 12), index + 4).join('\n');
    const found = CHANNEL_LITERALS.filter(channel =>
        new RegExp(`['"\`]${channel}['"\`]`).test(window));
    if (found.length) return found;
    if (/channelType|channel_type|inboundMsg\.|msg\.channelType|binding\.channelType/.test(window)) {
        return ['dynamic'];
    }
    return ['dynamic'];
}

/**
 * How many separate remote effects can ONE logical answer become here?
 *
 * The trap this function exists to avoid: the sink is almost never where the
 * fan-out happens. `outboundQueue.enqueue` inside `sendResponse` looks like one
 * effect; the loop that calls `sendResponse` once per bubble is four hundred
 * lines away. Counting at the sink would report `1` for the producer that
 * actually emits one charge per bubble, per link and per picture.
 *
 * So the count is taken at the FAN-OUT: the call sites of the method that
 * contains the sink. If any of them sits inside a loop, one logical answer can
 * become as many effects as that loop has iterations, and the loop's own text
 * names what it iterates.
 */
function loopKind(header) {
    if (/chunk|bubble/i.test(header)) return { count: 'n(bubbles)', why: 'one effect per text bubble' };
    if (/media|attachment|photo|image/i.test(header)) return { count: 'n(media)', why: 'one effect per attachment' };
    if (/link/i.test(header)) return { count: 'n(links)', why: 'one effect per canonical link' };
    if (/recipient|contact|member|audience/i.test(header)) {
        return { count: 'n(recipients)', why: 'one effect per recipient — a campaign, not one answer' };
    }
    // Naming the iterable rather than guessing what it holds. `for (const row of
    // rows)` is one effect per approved item in one ticket in one file and one
    // effect per due appointment in another; a label that decided between them
    // from the word `row` would be a guess dressed as a finding.
    const iterable = (header.match(/\bof\s+([\w.$]+)/) || header.match(/;\s*\w+\s*<\s*([\w.$]+)/) || [, ''])[1];
    return { count: 'n', why: iterable ? `one effect per entry of \`${iterable}\`` : 'emitted inside a loop' };
}

/** Batch primitives commit N rows in one call: the batch IS the answer. */
const BATCH_PRIMITIVES = ['dispatchOutbox.prepare(', 'prepareDispatchBatch('];

function effectsFor(lines, index, sinkMethod, primitive) {
    if (BATCH_PRIMITIVES.includes(primitive)) {
        return { count: 'n(items)', basis: 'derived',
            why: 'one committed row per item; the whole batch is one answer' };
    }
    // 1. A loop immediately around the sink itself.
    const near = lines.slice(Math.max(0, index - 14), index + 1).join('\n');
    if (/\b(for|while)\s*\(|\.map\(|\.forEach\(/.test(near)) {
        const header = (near.match(/\b(?:for|while)\s*\([^\n]*/) || [''])[0];
        const kind = loopKind(header);
        return { count: kind.count, basis: 'derived', why: `${kind.why} (loop at the send)` };
    }
    // 2. The fan-out: who calls the method that holds the sink, and from inside
    //    what. A private helper called from a loop is the usual shape.
    if (sinkMethod && sinkMethod !== '(top level)') {
        const callSite = new RegExp(`this\\.${sinkMethod}\\s*\\(`);
        for (let i = 0; i < lines.length; i++) {
            if (i === index || !callSite.test(lines[i])) continue;
            const before = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
            const header = (before.match(/\b(?:for|while)\s*\([^\n]*/) || [''])[0];
            if (header) {
                const kind = loopKind(header);
                return { count: kind.count, basis: 'derived', why: `${kind.why} (fan-out at line ${i + 1})` };
            }
        }
    }
    return { count: '1', basis: 'read', why: 'one effect per invocation; no loop reaches this send' };
}

/** What starts this producer, read from the decorators and the method around it. */
function triggerFor(lines, index) {
    for (let i = index; i >= Math.max(0, index - 120); i--) {
        const line = lines[i];
        if (/@Cron\(/.test(line)) return `cron ${(line.match(/@Cron\(([^)]*)\)/) || [, '?'])[1].trim()}`;
        if (/@OnEvent\(/.test(line)) return `event ${(line.match(/@OnEvent\(([^)]*)\)/) || [, '?'])[1].trim()}`;
        if (/@Post\(|@Get\(|@Put\(|@Patch\(|@Delete\(/.test(line)) {
            const verb = (line.match(/@(Post|Get|Put|Patch|Delete)\(/) || [, '?'])[1];
            const route = (line.match(/@\w+\(\s*['"`]([^'"`]*)['"`]/) || [, ''])[1];
            return `HTTP ${verb.toUpperCase()} ${route || '(controller root)'}`;
        }
        if (/@Process\(|WorkerHost|process\s*\(\s*job/.test(line)) return 'BullMQ job';
    }
    return 'called by another service';
}

/**
 * Which method holds this call site.
 *
 * The naive version matched `VALUES (` inside a raw SQL template literal and
 * reported the human inbox's reply as a method called `VALUES`. A method
 * declaration cannot be inside a template literal, so the backtick parity up to
 * the candidate line settles it.
 */
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor',
    'do', 'else', 'try', 'typeof', 'await', 'new', 'function']);

function methodFor(lines, index, backtickParity) {
    for (let i = index; i >= Math.max(0, index - 250); i--) {
        if (backtickParity[i]) continue; // inside a template literal: not a declaration
        const match = lines[i].match(
            /^\s{0,8}(?:public |private |protected )?(?:static )?(?:async )?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/);
        if (match && !KEYWORDS.has(match[1])) return match[1];
    }
    return '(top level)';
}

/** True for every line that begins inside an unterminated template literal. */
function templateLiteralMask(lines) {
    const mask = new Array(lines.length).fill(false);
    let open = false;
    for (let i = 0; i < lines.length; i++) {
        mask[i] = open;
        const ticks = (lines[i].match(/`/g) || []).length;
        if (ticks % 2 === 1) open = !open;
    }
    return mask;
}

function collect() {
    const rows = [];
    for (const file of sources()) {
        if (ROADS.includes(file.rel)) continue;
        const text = fs.readFileSync(file.full, 'utf8');
        const lines = text.split(/\r?\n/);
        const mask = templateLiteralMask(lines);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // A commented-out call is not a producer, and neither is a method
            // name that happens to appear inside a prose block or a SQL string.
            if (/^\s*(\*|\/\/)/.test(line) || mask[i]) continue;
            for (const door of EGRESS) {
                if (!line.includes(door.primitive)) continue;
                const method = methodFor(lines, i, mask);
                rows.push({
                    app: file.app,
                    file: file.rel,
                    line: i + 1,
                    method,
                    primitive: door.primitive.replace(/\($/, ''),
                    lane: door.lane,
                    laneNote: door.note,
                    billable: door.billable !== false,
                    trigger: triggerFor(lines, i),
                    channels: channelsFor(lines, i),
                    effects: effectsFor(lines, i, method, door.primitive),
                });
                break;
            }
        }
    }
    return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * The other half of the honesty: what the curated inventory claims, compared
 * with what this sweep finds. Parsed with a regex rather than imported, so this
 * script stays runnable without a TypeScript build.
 */
function inventoryText() {
    const file = path.join(API_SRC, 'modules', 'channels', 'external-effect-inventory.ts');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function declaredProducers() {
    const text = inventoryText();
    const out = [];
    const re = /id:\s*'([^']+)'[\s\S]{0,900}?lane:\s*'([^']+)'[\s\S]{0,200}?status:\s*'([^']+)'[\s\S]{0,400}?source:\s*'([^']+)'/g;
    let match;
    while ((match = re.exec(text))) {
        out.push({ id: match[1], lane: match[2], status: match[3], source: match[4] });
    }
    return out;
}

/** The same file's list of roads and transports — what is NOT a producer. */
function declaredInfrastructure() {
    const text = inventoryText();
    const block = text.slice(text.indexOf('EGRESS_INFRASTRUCTURE'));
    const out = [];
    const re = /\{\s*source:\s*'([^']+)',\s*kind:\s*'([^']+)'/g;
    let match;
    while ((match = re.exec(block))) out.push({ source: match[1], kind: match[2] });
    return out;
}

const LANE_ORDER = ['dispatch_outbox', 'approved_effect', 'operational_notice', 'handoff_effects',
    'outbound_queue', 'inline'];

function render(rows, declared, infrastructure) {
    const byFile = new Map();
    for (const row of rows) {
        if (!byFile.has(row.file)) byFile.set(row.file, []);
        byFile.get(row.file).push(row);
    }
    const billable = rows.filter(row => row.billable);
    const presence = rows.filter(row => !row.billable);
    const laneCounts = new Map();
    for (const row of billable) laneCounts.set(row.lane, (laneCounts.get(row.lane) || 0) + 1);

    const durableLanes = new Set(['dispatch_outbox', 'approved_effect', 'operational_notice', 'handoff_effects']);
    const bypassing = billable.filter(row => !durableLanes.has(row.lane));
    const reachesBilled = billable.filter(row =>
        row.channels.some(channel => BILLED.has(channel) || channel === 'dynamic'));
    const fanOut = billable.filter(row => row.effects.count !== '1');

    const declaredSources = new Set(declared.map(entry => entry.source));
    const infraSources = new Map(infrastructure.map(entry => [entry.source, entry.kind]));
    const sweptFiles = new Set(rows.filter(row => row.app === 'api').map(row => row.file));
    const sweptNotDeclared = [...sweptFiles]
        .filter(file => !declaredSources.has(file))
        .map(file => ({ file, kind: infraSources.get(file) || null }))
        .sort((a, b) => a.file.localeCompare(b.file));
    const declaredNotSwept = declared
        .filter(entry => !sweptFiles.has(entry.source))
        .sort((a, b) => a.id.localeCompare(b.id));

    const out = [];
    const push = (...text) => out.push(...text);

    push('<!-- GENERATED FILE — do not edit by hand.');
    push('     Regenerate with: node apps/api/scripts/outbound-producer-inventory.cjs');
    push('     Every row below is a call site the generator found in the source tree. -->');
    push('');
    push('# Inventario de productores de mensajes salientes');
    push('');
    push(`Generado desde el código por \`apps/api/scripts/outbound-producer-inventory.cjs\`.`);
    push('');
    push('Desde el 1 de octubre de 2026 Meta cobra **cada mensaje de servicio entregado**');
    push('en WhatsApp. Cada efecto remoto separado es un cargo separado: tres burbujas en');
    push('lugar de una son tres cargos por la misma respuesta. Este archivo dice cuántos');
    push('lugares del repositorio pueden producir uno, por qué carril salen y cuántos');
    push('efectos puede llegar a producir **una sola respuesta lógica** en cada uno.');
    push('');
    push('## Resumen');
    push('');
    push('| | |');
    push('|---|---|');
    push(`| Sitios de llamada encontrados | **${rows.length}** |`);
    push(`| De ellos, que producen un mensaje cobrable | **${billable.length}** |`);
    push(`| De ellos, presencia (no cobra Meta) | **${presence.length}** |`);
    push(`| Archivos productores distintos | **${byFile.size}** |`);
    push(`| Sitios que **no** pasan por un carril durable | **${bypassing.length}** |`);
    push(`| Sitios que pueden alcanzar WhatsApp (literal o dinámico) | **${reachesBilled.length}** |`);
    push(`| Sitios donde **una respuesta puede volverse varios cargos** | **${fanOut.length}** |`);
    push('');
    push('Por carril:');
    push('');
    push('| Carril | Sitios | Qué garantiza |');
    push('|---|---:|---|');
    for (const lane of LANE_ORDER) {
        const count = laneCounts.get(lane) || 0;
        if (!count) continue;
        const note = (EGRESS.find(door => door.lane === lane) || {}).note || '';
        push(`| \`${lane}\` | ${count} | ${note} |`);
    }
    push('');
    push('## Los que esquivan el carril durable');
    push('');
    push('Un productor `outbound_queue` o `inline` no tiene fila, ni lease, ni recibo');
    push('propio: un reinicio entre la decisión y el POST pierde el efecto o lo repite, y');
    push('nada le puede negar el gasto antes de emitirlo. Son los primeros que hay que');
    push('llevar a la admisión económica.');
    push('');
    push('| Archivo:línea | Método | Carril | Canales | Efectos por respuesta |');
    push('|---|---|---|---|---|');
    for (const row of bypassing) {
        push(`| \`${row.file}:${row.line}\` | \`${row.method}\` | \`${row.lane}\` | `
            + `${row.channels.join(', ')} | ${row.effects.count} (${row.effects.basis}) |`);
    }
    push('');
    push('## Donde una respuesta se vuelve varios cargos');
    push('');
    push('El sitio de envío casi nunca es donde ocurre el reparto. `enqueue` dentro de');
    push('`sendResponse` parece un efecto; el bucle que llama a `sendResponse` una vez por');
    push('burbuja está cuatrocientas líneas más arriba. Estas filas cuentan **en el');
    push('reparto**, que es donde una sola respuesta lógica se multiplica.');
    push('');
    push('| Archivo:línea | Método | Carril | Efectos por respuesta | Por qué |');
    push('|---|---|---|---|---|');
    for (const row of fanOut) {
        push(`| \`${row.file}:${row.line}\` | \`${row.method}\` | \`${row.lane}\` | `
            + `**${row.effects.count}** | ${row.effects.why} |`);
    }
    push('');
    push('## Presencia, no mensajes');
    push('');
    push('Se listan para que estén contados y para que nadie los sume al gasto: Meta cobra');
    push('mensajes entregados, y un indicador de "escribiendo" no lo es.');
    push('');
    push('| Archivo:línea | Método | Primitiva |');
    push('|---|---|---|');
    for (const row of presence) push(`| \`${row.file}:${row.line}\` | \`${row.method}\` | \`${row.primitive}\` |`);
    push('');
    push('## Inventario completo, por archivo');
    push('');
    for (const [file, fileRows] of [...byFile.entries()].sort()) {
        push(`### \`${fileRows[0].app === 'whatsapp' ? 'apps/whatsapp/src/' : 'apps/api/src/'}${file}\``);
        push('');
        push('| Línea | Método | Primitiva | Carril | Disparador | Canales | Efectos por respuesta | Base |');
        push('|---:|---|---|---|---|---|---|---|');
        for (const row of fileRows) {
            push(`| ${row.line} | \`${row.method}\` | \`${row.primitive}\` | \`${row.lane}\` | `
                + `${row.trigger} | ${row.channels.join(', ')} | ${row.effects.count} | ${row.effects.why} |`);
        }
        push('');
    }
    push('## Contraste con el inventario declarado');
    push('');
    push('`modules/channels/external-effect-inventory.ts` mantiene una lista curada de');
    push('productores de efectos externos. Esta sección la compara **en las dos');
    push('direcciones**: lo que el barrido encuentra y ella no nombra, y lo que ella');
    push('nombra y el barrido no encuentra. Un desacuerdo no es un error de ninguno de');
    push('los dos — es exactamente el sitio donde hay que ir a mirar.');
    push('');
    push(`Entradas declaradas allí: **${declared.length}**.`);
    push('');
    push('### Encontrados por el barrido y no declarados como productores');
    push('');
    if (!sweptNotDeclared.length) push('_Ninguno._');
    else {
        push('| Archivo | Clasificación en el inventario declarado |');
        push('|---|---|');
        for (const entry of sweptNotDeclared) {
            push(`| \`${entry.file}\` | ${entry.kind
                ? `declarado como \`${entry.kind}\` en \`EGRESS_INFRASTRUCTURE\` — coinciden`
                : '**sin clasificar** — alcanza una primitiva de salida y no figura ni como productor ni como camino'} |`);
        }
    }
    push('');
    push('### Declarados y no encontrados por el barrido');
    push('');
    push('Estos **no son productores de mensajes de canal**: escriben en un tercero (un');
    push('calendario, un cobro, un CRM), envían correo o SMS, o llaman a un webhook. El');
    push('barrido sólo busca las puertas de mensajería, así que su ausencia aquí es');
    push('esperada y su clasificación queda **fuera del alcance de este generador**.');
    push('');
    push('| id declarado | carril | estado | fuente |');
    push('|---|---|---|---|');
    for (const entry of declaredNotSwept) {
        push(`| \`${entry.id}\` | \`${entry.lane}\` | \`${entry.status}\` | \`${entry.source}\` |`);
    }
    push('');
    push('## Método y sus límites');
    push('');
    push('El barrido busca **sitios de llamada** de estas primitivas:');
    push('');
    push('| Primitiva | Carril |');
    push('|---|---|');
    for (const door of EGRESS) push(`| \`${door.primitive}\` | \`${door.lane}\` |`);
    push('');
    push('Se excluyen por ruta los archivos que **definen** una primitiva (el camino, no');
    push('el conductor):');
    push('');
    for (const road of ROADS) push(`- \`${road}\``);
    push('');
    push('Lo que este generador **no** puede ver, dicho aquí y no en una nota al pie,');
    push('porque un productor que se le escape es un productor que gasta en silencio:');
    push('');
    push('1. Una primitiva de salida con un nombre que no está en la tabla de arriba. El');
    push('   contraste con el inventario declarado existe justamente para eso.');
    push('2. Un efecto en un tercero que no es un mensaje de canal (HTTP de automatización,');
    push('   una tool MCP que escribe, un cobro). Son efectos, no mensajes de WhatsApp.');
    push('3. Procesos fuera de `apps/api` y `apps/whatsapp`. El dashboard, la app móvil y');
    push('   la landing no envían: llaman a esta API.');
    push('4. Un conteo de efectos marcado `unknown` o `n`: depende de datos de ejecución.');
    push('   El generador no los adivina; decir "1" ahí sería subestimar el gasto.');
    push('');
    return out.join('\n') + '\n';
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : DEFAULT_OUT;

    const rows = collect();
    const declared = declaredProducers();
    const markdown = render(rows, declared, declaredInfrastructure());

    if (check) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        if (current !== markdown) {
            process.stderr.write(`outbound-producer-inventory: ${out} is stale — regenerate it\n`);
            process.exit(1);
        }
        process.stdout.write(`outbound-producer-inventory: up to date (${rows.length} call sites)\n`);
        return;
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, markdown, 'utf8');
    process.stdout.write(`outbound-producer-inventory: ${rows.length} call sites in `
        + `${new Set(rows.map(row => row.file)).size} files → ${out}\n`);
}

if (require.main === module) main();
module.exports = { collect, declaredProducers, declaredInfrastructure, render, EGRESS, ROADS };
