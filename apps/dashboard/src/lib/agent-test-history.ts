// Keep the public Agent Test request within its item and total-character budgets.
// Preserve a contiguous recent suffix; keep the visible conversation and each text intact.
const HISTORY_MAX_ITEMS = 20;
const HISTORY_MAX_CHARS = 24_000;

export function agentTestHistoryWindow<T extends { content: string }>(turns: readonly T[]): T[] {
    const history: T[] = [];
    let chars = 0;
    for (let index = turns.length - 1; index >= 0 && history.length < HISTORY_MAX_ITEMS; index--) {
        const turn = turns[index];
        if (chars + turn.content.length > HISTORY_MAX_CHARS) break;
        history.unshift(turn);
        chars += turn.content.length;
    }
    return history;
}
