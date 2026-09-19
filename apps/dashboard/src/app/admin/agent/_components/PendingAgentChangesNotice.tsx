"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { AgentConfigurationWorkspace, AgentDraftBody } from "@parallext/shared";
import { useRole } from "@/hooks/useRole";

/**
 * Changes saved before the deploy that switched every tenant to immediate save
 * (D1/D15) and never reached the live agent.
 *
 * - `none`    nothing to say: reviewed mode (its own panel handles drafts), no
 *             draft, or a draft that already says exactly what is live.
 * - `pending` a draft on the current base that differs from what is live. It
 *             can be applied (the normal save path) or discarded.
 * - `stale`   a draft whose base moved since (the agent was switched on, a
 *             channel got connected, the assistant applied a suggestion — the
 *             base hash covers version, activation and channels). The server
 *             refuses EVERY save while that pointer exists, identical or not,
 *             so the only way forward is to discard it.
 */
export type PendingAgentChanges = "none" | "pending" | "stale";

export function pendingAgentChanges(workspace: AgentConfigurationWorkspace | null | undefined): PendingAgentChanges {
  if (!workspace?.directCommit || !workspace.draft) return "none";
  if (!workspace.draft.currentBase) return "stale";
  return sameConfiguration(workspace.draft.body, workspace.operational.body) ? "none" : "pending";
}

/** Order-insensitive JSON, so a jsonb round trip does not read as a change. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Two bodies that would leave the agent the same once applied. */
function sameConfiguration(draft: AgentDraftBody, live: AgentDraftBody): boolean {
  const comparable = (body: AgentDraftBody) => stable({
    ...body,
    // The commit stores '24/7' as '24_7'.
    scheduleMode: body.scheduleMode === "24/7" ? "24_7" : body.scheduleMode,
    // A commit never demotes the default agent, so "not default" changes nothing there.
    isDefault: Boolean(body.isDefault || live.isDefault),
    channels: [...(body.channels ?? [])].sort(),
    channelBindings: [...(body.channelBindings ?? [])].sort(),
  });
  return comparable(draft) === comparable(live);
}

export interface PendingAgentChangesNoticeProps {
  state: Exclude<PendingAgentChanges, "none">;
  /** What the form below shows: the live agent, or the old changes being applied. */
  view: "live" | "draft";
  busy: null | "apply" | "discard";
  /** Disables both actions while the editor itself is saving. */
  saving?: boolean;
  discardFailed: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

/**
 * One line at the top of the editor, in the owner's words: no "borrador", no
 * "publicar", no "versión operativa" — "cambios de antes" that are or are not
 * applied yet.
 */
export function PendingAgentChangesNotice({
  state, view, busy, saving = false, discardFailed, onApply, onDiscard,
}: PendingAgentChangesNoticeProps) {
  const t = useTranslations("agentPendingChanges");
  const { canEditAgent } = useRole();
  const titleId = useId();
  const stale = state === "stale";
  const reviewing = !stale && view === "draft";
  const disabled = busy !== null || saving;
  return (
    <section
      aria-labelledby={titleId}
      data-pending-agent-changes={state}
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id={titleId} className="font-semibold">
            {t(stale ? "staleTitle" : reviewing ? "reviewingTitle" : "pendingTitle")}
          </h2>
          <p className="mt-1">
            {t(stale ? "staleBody" : reviewing ? "reviewingBody" : "pendingBody")}
          </p>
          {canEditAgent ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!stale && (
                <button
                  type="button"
                  onClick={onApply}
                  disabled={disabled}
                  className="min-h-10 rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === "apply" ? t("applying") : t(reviewing ? "saveToApply" : "apply")}
                </button>
              )}
              <button
                type="button"
                onClick={onDiscard}
                disabled={disabled}
                className="min-h-10 rounded-lg border border-current px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "discard" ? t("discarding") : t("discard")}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs">{t("adminOnly")}</p>
          )}
          {discardFailed && (
            <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{t("discardError")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
