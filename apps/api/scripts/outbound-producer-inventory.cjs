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
// READING THE TREE WITHOUT EDITING IT
// ---------------------------------------------------------------------------
//
// The one test that can tell this census from a grep has to answer "what would
// this sweep say if the gate on the live send path were gone?" - and the only
// honest way to ask is to run the real sweep over a tree where it IS gone.
//
// It used to do that by writing the mutated processor over the real file and
// restoring it in a `finally`. A `finally` does not run for SIGKILL, for a
// killed worker, or for a machine that loses power, and what survives is
// `apps/api/src/modules/channels/outbound-queue.processor.ts` calling a method
// that does not exist - in the file that dispatches every AI reply, in a repo
// where a parallel session's `git add -A` is a known incident.
//
// So the mutation happens HERE, in memory, and the tree is never written. Every
// read in this script goes through `readSource`/`hasSource`; an overlay entry
// replaces a file's contents for the duration of one call, and an entry for a
// path that does not exist adds a file the sweep will walk. Nothing to restore,
// so nothing to fail to restore.
const SOURCE_OVERLAY = new Map();

const overlayKey = full => path.resolve(full);

function readSource(full) {
    const hit = SOURCE_OVERLAY.get(overlayKey(full));
    return hit ? hit.text : fs.readFileSync(full, 'utf8');
}

function hasSource(full) {
    return SOURCE_OVERLAY.has(overlayKey(full)) || fs.existsSync(full);
}

/**
 * Run `work` with these sources overridden in memory.
 *
 * `entries` is `{ app, rel, text }[]`: `app` is `api` or `whatsapp`, `rel` the
 * path under that app's `src`. A `rel` that exists is replaced; one that does
 * not is added to the walk. Nested calls are refused, and the overlay is
 * cleared on the way out even if `work` throws - an in-memory Map, so an
 * abrupt death takes the overlay with it instead of leaving it on disk.
 */
