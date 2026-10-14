/** Emit the canonical mode for both current and legacy API fields. */
export function editorConfigForSave<T extends object>(base: T, mode: "guided" | "prompt", customPrompt: string) {
    const promptMode = mode === "prompt";
    const canonicalMode = promptMode ? "prompt" : "guided";
    return {
        ...base,
        editorMode: canonicalMode,
        _mode: canonicalMode,
        customPrompt: promptMode ? customPrompt : undefined,
        _customPrompt: promptMode ? customPrompt : undefined,
    };
}
