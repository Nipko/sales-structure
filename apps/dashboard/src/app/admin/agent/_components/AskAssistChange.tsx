"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { MessageSquareText } from "lucide-react";
import { openQualityAssistant } from "@/lib/quality-assistant-contract";

/** A request, not an essay; well under the 2 000 `parseQualityAssistantDetail` keeps. */
export const ASK_ASSIST_CHANGE_MAX = 500;

/**
 * "Dime qué cambiar" — asking for a change in words, from the editor itself.
 *
 * The only Assist entry the editor had lived in the assessment panel, which the
 * default (immediate) mode hides, so an owner who could not find the field for
 * "that greeting is too long" had nowhere to say it. This opens Assist on THIS
 * agent and sends her words as her message: Assist prepares the change, shows it
 * beside what the agent says now, and nothing is saved until she presses the
 * button on that card (whose wording follows the tenant's mode).
 *
 * One quiet line on purpose — no heading, no colour, no illustration. During
 * day 0 the guided setup is the guide on every screen; this is a field.
 *
 * With unsaved edits in the editor (`unsavedChanges`) it does not send: Assist
 * changes the agent as it is STORED, so her edits and its change collided and
 * the editor's only way out was "Descartar lo que escribiste y recargar". The
 * button waits, the line under it says to save first, and what she wrote stays
 * in the field. A one-click "Guardar y pedir" was the other option; it is not
 * here because a save can be refused (a missing field, a channel another agent
 * holds, a newer version) and each refusal already has its own message in the
 * editor — chaining the request behind it would mean a second place deciding
 * what to do when the first step fails, for one click less.
 */
export function AskAssistChange({ agentId, agentName, unsavedChanges = false }: {
  agentId: string;
  agentName?: string;
  /** The editor has edits nobody saved yet: say so instead of sending. */
  unsavedChanges?: boolean;
}) {
  const t = useTranslations("agent.askAssist");
  const inputId = useId();
  const hintId = useId();
  const [request, setRequest] = useState("");
  const trimmed = request.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || unsavedChanges) return;
    // `send`: these are her words, already written — Assist sends them instead
    // of waiting for a second Enter in the chat.
    openQualityAssistant({ agentId, agentName, prompt: trimmed.slice(0, ASK_ASSIST_CHANGE_MAX), send: true });
    setRequest("");
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t("label")}
      data-ask-assist-change
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <label htmlFor={inputId} className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
        <MessageSquareText size={14} aria-hidden="true" /> {t("label")}
      </label>
      <input
        id={inputId}
        type="text"
        value={request}
        maxLength={ASK_ASSIST_CHANGE_MAX}
        onChange={(event) => setRequest(event.target.value)}
        placeholder={t("placeholder")}
        aria-describedby={hintId}
        className="min-h-9 min-w-[12rem] flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400"
      />
      <button
        type="submit"
        disabled={!trimmed || unsavedChanges}
        aria-describedby={hintId}
        className="min-h-9 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {t("submit")}
      </button>
      <p id={hintId} className="w-full text-[11px] text-neutral-500 dark:text-neutral-400">
        {unsavedChanges ? t("saveFirst") : t("hint")}
      </p>
    </form>
  );
}