function withSourceOverlay(entries, work) {
    if (SOURCE_OVERLAY.size) throw new Error('source overlay is already active');
    for (const entry of entries) {
        const root = entry.app === 'whatsapp' ? WA_SRC : API_SRC;
        const full = path.join(root, entry.rel.split('/').join(path.sep));
        SOURCE_OVERLAY.set(overlayKey(full), {
            text: entry.text, app: entry.app || 'api', rel: entry.rel, full,
            added: !fs.existsSync(full),
        });
    }
    // The sink memo is keyed by path and says nothing about which TEXT it read.
    // Left standing across an overlay it answers a question about the real tree
    // with a verdict computed from the mutated one, and vice versa on the way
    // out - the same "a memo that outlives the facts it memoised" failure the
    // census already fixed once, arriving through a different door.
    GATED_FILES.clear();
    try {
        return work();
    } finally {
        SOURCE_OVERLAY.clear();
        GATED_FILES.clear();
    }
}

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
    // ── THE ENTRANCE THE SWEEP COULD NOT SEE ────────────────────────────────
    //
    // `proactive-dispatch.service.ts` is declared a ROAD, and the contract of
    // that list is that the question MOVES one level up to whoever chose to use
    // it — it is never dropped. It was dropped: no primitive here matched
    // `proactive.send(`, so none of its call sites was classified at all, and
    // fourteen producers migrated onto this lane inside one programme without
    // appearing in the census, the bypass count or the ungated-egress sweep.
    // A probe file added for the reproduction came back 0/0/0.
    //
    // Both spellings, because the receiver is named after the service in some
    // files and after the lane in others, and a sweep that knows only one of
    // them is a sweep with a blind spot shaped like a naming convention.
    { primitive: 'proactive.send(', lane: 'dispatch_outbox',
        note: 'the proactive entrance to the durable lane' },
    { primitive: 'proactiveDispatch.send(', lane: 'dispatch_outbox',
        note: 'the proactive entrance to the durable lane' },
    { primitive: 'dispatch.send(', lane: 'dispatch_outbox',
        note: 'the proactive entrance to the durable lane' },
    { primitive: 'enqueueApprovedEffect(', lane: 'approved_effect',
        note: '`tool_approval_effects` row a person approved' },
    { primitive: 'enqueueOperationalNotice(', lane: 'operational_notice',
        note: '`operational_notice_outbox`, written in the business transaction' },
    // Flagged so the gate census does not demand a money gate on it: its nine
    // destinations are the assignment, the cache, the inbox socket, a CRM note,
    // tenant webhooks, push, Slack, agent SMS and agent email. Not one of them
    // is a message to the customer, and the two that ARE messages (SMS, email)
    // are counted at their own sinks. Demanding a WhatsApp gate here would put
    // a permanent false violation into a check whose whole value is that it is
    // empty.
    { primitive: 'admitHandoffEffect(', lane: 'handoff_effects', customerMessage: false,
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
    'modules/channels/proactive-dispatch.service.ts',
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

// ---------------------------------------------------------------------------
// THE ECONOMIC BOUNDARY
//
// From 1 October 2026 every delivered WhatsApp service message is a charge on
// the tenant's own WABA. The derived objective is therefore not "fewer
// bypasses" but ZERO chargeable WhatsApp producers outside the economic lane —
// and a number that has to stay at zero needs a check that fails, not a
// document that ages.
//
// The check below is structural rather than nominal. It holds no list of
// approved method names: it finds, in the source, every place a message can
// actually leave this process, resolves which sink each producer terminates at,
// and asks whether THAT FILE contains a gate call. Write a new producer and it
// is classified on its first run. Delete the gate from a sink and every
// producer behind it becomes a violation in the same run — which is a property
// of `sinkVerdict`, exercised by removing a real gate from a real sink in
// `outbound-gate-census.spec.ts`, not a promise made in a comment.
// ---------------------------------------------------------------------------

/**
 * A call that asks the money authority for permission.
 *
 * Matched against code with comments and template literals stripped, so a
 * mention in prose proves nothing — which is the point. A hand-maintained table
 * of "these are gated" is a claim; this reads the call.
 */
const GATE_CALLS = [
    'this.admitSpend(', 'this.gateOrSuppress(', 'this.admitAgentSend(',
    'this.admitFlowFallback(', 'spendGate.admit(',
];

/**
 * ═══ PRESENCE IS NOT DOMINANCE, AND ONE ADMISSION IS NOT TWO ═══
 *
 * `isGatedFile` answers "does this file contain a gate call anywhere?", and
 * that was the whole test. Two things pass it that must not:
 *
 *   · a gate in a DIFFERENT method from the POST. The file contains both, the
 *     send path touches neither, and the census is green.
 *   · a SECOND POST behind one admission. One reservation, two messages on a
 *     customer's phone, two charges, and a row that can only settle once — the
 *     exact defect the Flow fallback turned out to be.
 *
 * So each egress is matched against the admissions that PRECEDE it and are not
 * already spoken for. Walk the file once, in line order: a gate call adds one
 * credit, a provider egress spends one, and an egress that finds no credit is a
 * violation with a name.
 *
 * ── WHY LINE ORDER IS ENOUGH, AND WHERE IT IS NOT ───────────────────────────
 *
 * It is a dominance approximation, not a control-flow graph. It is right for
 * the shape every sink in this tree actually has — authorise, check, then POST,
 * in one method, reading downward — and it is deliberately UNKIND in the two
 * directions that matter: a gate below its POST does not count, and a loop that
 * sends twice behind one admission is reported. Both of those are real defects
 * wearing the shape of a false positive; a caller that genuinely sends N
 * messages under one authorisation is asking for one reservation to settle N
 * charges, which the ledger cannot do.
 *
 * A file that legitimately defines a road rather than using one is declared in
 * `PROVIDER_ROADS` and its entrances are classified one level up, as before.
 */
/**
 * Does the `{` at the end of this text open a FUNCTION body, or a block?
 *
 * The distinction is the whole point of the walk below, so it is made from the
 * signature rather than from indentation: `} catch (error: any) {` and
 * `if (ok) {` also carry a parenthesised list, and reading either as a function
 * would put the method's own credits out of reach of its own POST.
 */
/**
 * Where a control keyword may sit, for both classifiers below.
 *
 * Anchored to the start of the text OR to a `;`, so one statement may
 * precede it, and tolerating a single `if (...)` guard, so
 * `if (ready) for (const x of xs) {` is the loop it plainly is. Both
 * tolerances are bounded -- `[^{;]*` cannot cross into a block or past the
 * next statement -- which is what keeps this a lexical test and not a parser.
 *
 * Verified across 90,062 brace-opening sites in `apps/api/src` and
 * `apps/whatsapp/src`: 16 verdicts change against the start-anchored version
 * and every one is a correction -- 9 control-flow lines that were being read
 * as function frames, 7 loops that were invisible. No row of the published
 * census moves.
 */
const CONTROL_HEAD_PREFIX = '(?:^|;)\\s*(?:\\}\\s*)?(?:else\\s+)?(?:if\\s*\\([^{;]*\\)\\s*)?';
const CONTROL_HEAD = new RegExp(CONTROL_HEAD_PREFIX + '(?:if|for|while|switch|catch)\\b');
const CONTROL_HEAD_LOOP = new RegExp(CONTROL_HEAD_PREFIX + '(?:for|while)\\b');

function opensFunction(before) {
    const text = before.trim();
    if (/=>\s*$/.test(text)) return true;
    if (/^(?:\}\s*)?(?:else|try|finally|do)\b/.test(text)) return false;
    // A control-flow keyword whose parentheses this brace closes never opens
    // a function body, whatever its condition contains.
    //
    // Two versions were wrong here before this one. The first forbade a
    // nested `(` inside the keyword's parentheses, so `if (this.isReady(id)) {`
    // -- a condition that calls something, which is most of them -- became a
    // FUNCTION frame, putting a method's own credits out of reach of its own
    // POST and reporting a properly gated send. The second required the
    // keyword to be the FIRST token on the line, so
    // `const n = xs.length; if (this.isReady(id)) {` was a function frame
    // again. A check whose failures are wrong is one people re-baseline.
    //
    // Deliberately NOT solved by counting parentheses backwards from the
    // `)`. `codeOnly` strips comments, template literals and quoted strings
    // and nothing else -- there is no regex-literal stripper, because the
    // division-vs-regex ambiguity makes one its own project -- so a regex
    // holding an unbalanced paren sends that walk to the wrong `(`. Measured:
    // paren-counting disagrees with this on 24 sites across both trees, and
    // five of those are REGRESSIONS, two in production files.
    // A line that CONTINUES a condition is not a signature.
    //
    // A multi-line `if (a` / `    && b) {` puts the second half on its own
    // line, where no keyword is in sight, and the signature fallback below
    // then reads `&& b) {` as a function frame -- putting a method's credits
    // out of reach of its own POST and failing a properly gated send. No
    // parameter list begins with `&&` or `||`, so this costs nothing.
    //
    // The mirror case is NOT solved and is not claimed to be: a multi-line
    // `for (const x of` header leaves `opensLoop` blind on the continuation
    // line, so a fan-out written that way is under-reported. Detecting it
    // needs state this walk does not keep, and inventing a claim about it is
    // the defect this file has already had twice.
    if (/^(?:&&|[|][|])/.test(text)) return false;
    if (CONTROL_HEAD.test(text) && /\)\s*$/.test(text)) return false;
    return /\)\s*(?::\s*[^;{]+)?\s*$/.test(text);
}

