/**
 * Tool calls written as TEXT.
 *
 * A model that has no tool interface this turn (the booking engine voiced a directive with tools = []) or that was
 * trained on another call format (DeepSeek's «<｜｜DSML｜｜ invoke name="create_appointment">») sometimes writes the call
 * into its reply. Shown to a customer it is raw markup with their name and e-mail in it; READ BY US it would be
 * worse: executing a call parsed from text would run a write with no consent. So the text is only ever DETECTED and
 * REMOVED here, never parsed into a call.
 *
 * `names` are the tool names known to the turn (published this turn plus the registry): a tag named like a tool is a
 * call. Generic shapes are caught without them (DSML, invoke, function_calls, tool_call, parameter, and any
 * snake_case tag, which never appears in a customer reply).
 */
const GENERIC_START: readonly RegExp[] = [
    /<\s*[｜|]/u, // «<｜» / «<|»: DeepSeek and ChatML-style delimiters
    /[｜|]{1,2}\s*DSML/i,
    /\bDSML\b/,
    /<\s*\/?\s*invoke\b/i,
    /<\s*\/?\s*function_calls?\b/i,
    /<\s*\/?\s*tool_(?:calls?|use|code)\b/i,
    /<\s*\/?\s*antml:/i,
    /<\s*parameter\s+name\s*=/i,
    /<\s*function\s*=/i,
    // any snake_case tag: «<service_id>», «<create_appointment>»
    /<\s*\/?\s*[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*(?:[^<>\n]*)>/i,
];

const GENERIC_CLOSE = /<\s*\/\s*(?:invoke|function_calls?|tool_(?:calls?|use|code))\s*>|<\s*\/[｜|][^>]*>|[｜|]\s*>/giu;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function namedTag(names: readonly string[]): RegExp | null {
    const usable = [...new Set(names.filter(name => /^[a-z][a-z0-9_]{2,}$/i.test(name)))];
    return usable.length ? new RegExp(`<\\s*\\/?\\s*(?:${usable.map(escape).join('|')})\\b[^<>]*>`, 'i') : null;
}

/** Whether the text holds something that looks like a tool call. */
export function hasToolCallMarkup(text: unknown, names: readonly string[] = []): boolean {
    if (typeof text !== 'string' || !text.includes('<') && !/DSML/.test(text)) return false;
    if (GENERIC_START.some(pattern => pattern.test(text))) return true;
    const named = namedTag(names);
    return !!named && named.test(text);
}

/**
 * The text without the tool-call block(s): from the first markup to the last matching closing tag, or to the end of
 * the text when the call was never closed. What came before (the sentence the model wrote first) is kept.
 */
export function stripToolCallMarkup(text: string, names: readonly string[] = []): string {
    if (!hasToolCallMarkup(text, names)) return text;
    const named = namedTag(names);
    const starts = [...GENERIC_START, ...(named ? [named] : [])]
        .map(pattern => text.search(pattern))
        .filter(index => index >= 0);
    const start = Math.min(...starts);
    let end = text.length;
    let lastClose = -1;
    for (const match of text.slice(start).matchAll(GENERIC_CLOSE)) lastClose = start + (match.index ?? 0) + match[0].length;
    // «<create_appointment>…</create_appointment>»: the closing tag of the opening tag's own name.
    const open = /<\s*([a-z][a-z0-9_]*)[^<>]*>/i.exec(text.slice(start));
    if (open) {
        const closing = new RegExp(`<\\s*\\/\\s*${escape(open[1])}\\s*>`, 'gi');
        for (const match of text.slice(start).matchAll(closing)) lastClose = Math.max(lastClose, start + (match.index ?? 0) + match[0].length);
    }
    if (lastClose > start) end = lastClose;
    else {
        // A self-closing tag («<ping id="1"/>») is only itself, not the rest of the text.
        const selfClosing = /^<[^<>]*\/>/.exec(text.slice(start));
        if (selfClosing) end = start + selfClosing[0].length;
    }
    const kept = `${text.slice(0, start)} ${text.slice(end)}`;
    // What follows the block may hold more markup: strip until none is left.
    const rest = hasToolCallMarkup(kept, names) && kept.length < text.length ? stripToolCallMarkup(kept, names) : kept;
    return rest.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
