"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle, HelpCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  billingTimeZoneOptions,
  buildBillingTimeZoneRequest,
  filterTimeZones,
  readBillingZoneSaveOutcome,
  timeZoneOffsetLabel,
  type BillingZoneAccess,
  type BillingZoneSaveOutcome,
  type BillingZoneState,
} from "./billing-time-zone";

export interface BillingZoneSaved {
  phoneNumberId: string;
  timeZone: string;
  alsoApplied: string[];
}

type FormError = Exclude<BillingZoneSaveOutcome["kind"], "saved"> | "choose_first";

const ERROR_KEYS: Record<FormError, string> = {
  choose_first: "chooseFirst",
  invalid_zone: "errorInvalidZone",
  verify_email: "errorVerifyEmail",
  not_allowed: "errorNotAllowed",
  number_not_found: "errorNumberNotFound",
  failed: "errorFailed",
};

/**
 * The billing time zone of ONE connected WhatsApp number.
 *
 * Missing is the loud state on purpose: while it lasts the spend admission
 * refuses every chargeable send of the number, so the agent's replies are
 * retried and then dropped — and nothing else on this page would say why.
 *
 * The decisions (what counts as set, who gets the form, what a response means)
 * live in `billing-time-zone.ts`; this only renders them.
 */
export default function WhatsAppBillingTimeZone({
  phoneNumberId,
  numberLabel,
  state,
  access,
  onSaved,
  onRetry,
}: {
  phoneNumberId: string;
  numberLabel: string;
  state: BillingZoneState;
  access: BillingZoneAccess;
  onSaved: (saved: BillingZoneSaved) => Promise<void> | void;
  onRetry: () => void;
}) {
  const t = useTranslations("channels.whatsapp.billingZone");
  const [fixing, setFixing] = useState(false);

  if (state.kind === "unknown") {
    return (
      <p className="mt-4 mb-0 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
        <HelpCircle size={14} aria-hidden="true" />
        {t("unknown")}
        <button
          type="button"
          onClick={onRetry}
          className="bg-transparent border-0 p-0 text-xs font-semibold text-[var(--accent)] underline cursor-pointer"
        >
          {t("retry")}
        </button>
      </p>
    );
  }

  if (state.kind === "set") {
    const offset = timeZoneOffsetLabel(state.zone);
    const conflict = state.conflictingZones.length > 1;
    return (
      <div className="mt-4">
        <p className="m-0 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <CheckCircle size={14} className="text-[#2ecc71]" aria-hidden="true" />
          {t("setLabel", { zone: offset ? `${state.zone} (${offset})` : state.zone })}
        </p>
        {conflict && (
          <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3">
            <p className="m-0 text-xs text-amber-800 dark:text-amber-300">
              {t("setConflict", { zones: state.conflictingZones.join(", ") })}
            </p>
            {access === "form" && !fixing && (
              <button
                type="button"
                onClick={() => setFixing(true)}
                className="mt-2 px-3 py-1.5 rounded-lg border border-amber-400/60 bg-transparent text-[12px] font-semibold text-amber-900 dark:text-amber-200 cursor-pointer hover:bg-amber-500/10"
              >
                {t("fix")}
              </button>
            )}
            {access === "form" && fixing && (
              <BillingZoneForm
                phoneNumberId={phoneNumberId}
                suggestion={null}
                hint={null}
                onSaved={async (saved) => { setFixing(false); await onSaved(saved); }}
                onCancel={() => setFixing(false)}
              />
            )}
          </div>
        )}
        {/* A confirmed zone must stay correctable from here. The card preselects
            a suggestion for every number that has none, so a careless confirm
            is the likeliest mistake — and a wrong zone dates charges in the
            wrong month, which nobody should need the database to undo. The
            form still preselects only the CURRENT zone and sends nothing until
            the new one is confirmed. */}
        {!conflict && access === "form" && !fixing && (
          <button
            type="button"
            onClick={() => setFixing(true)}
            className="mt-2 bg-transparent border-0 p-0 text-xs font-semibold text-[var(--accent)] underline cursor-pointer"
          >
            {t("change")}
          </button>
        )}
        {!conflict && access === "form" && fixing && (
          <BillingZoneForm
            phoneNumberId={phoneNumberId}
            suggestion={state.zone}
            hint={null}
            onSaved={async (saved) => { setFixing(false); await onSaved(saved); }}
            onCancel={() => setFixing(false)}
          />
        )}
      </div>
    );
  }

  const hint = state.suggestionSource === "same_account" && state.suggestion
    ? t("suggestionSameAccount", { zone: state.suggestion })
    : state.suggestionSource === "common" && state.suggestion
      ? t("suggestionCommon", { zone: state.suggestion })
      : state.conflictingZones.length > 1
        ? t("suggestionConflict", { zones: state.conflictingZones.join(", ") })
        : null;

  return (
    <section
      aria-labelledby={`billing-zone-${phoneNumberId}`}
      className="mt-4 rounded-xl border-2 border-amber-400 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 p-4"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id={`billing-zone-${phoneNumberId}`} className="m-0 text-sm font-semibold text-amber-900 dark:text-amber-200">
            {t("blockedTitle")}
          </h3>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            {t("blockedBody", { number: numberLabel })}
          </p>
          <p className="mt-2 mb-0 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            {t("whereToCheck")}
          </p>

          {access === "form" && (
            <BillingZoneForm phoneNumberId={phoneNumberId} suggestion={state.suggestion} hint={hint} onSaved={onSaved} />
          )}
          {access === "ask_admin" && (
            <p className="mt-3 mb-0 text-xs font-semibold text-amber-900 dark:text-amber-200">{t("askAdmin")}</p>
          )}
          {access === "verify_email" && (
            <p className="mt-3 mb-0 text-xs text-amber-900 dark:text-amber-200">
              {t("verifyEmailFirst")}{" "}
              <Link href="/verify-email" className="font-semibold underline">{t("verifyEmailCta")}</Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * One field: a searchable list of zones and one explicit confirmation.
 *
 * The suggestion only preselects the list. Nothing is sent until somebody
 * presses the button that names the zone, and the request can only be built
 * from a zone that is one of the offered choices.
 */
function BillingZoneForm({
  phoneNumberId,
  suggestion,
  hint,
  onSaved,
  onCancel,
}: {
  phoneNumberId: string;
  suggestion: string | null;
  hint: string | null;
  onSaved: (saved: BillingZoneSaved) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const t = useTranslations("channels.whatsapp.billingZone");
  const ids = useId();
  const options = useMemo(() => billingTimeZoneOptions(), []);
  const labels = useMemo(() => {
    const now = new Date();
    return new Map(options.map((zone) => {
      const offset = timeZoneOffsetLabel(zone, now);
      const name = zone.replace(/_/g, " ");
      return [zone, offset ? `${name} (${offset})` : name] as const;
    }));
  }, [options]);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(suggestion && options.includes(suggestion) ? suggestion : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  const visible = filterTimeZones(options, query, selected);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = buildBillingTimeZoneRequest(phoneNumberId, selected, options);
    if (!request.ok) {
      setError("choose_first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api.setWhatsappBillingTimeZone(request.body.phoneNumberId, request.body.timeZone);
      const outcome = readBillingZoneSaveOutcome(response, request.body);
      if (outcome.kind === "saved") {
        await onSaved({ phoneNumberId: request.body.phoneNumberId, timeZone: outcome.timeZone, alsoApplied: outcome.alsoApplied });
        return;
      }
      setError(outcome.kind);
    } catch {
      setError("failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2" noValidate>
      <div>
        <label htmlFor={`${ids}-search`} className="block text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
          {t("searchLabel")}
        </label>
        <input
          id={`${ids}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // Enter in a text field submits its form through the default button,
          // and that button is enabled from the first render because the
          // suggestion is preselected: typing "mexico" + Enter would confirm
          // Bogotá. Searching must never confirm anything.
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          className="w-full max-w-md rounded-lg border border-border bg-[var(--bg-primary)] px-3 py-2 text-sm text-foreground"
        />
      </div>
      <div>
        <label htmlFor={`${ids}-zone`} className="block text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
          {t("selectLabel")}
        </label>
        <select
          id={`${ids}-zone`}
          size={6}
          value={selected}
          onChange={(event) => { setSelected(event.target.value); setError(null); }}
          aria-describedby={hint ? `${ids}-hint` : undefined}
          className="w-full max-w-md rounded-lg border border-border bg-[var(--bg-primary)] px-2 py-1 text-sm text-foreground"
        >
          {visible.map((zone) => (
            <option key={zone} value={zone}>{labels.get(zone) ?? zone}</option>
          ))}
        </select>
        {visible.length === 0 && (
          <p className="mt-1 mb-0 text-xs text-amber-800 dark:text-amber-300">{t("noResults", { query })}</p>
        )}
      </div>
      {hint && (
        <p id={`${ids}-hint`} className="m-0 text-xs text-amber-800 dark:text-amber-300">{hint}</p>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs font-semibold text-[#c0392b] dark:text-[#ff6b6b]">
          {t(ERROR_KEYS[error])}
          {error === "verify_email" && (
            <>
              {" "}
              <Link href="/verify-email" className="underline">{t("verifyEmailCta")}</Link>
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!selected || saving}
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors",
            !selected || saving ? "bg-amber-400 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-700 cursor-pointer",
          )}
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {saving ? t("saving") : selected ? t("confirm", { zone: selected }) : t("confirmPending")}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-border bg-transparent text-sm text-foreground cursor-pointer"
          >
            {t("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