/**
 * Does the `{` at the end of this text open a LOOP body?
 *
 * Asked separately from `opensFunction` because the two answers are
 * independent: a loop is not a function frame — a gate inside one still pays
 * for a POST nested under it — but crossing OUT of one to find the credit means
 * the admission was taken once and the POST runs many times.
 *
 * `do` is here and not in the keyword list below it because a `do` block has no
 * parenthesised head; its `while` is at the other end.
 */
function opensLoop(before) {
    const text = before.trim();
    // An arrow body is a function frame, and the walk stops there anyway. A
    // callback passed to `.forEach(` is not a loop for this purpose: its own
    // frame already blocks an outer credit, which is the same verdict by a
    // different road.
    if (/=>\s*$/.test(text)) return false;
    if (/(?:^|;)\s*(?:\}\s*)?do\b/.test(text)) return true;
    // The same head the function test reads, so the two answers cannot drift
    // apart -- and it sees a loop that is not the first token on its line.
    // `if (this.redis) for (const c of conversations) {` is a loop, and a
    // strictly start-anchored test calls it a block: an UNDER-report, which
    // is the direction that costs money rather than an afternoon. That exact
    // shape is in `compliance.service.ts` today.
    return CONTROL_HEAD_LOOP.test(text) && /\)\s*$/.test(text);
}

function egressCoverage(code, egressLines) {
    const lines = code.split(/\r?\n/);
    const egressAt = new Map();
    for (const line of egressLines) egressAt.set(line, (egressAt.get(line) || 0) + 1);

    // ── THE BOUNDARY IS THE FUNCTION, NOT THE BRACE ─────────────────────────
    //
    // A gate mints its credit into the nearest enclosing FUNCTION frame, not
    // into whatever `if` or `try` it happens to sit in. `admitSpend` is called
    // inside a `try` and its answer is used after the `catch` — the ordinary
    // shape of "authorise, handle the outage, then send" — and a credit that
    // died with the `try` would report that send as unauthorised.
    //
    // An egress spends from the innermost frame outward and STOPS at the first
    // function frame. So a gate in the method body pays for a POST nested under
    // it, a gate in a different method never pays at all, and a gate before a
    // callback does not pay for a POST inside that callback — which is the
    // "one admission, N messages" defect, reported rather than excused.
    // ── AND ONE ADMISSION DOES NOT COVER A LOOP ─────────────────────────────
    //
    // The paragraph above this function has always claimed that "a loop that
    // sends twice behind one admission is reported". It was not: the walk knew
    // about function frames and nothing else, so a POST inside a `for` whose
    // gate sat outside it spent that one credit and passed. That is precisely
    // one reservation settling N charges, which the ledger cannot do — the
    // defect the claim names, invisible to the check that names it.
    //
    // A loop frame is not a function frame. A gate INSIDE the loop still pays
    // for a POST nested under it, because that gate runs once per iteration.
    // What is reported is crossing OUT of a loop to find the credit.
    const frames = [{ isFunction: true, isLoop: false, credits: 0 }];
    const mint = () => {
        for (let depth = frames.length - 1; depth >= 0; depth--) {
            // A function frame OR a loop frame. The loop half matters as much:
            // a gate in a loop body runs once per iteration, so its credit
            // belongs to that iteration and dies when the frame pops. Minting
            // it into the enclosing method instead would make an honest
            // gate-then-send inside a loop read as one admission crossed out of
            // a loop, which is the opposite verdict.
            if (!frames[depth].isFunction && !frames[depth].isLoop) continue;
            frames[depth].credits += 1; return;
        }
    };
    /** `true` covered, `'repeats'` covered by a credit minted outside a loop, `false` uncovered. */
    const spend = () => {
        let leftALoop = false;
        for (let depth = frames.length - 1; depth >= 0; depth--) {
            if (frames[depth].credits > 0) {
                frames[depth].credits -= 1;
                return leftALoop ? 'repeats' : true;
            }
            if (frames[depth].isFunction) return false;
            // Recorded on the way OUT, after this frame's own credits were
            // offered: a gate in the loop body pays, a gate above the loop
            // does not.
            if (frames[depth].isLoop) leftALoop = true;
        }
        return false;
    };

    const uncovered = [];
    /** line -> why it is uncovered. Same verdict, different instruction. */
    const reasons = new Map();
    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (GATE_CALLS.some(call => text.includes(call))) mint();
        for (let n = egressAt.get(i + 1) || 0; n > 0; n--) {
            // `'repeats'` is a violation exactly like `false`, and deliberately:
            // the ledger cannot settle one reservation against N charges, so a
            // POST that runs many times behind one admission is not a weaker
            // version of the same problem, it IS the problem.
            //
            // But it is a DIFFERENT problem to fix, and the reason is kept for
            // that. "Add a gate" is the wrong instruction for a loop that
            // already has one, and a violation message that misnames the defect
            // sends the next person to the wrong place — which this file's own
            // suite treats as a defect in its own right, one sink over.
            const verdict = spend();
            if (verdict !== true) {
                uncovered.push(i + 1);
                reasons.set(i + 1, verdict === 'repeats' ? 'repeats' : 'ungated');
            }
        }
        // Applied after the line's own events, so `if (ok) { return post(x); }`
        // on one line still reads as gate-then-egress.
        for (let column = 0; column < text.length; column++) {
            if (text[column] === '{') {
                const before = text.slice(0, column);
                frames.push({
                    isFunction: opensFunction(before),
                    isLoop: opensLoop(before),
                    credits: 0,
                });
            } else if (text[column] === '}' && frames.length > 1) frames.pop();
        }
    }
    return { uncovered, reasons };
}

