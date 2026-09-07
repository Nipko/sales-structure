export type LearningMessage = { role: "customer" | "assistant"; text: string };
export type LearningImport = {
    sourceKey: string; contactKey: string; channel: string; language: string;
    messages: LearningMessage[]; redactTerms: string[];
};
export type LearningExample = {
    id: string; source_id: string; kind: string | null; intent: string;
    episode: LearningMessage[]; response_pattern: string | null; rationale: string | null;
    facts_required: string[]; analysis: { scores?: Record<string, number>; exclusions?: string[] } | null;
    status: string; revision: number; dedup_status: string; split: string; channel: string;
    language: string; source_kind: string; source_conversation_id?: string;
};
export type LearningRelease = {
    id: string; status: string; traffic_percent: number; evaluation_status: string;
    example_ids: string[]; baseline_release_id: string | null;
    evaluation?: { candidateAverage?: number; baselineAverage?: number; error?: string;
        totalCases?: number; completedCases?: number; failedCases?: number };
};
export type LearningWorkspaceData = {
    examples: LearningExample[]; releases: LearningRelease[]; coverage: Array<{ split: string; count: number }>;
};

const CUSTOMER = new Set(["cliente", "client", "customer", "usuario", "user", "usuário", "utilisateur"]);
const ASSISTANT = new Set(["agente", "agent", "assistant", "asistente", "assistente"]);

/** A labelled turn starts a message; line breaks within that message are kept. */
export function parseLearningTranscript(text: string): LearningMessage[] {
    if (text.length > 200_000) throw new Error("tooLarge");
    const messages: LearningMessage[] = [];
    for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const match = line.match(/^\s*([^:]{1,20}):\s*(.*)$/);
        const label = match?.[1].toLocaleLowerCase();
        const role = label && CUSTOMER.has(label) ? "customer" : label && ASSISTANT.has(label) ? "assistant" : null;
        if (role) messages.push({ role, text: match![2].trim() });
        else if (messages.length) messages[messages.length - 1].text += `\n${line.trim()}`;
        else throw new Error("transcriptFormat");
    }
    if (messages.length > 200 || messages.some(message => message.text.length > 10_000)) throw new Error("tooLarge");
    if (messages.some(message => !message.text) || !messages.some(message => message.role === "customer") ||
        !messages.some(message => message.role === "assistant")) throw new Error("transcriptFormat");
    return messages;
}

export function canSelectLearningExample(example: LearningExample): boolean {
    return example.status === "approved" && example.split === "train" &&
        ["brand_style", "operational_pattern"].includes(example.kind || "");
}

export function canApproveLearningExample(example: LearningExample): boolean {
    const scores = example.analysis?.scores;
    return example.status === 'analyzed' && example.dedup_status === 'clear' && !!scores &&
        !example.analysis?.exclusions?.length &&
        ['accuracy', 'toolUse', 'understanding', 'clarity', 'brevity', 'empathy', 'brandTone', 'uncertainty', 'closure']
            .every(dimension => Number.isInteger(scores[dimension]) && scores[dimension] >= (dimension === 'brevity' ? 2 : 3) && scores[dimension] <= 4);
}

export function learningEvaluationSummary(release: LearningRelease) {
    // Reserved conversations and replay traces never reach the review screen.
    return { total: release.evaluation?.totalCases ?? 0,
        completed: release.evaluation?.completedCases ?? 0,
        failed: release.evaluation?.failedCases ?? 0 };
}