/**
 * The uncovered lines alone.
 *
 * `egressCredits` is the older, narrower question and stays the exported one,
 * because the suite asks it eleven times and an array is what those cases are
 * about. `egressCoverage` is for the caller that has to TELL somebody.
 */
function egressCredits(code, egressLines) {
    return egressCoverage(code, egressLines).uncovered;
}

/**
 * The network calls that carry a message to a provider.
 *
 * `sendStrict` and `sendMessage` are here because the adapter behind them is
 * unreachable except through one of the two: an adapter is a road, and a road
 * cannot be gated — only its entrances can.
 */
const PROVIDER_EGRESS = [
    { pattern: /\/messages`/, what: 'Graph `/{phone_number_id}/messages` POST' },
    { pattern: /channelGateway\.sendMessage\(/, what: '`ChannelGatewayService.sendMessage`' },
    { pattern: /transport\.sendStrict\(/, what: 'strict dispatch transport' },
];

/**
 * Files that DEFINE a road to a provider rather than choosing to use one.
 *
 * Each entry carries the reason, and for the roads that carry WhatsApp the
 * reason is that their entrances are checked one level up — by the producer
 * classification, which resolves every call site of those entrances to the file
 * it lives in and asks the same question there. Listing a road here is not an
 * exemption; it moves the question, it does not drop it.
 */
const PROVIDER_ROADS = {
    'modules/channels/whatsapp/whatsapp.adapter.ts':
        'the adapter; reachable only through `ChannelGatewayService.sendMessage` or the strict transport, and every call site of both is classified above',
    'modules/channels/instagram/instagram.adapter.ts':
        'Instagram is not billed per message by its provider',
    'modules/channels/messenger/messenger.adapter.ts':
        'Messenger is not billed per message by its provider',
    'modules/channels/channel-gateway.service.ts':
        'the road itself; its callers are classified above',
    'modules/channels/strict-dispatch.ts':
        'the transport; its caller is the gated dispatch lane',
    'modules/channels/strict-dispatch-transport.ts':
        'the transport; its caller is the gated dispatch lane',
};

/**
 * Two strippings, because the two questions need different things kept.
 *
 * `withoutComments` removes prose and nothing else. A provider URL LIVES in a
 * template literal — `${base}/${id}/messages` — so a sweep for egress that also
 * stripped template literals would find nothing and report a clean tree. That
 * exact mistake was in the first draft of this file, and it went green against a
 * probe file that posts straight to Meta.
 *
 * `codeOnly` removes prose AND template literals, which is what the gate
 * question needs: a mention of `admitSpend` inside a comment or inside a string
 * is not a call, and must never be read as one.
 */
/**
 * ── WHY EVERY STRIPPER KEEPS ITS NEWLINES ───────────────────────────────────
 *
 * Both of these used to collapse what they removed onto one line. A block
 * comment of forty lines became a space, and every line number after it in the
 * file was reported forty lines too low. This file's whole output is
 * `file:line` — the audit document, the `--check` violation message, the
 * dominance test — so the collapsing made every published coordinate in the
 * inventory wrong, silently and consistently.
 *
 * Worse than wrong numbers: the two strippers disagreed by DIFFERENT amounts.
 * Gate lines came from `codeOnly` (template literals collapsed too), egress
 * lines from `withoutComments` (template literals kept). One multi-line SQL
 * literal between them — and this tree is full of them — and the dominance walk
 * was comparing two different coordinate systems. A gate that runs AFTER its
 * POST could land before it in the merged ordering and be read as authorising
 * it. Every replacement below therefore puts back exactly the newlines it took
 * out, so `withoutComments`, `codeOnly` and the raw file all agree on what
 * line 990 is.
 */
const blankKeepingLines = (replacement) => (match) =>
    replacement + '\n'.repeat((match.match(/\n/g) || []).length);

function withoutComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, blankKeepingLines(' '))
        .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

function codeOnly(text) {
    return withoutComments(text)
        .replace(/`(?:[^`\\]|\\.)*`/g, blankKeepingLines('``'))
        // Quoted strings too, and for the same reason the docblock already
        // gives for comments: `'this.admitSpend('` inside a log line is not a
        // call. It also keeps the brace walk below honest, since a brace inside
        // a string would open a scope that never closes.
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

const GATED_FILES = new Map();

/**
 * ═══ A SINK IS GATED ONLY WHILE ITS GATE STILL COVERS ITS EGRESS ═══
 *
 * The old question was "does this file contain a gate call anywhere?", and a
 * producer terminating at that file was declared inside the economic boundary
 * on that answer alone. `outbound-queue.processor.ts` holds eight gate calls
 * and four provider egresses across several methods, so it answered yes with
 * room to spare — and went on answering yes with the gate on the live send path
 * deleted. Every AI reply on every tenant would have gone to Meta unauthorised,
 * unreserved and uncounted, and this census would have reported zero producers
 * outside the boundary in the same run. It was reproduced exactly that way
 * before this was written.
 *
 * So presence is not the question any more. A sink is gated when it asks the
 * money authority AND no provider egress inside it is left uncovered by the
 * scope-bounded walk above. Delete a gate from a sink and its egress goes
 * uncovered, the sink stops being gated, and every producer behind it is
 * reported in the same run — which is what the header of this file has claimed
 * all along.
 */
function sinkVerdict(rel) {
    if (GATED_FILES.has(rel)) return GATED_FILES.get(rel);
    const full = path.join(API_SRC, rel);
    let verdict = { hasGate: false, uncovered: [], fullyGated: false };
    if (hasSource(full)) {
        const text = readSource(full);
        const code = codeOnly(text);
        const hasGate = GATE_CALLS.some(call => code.includes(call));
        // Same coordinates for both questions: `withoutComments` keeps the URL
        // inside its template literal, and both strippers keep the line count.
        const scan = withoutComments(text).split(/\r?\n/);
        const egressLines = [];
        for (let i = 0; i < scan.length; i++) {
            if (PROVIDER_EGRESS.some(door => door.pattern.test(scan[i]))) egressLines.push(i + 1);
        }
        // A declared road defines a way out rather than choosing one; its
        // entrances are gated one level up, so an uncovered egress inside it is
        // not this file's answer to give.
        const uncovered = PROVIDER_ROADS[rel] ? [] : egressCredits(code, egressLines);
        verdict = { hasGate, uncovered, fullyGated: hasGate && uncovered.length === 0 };
    }
    GATED_FILES.set(rel, verdict);
    return verdict;
}

/** Kept as the narrow question, for the places that only need presence. */
function isGatedFile(rel) { return sinkVerdict(rel).hasGate; }

/** `export class Foo` to the file that declares it. Built once, from the source. */
function classIndex() {
    const index = new Map();
    for (const file of sources()) {
        if (file.app !== 'api') continue;
        const text = readSource(file.full);
        for (const match of text.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) {
            index.set(match[1], file.rel);
        }
    }
    return index;
}

/**
 * Where does this call site's message actually leave the process?
 *
 * For a queued lane the answer is the processor, because that is where the job
 * runs. For an inline call it is wherever the receiver is declared, which the
 * script resolves by reading the field's declared type in the calling file and
 * looking that class up in the index. No list of receiver names, so a service
 * written tomorrow is classified the first time the check runs.
 */
const LANE_TERMINUS = {
    dispatch_outbox: 'modules/channels/outbound-queue.processor.ts',
    approved_effect: 'modules/channels/outbound-queue.processor.ts',
    operational_notice: 'modules/channels/outbound-queue.processor.ts',
    outbound_queue: 'modules/channels/outbound-queue.processor.ts',
};

function terminusFor(row, lines, index, classes) {
    if (LANE_TERMINUS[row.lane]) return { file: LANE_TERMINUS[row.lane], how: 'lane `' + row.lane + '`' };
    const line = lines[index] || '';
    const receiver = (line.match(/this\.([A-Za-z_$][\w$]*)\s*\.\s*send/) || [, null])[1];
    if (!receiver) {
        // `this.send…(` — the sink is a method of this very file.
        if (/this\.\s*send/.test(line)) return { file: row.file, how: 'same file' };
        return { file: null, how: 'unresolved' };
    }
    const text = readSource(path.join(API_SRC, row.file));
    const declared = text.match(new RegExp(
        '(?:private|public|protected)\\s+(?:readonly\\s+)?' + receiver + '[?]?\\s*:\\s*([A-Za-z_$][\\w$]*)'));
    if (!declared) return { file: null, how: 'receiver `' + receiver + '` has no declared type' };
    const file = classes.get(declared[1]);
    return file
        ? { file, how: '`this.' + receiver + ': ' + declared[1] + '`' }
        : { file: null, how: 'class `' + declared[1] + '` is not declared in the swept tree' };
}

/**
 * The whole point of the file, in one function.
 *
 * Returns every chargeable WhatsApp producer that does NOT terminate at a gated
 * sink, plus every provider egress the gate does not cover. `--check` fails on
 * a non-empty result, so the next ungated producer fails CI on the commit that
 * introduces it rather than on the invoice that reveals it.
 */
function gateCensus(rows) {
    // Per-run, not per-process. The CLI calls this once, but a test calls it
    // several times against a source tree it is mutating between calls — and a
    // cache that survived those calls answered the second question with the
    // first answer, reporting a gated file as ungated. A memo that outlives
    // the facts it memoised is worse than no memo.
    GATED_FILES.clear();
    const classes = classIndex();
    const fileLines = new Map();
    const linesOf = rel => {
        if (!fileLines.has(rel)) {
            const full = path.join(API_SRC, rel);
            fileLines.set(rel, hasSource(full) ? readSource(full).split(/\r?\n/) : []);
        }
        return fileLines.get(rel);
    };

    const classified = [];
    for (const row of rows) {
        // Presence is not a message; a handoff announcement is not a customer
        // message; and a producer that cannot reach a provider-billed channel
        // cannot produce a provider charge.
        const door = EGRESS.find(entry => entry.primitive.startsWith(row.primitive));
        const reaches = row.channels.some(channel => BILLED.has(channel) || channel === 'dynamic');
        const needsGate = row.billable && (door ? door.customerMessage !== false : true) && reaches;
        if (!needsGate) { classified.push({ ...row, needsGate: false }); continue; }
        const terminus = row.app === 'api'
            ? terminusFor(row, linesOf(row.file), row.line - 1, classes)
            : { file: null, how: 'outside `apps/api`' };
        // A road cannot be gated — only its entrances can, and this call site IS
        // an entrance. So when the terminus is a declared road the question moves
        // back one level, to the file that chose to use it. That is the whole
        // contract of `PROVIDER_ROADS`: it redirects the question, it never
        // drops it, and a producer that neither is gated itself nor terminates
        // at a gated sink is still a violation.
        let where = terminus.file, how = terminus.how;
        if (where && PROVIDER_ROADS[where] && sinkVerdict(row.file).fullyGated) {
            how = `${how}, a road — gated at this call site instead`;
            where = row.file;
        }
        classified.push({
            ...row, needsGate: true, terminus: where, terminusHow: how,
            gated: Boolean(where) && sinkVerdict(where).fullyGated,
            // Named so a violation can say WHICH way the sink failed: it never
            // asked, or it asked and the answer no longer reaches the POST.
            terminusUncovered: where ? sinkVerdict(where).uncovered : [],
        });
    }

    // The second half: every provider egress in the tree, gated or not. This is
    // what catches a brand-new file that POSTs to Meta directly and never
    // touches a primitive this script knows by name.
    const egress = [];
    for (const file of sources()) {
        // Comments out, template literals KEPT: the URL is a template literal.
        const text = readSource(file.full);
        const lines = withoutComments(text).split(/\r?\n/);
        const found = [];
        for (let i = 0; i < lines.length; i++) {
            for (const door of PROVIDER_EGRESS) {
                if (!door.pattern.test(lines[i])) continue;
                found.push({ line: i + 1, what: door.what });
                break;
            }
        }
        if (!found.length) continue;
        const road = (file.app === 'api' && PROVIDER_ROADS[file.rel]) || null;
        // Dominance and cardinality, per call site. `codeOnly` for the gate
        // question — a mention inside a comment or a string is not a call.
        const coverage = file.app === 'api' && !road
            ? egressCoverage(codeOnly(text), found.map(entry => entry.line))
            : { uncovered: [], reasons: new Map() };
        const uncovered = new Set(coverage.uncovered);
        for (const entry of found) {
            egress.push({
                app: file.app, file: file.rel, line: entry.line, what: entry.what,
                road,
                gated: file.app === 'api' && !uncovered.has(entry.line)
                    && sinkVerdict(file.rel).hasGate,
                // Named separately from "no gate at all" so a report can tell
                // an unguarded new file from a second POST behind one
                // admission: they are different mistakes with different fixes.
                dominated: file.app === 'api' && !uncovered.has(entry.line),
                /** `ungated`, `repeats`, or null when this line is covered. */
                why: coverage.reasons.get(entry.line) ?? null,
            });
        }
    }

    // ═══ A RECEIVER NAME IS NOT A CONTRACT ═══
    //
    // Three of the primitives above are receiver NAMES — `proactive`,
    // `proactiveDispatch`, `dispatch` — and the next producer may call its
    // field `lane`. That is how this blind spot happened in the first place:
    // `proactive-dispatch.service.ts` was declared a road, whose contract is
    // that the question moves one level up, and no primitive matched its
    // entrance, so the question was dropped instead. Fourteen producers moved
    // onto the lane without appearing in any sweep.
    //
    // So the name is checked against the TYPE. Every file that declares a
    // member of type `ProactiveDispatchService` and calls `.send(` on it must
    // have a classified call site on that line. A member named something this
    // list has never heard of is reported by name — a failure that says exactly
    // what to add — rather than silently classifying nothing.
    const laneEntrances = [];
    const classifiedAt = new Set(classified.map(row => `${row.file}:${row.line}`));
    for (const file of sources()) {
        if (file.app !== 'api' || PROVIDER_ROADS[file.rel]) continue;
        const text = readSource(file.full);
        if (!text.includes('ProactiveDispatchService')) continue;
        const receivers = [...text.matchAll(
            /(?:private|public|protected|readonly)\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)[?]?\s*:\s*ProactiveDispatchService/g,
        )].map(match => match[1]);
        if (!receivers.length) continue;
        const lines = withoutComments(text).split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const calls = receivers.some(name =>
                lines[i].includes(`this.${name}.send(`) || lines[i].includes(`this.${name}?.send(`));
            if (!calls) continue;
            if (classifiedAt.has(`${file.rel}:${i + 1}`)) continue;
            laneEntrances.push({ file: file.rel, line: i + 1,
                receiver: receivers.find(name => lines[i].includes(name)) || receivers[0] });
        }
    }

    const bypasses = classified.filter(row => row.needsGate && !row.gated);
    const ungatedEgress = egress.filter(entry => !entry.gated && !entry.road);
    return { classified, egress, bypasses, ungatedEgress, laneEntrances };
}

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
    // A file the overlay ADDS is not on disk for `walk` to find, and the sweep
    // that matters most - "a brand-new file POSTs to Meta and nobody gated it"
    // - is exactly the case where the new file does not exist yet.
    for (const entry of SOURCE_OVERLAY.values()) {
        if (entry.added) files.push({ app: entry.app, rel: entry.rel, full: entry.full });
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
        const text = readSource(file.full);
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
    return hasSource(file) ? readSource(file) : '';
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

function render(rows, declared, infrastructure, census) {
    const byFile = new Map();
    for (const row of rows) {
        if (!byFile.has(row.file)) byFile.set(row.file, []);
        byFile.get(row.file).push(row);
    }
    const billable = rows.filter(row => row.billable);
    const presence = rows.filter(row => !row.billable);
    const laneCounts = new Map();
    for (const row of billable) laneCounts.set(row.lane, (laneCounts.get(row.lane) || 0) + 1);

    // ── THE FIVE NUMBERS, AND WHY THEY ARE FIVE ─────────────────────────────
    //
    // "Sites outside the durable lane" was one number doing three jobs, and the
    // three answers are not the same:
    //
    //   · a site that cannot reach WhatsApp at all — a Telegram test button, an
    //     SMS test — is not a hole in a WhatsApp bill however it sends;
    //   · a site that reaches WhatsApp but that Meta does not bill (a typing
    //     indicator) is not one either;
    //   · a site that CAN put a chargeable WhatsApp message on a phone and has
    //     no durable row is the whole problem, and it was buried in a count
    //     that mixed it with the other two.
    //
    // The target the handoff names is the last one: zero CHARGEABLE producers
    // outside the durable lane. Printing the intermediate counts is what makes
    // that number checkable rather than asserted.
    const durableLanes = new Set(['dispatch_outbox', 'approved_effect', 'operational_notice',
        'handoff_effects', 'proactive_dispatch']);
    const reachesWhatsApp = rows.filter(row =>
        row.channels.some(channel => channel === 'whatsapp' || channel === 'dynamic'));
    const chargeableByMeta = reachesWhatsApp.filter(row => row.billable);
    const insideTheGate = chargeableByMeta.filter(row => !census.bypasses
        .some(entry => entry.file === row.file && entry.line === row.line));
    const insideTheDurableLane = chargeableByMeta.filter(row => durableLanes.has(row.lane));
    const chargeableNotDurable = chargeableByMeta.filter(row => !durableLanes.has(row.lane));

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
    push('### Los cinco números que importan');
    push('');
    push('El conteo de arriba mezcla tres cosas distintas: un botón de prueba de Telegram');
    push('que no pasa por un carril durable no es un agujero en una factura de WhatsApp.');
    push('Estas cinco filas separan lo que realmente se está midiendo, y la última es el');
    push('objetivo: **cero productores cobrables fuera del carril durable**.');
    push('');
    push('| | |');
    push('|---|---|');
    push(`| Sitios de llamada, en total | **${rows.length}** |`);
    push(`| De ellos, capaces de alcanzar WhatsApp | **${reachesWhatsApp.length}** |`);
    push(`| De ellos, **cobrables por Meta** | **${chargeableByMeta.length}** |`);
    push(`| De ellos, dentro de la frontera económica | **${insideTheGate.length}** |`);
    push(`| De ellos, dentro del **carril durable** | **${insideTheDurableLane.length}** |`);
    push('');
    push('| | |');
    push('|---|---|');
    push(`| Cobrables **fuera de la frontera económica** | **${census.bypasses.length}** |`);
    push(`| Cobrables **fuera del carril durable** | **${chargeableNotDurable.length}** |`);
    push(`| Salidas al proveedor **sin admisión ni camino declarado** | **${census.ungatedEgress.length}** |`);
    push('');
    if (chargeableNotDurable.length) {
        push('Los que todavía están fuera del carril durable:');
        push('');
        push('| Archivo:línea | Método | Carril |');
        push('|---|---|---|');
        for (const row of chargeableNotDurable) {
            push(`| \`${row.file}:${row.line}\` | \`${row.method}\` | \`${row.lane}\` |`);
        }
        push('');
    }
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
    push('## La frontera economica: cero productores cobrables fuera de ella');
    push('');
    push('Desde el 1 de octubre de 2026 cada mensaje de servicio entregado en WhatsApp es');
    push('un cargo contra la WABA del propio negocio. El objetivo no es "menos bypasses":');
    push('es **cero productores WhatsApp cobrables fuera del carril economico**. Un numero');
    push('que tiene que quedarse en cero necesita una comprobacion que falle, no un');
    push('documento que envejezca — por eso esta seccion la genera el mismo barrido y');
    push('`--check` termina en 1 si deja de estar vacia.');
    push('');
    push('La clasificacion es **estructural, no nominal**. No hay una lista de metodos');
    push('aprobados: para cada sitio de llamada se resuelve **donde sale realmente el');
    push('mensaje del proceso** — el carril lleva al procesador, y una llamada inline se');
    push('resuelve leyendo el tipo declarado del receptor y buscando esa clase en el');
    push('arbol — y se pregunta si **ese archivo** contiene una llamada a la autoridad');
    push('economica, con los comentarios y las plantillas quitados. Un productor nuevo');
    push('queda clasificado la primera vez que corre esto; borrar la admision de un');
    push('sumidero convierte en violacion a todos los productores que salen por ahi.');
    push('');
    push('### Violaciones');
    push('');
    if (!census.bypasses.length) {
        push('**Ninguna.** Todo productor cobrable que puede alcanzar WhatsApp termina en un');
        push('archivo que pide permiso antes de emitir el efecto.');
    } else {
        push('| Archivo:linea | Metodo | Carril | Termina en | Como se resolvio |');
        push('|---|---|---|---|---|');
        for (const row of census.bypasses) {
            push(`| \`${row.file}:${row.line}\` | \`${row.method}\` | \`${row.lane}\` | `
                + `${row.terminus ? `\`${row.terminus}\`` : '**sin resolver**'} | ${row.terminusHow} |`);
        }
    }
    push('');
    push('### Los sumideros, y la prueba de que piden permiso');
    push('');
    push('Un sumidero es un archivo donde una peticion sale de verdad hacia el proveedor.');
    push('La columna "admision" no repite lo que dice un comentario: es el resultado de');
    push('buscar una llamada a la autoridad economica en el codigo del archivo.');
    push('');
    push('| Archivo:linea | Que sale | Admision | Nota |');
    push('|---|---|---|---|');
    for (const entry of census.egress) {
        const app = entry.app === 'whatsapp' ? 'apps/whatsapp/src/' : 'apps/api/src/';
        push(`| \`${app}${entry.file}:${entry.line}\` | ${entry.what} | `
            + `${entry.gated ? 'si' : (entry.road ? 'camino' : '**no**')} | `
            + `${entry.road || (entry.gated ? 'pide permiso antes de emitir' : 'sin admision y sin camino declarado')} |`);
    }
    push('');
    push('### Productores cobrables y su sumidero');
    push('');
    push('| Archivo:linea | Metodo | Carril | Termina en | Admision |');
    push('|---|---|---|---|---|');
    for (const row of census.classified.filter(entry => entry.needsGate)) {
        push(`| \`${row.file}:${row.line}\` | \`${row.method}\` | \`${row.lane}\` | `
            + `${row.terminus ? `\`${row.terminus}\`` : '**sin resolver**'} | ${row.gated ? 'si' : '**no**'} |`);
    }
    push('');
    push('### Lo que esta comprobacion no puede ver');
    push('');
    push('1. Un receptor cuyo tipo no se declara en el archivo que lo usa: se reporta');
    push('   **sin resolver**, que cuenta como violacion. Eso es deliberado — no resolver');
    push('   nunca puede leerse como aprobar.');
    push('2. Un envio construido en tiempo de ejecucion (un `eval`, una URL armada por');
    push('   partes en otra variable). No existe hoy en el arbol, y si aparece hay que');
    push('   agregarlo a `PROVIDER_EGRESS`.');
    push('3. Si el gasto queda efectivamente **negado**: eso depende de la configuracion');
    push('   por tenant (`observe` frente a `enforce`), no del codigo. Esta seccion prueba');
    push('   que se **pide permiso**, no cual es la respuesta.');
    push('');
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
    // Exactly one newline at the end, and no blank line before it.
    //
    // Every section here ends with a push() of an empty separator, so the last
    // one left a trailing empty element and the naive join produced a file
    // ending in a blank line — which git diff --check reports as an error on
    // every regeneration. Fixed in the generator and not in the file, because a
    // file fixed by hand is un-fixed by the next run.
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const outIndex = args.indexOf('--out');
    const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : DEFAULT_OUT;

    const rows = collect();
    const declared = declaredProducers();
    const census = gateCensus(rows);
    const markdown = render(rows, declared, declaredInfrastructure(), census);

    if (check) {
        // Two separate failures, reported together rather than one at a time, so
        // a run says everything that is wrong instead of hiding the second
        // problem behind the first.
        let failed = false;
        for (const row of census.bypasses) {
            process.stderr.write(`outbound-producer-inventory: CHARGEABLE WHATSAPP PRODUCER OUTSIDE THE `
                + `ECONOMIC BOUNDARY at apps/api/src/${row.file}:${row.line} (${row.method}, lane `
                + `${row.lane}) — terminates at ${row.terminus || 'an unresolved sink'} `
                + `(${row.terminusHow}), which ${row.terminusUncovered && row.terminusUncovered.length
                    ? `asks the money authority but leaves its provider egress uncovered at line `
                        + `${row.terminusUncovered.join(', ')}`
                    : 'does not ask the money authority'}.\n`);
            failed = true;
        }
        for (const entry of census.laneEntrances) {
            process.stderr.write(`outbound-producer-inventory: UNCLASSIFIED DURABLE-LANE ENTRANCE at `
                + `apps/api/src/${entry.file}:${entry.line} — \`this.${entry.receiver}.send(\` is a `
                + `ProactiveDispatchService call this sweep does not recognise. Add `
                + `'${entry.receiver}.send(' to EGRESS, or rename the member to one already there.\n`);
            failed = true;
        }
        for (const entry of census.ungatedEgress) {
            const app = entry.app === 'whatsapp' ? 'apps/whatsapp/src/' : 'apps/api/src/';
            // "No admission call" is false of a loop that admits once and
            // sends N times, and telling somebody to add a gate they already
            // have is how a check stops being believed.
            process.stderr.write(entry.why === 'repeats'
                ? `outbound-producer-inventory: ONE ADMISSION, MANY SENDS at `
                    + `${app}${entry.file}:${entry.line} — ${entry.what} runs inside a loop whose `
                    + `admission is OUTSIDE it. One reservation cannot settle N charges: move the `
                    + `admission inside the loop, or send one message.\n`
                : `outbound-producer-inventory: UNGATED PROVIDER EGRESS at `
                    + `${app}${entry.file}:${entry.line} — ${entry.what} with no admission call and no `
                    + `entry in PROVIDER_ROADS.\n`);
            failed = true;
        }
        if (failed) {
            process.stderr.write('\nEvery chargeable WhatsApp send must pass WhatsappSendAdmissionService.\n'
                + 'Route the producer through a gated sink, or gate the new sink and say so in\n'
                + 'PROVIDER_ROADS with the reason. Do not add an exception by method name.\n');
            process.exit(1);
        }
        // ── COMPARE THE CONTENT, NOT THE LINE ENDINGS ───────────────────────
        //
        // A raw byte comparison against a checked-out .md is a comparison
        // against `core.autocrlf`. `.gitattributes` pins *.sh, *.sql, *.yml,
        // *.cjs and the binaries, and has no *.md rule, so on Windows this
        // file is LF in the index and CRLF in the working tree -- and the
        // gate reported a freshly generated artefact as stale. Git says so
        // itself, every time: "LF will be replaced by CRLF the next time Git
        // touches it".
        //
        // Linux CI compares LF to LF and never saw it, which is what made it
        // survive: a gate that is red only on the machine where somebody is
        // working is a gate they learn to re-run rather than believe. Both
        // sibling generators already normalise; this is the third.
        const normalise = text => text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
        const current = fs.existsSync(out) ? normalise(fs.readFileSync(out, 'utf8')) : '';
        if (current !== normalise(markdown)) {
            process.stderr.write(`outbound-producer-inventory: ${out} is stale — regenerate it\n`);
            process.exit(1);
        }
        process.stdout.write(`outbound-producer-inventory: up to date (${rows.length} call sites, `
            + `${census.classified.filter(row => row.needsGate).length} chargeable, 0 outside the boundary)\n`);
        return;
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, markdown, 'utf8');
    process.stdout.write(`outbound-producer-inventory: ${rows.length} call sites in `
        + `${new Set(rows.map(row => row.file)).size} files, ${census.bypasses.length} outside `
        + `the economic boundary → ${out}\n`);
}

if (require.main === module) main();
module.exports = { collect, declaredProducers, declaredInfrastructure, render, gateCensus,
    EGRESS, ROADS, GATE_CALLS, PROVIDER_EGRESS, PROVIDER_ROADS, codeOnly, withoutComments,
    egressCredits, egressCoverage, sinkVerdict, isGatedFile, withSourceOverlay };
