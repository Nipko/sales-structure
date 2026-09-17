"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { Loader2, MessageCircleOff, WifiOff } from "lucide-react";
import { widgetLoaderUrl } from "@/lib/widget-snippet";
import { locales, type Locale } from "@/i18n/config";

/**
 * "El enlace de {Nombre}" — the public page where anyone chats with the agent.
 *
 * A visitor's page, not an admin one: no session, no theme, no sidebar, light
 * styling hard-coded so it looks the same on every phone that opens it from an
 * Instagram bio. The chat itself is the tenant's own web widget, mounted by the
 * platform loader INLINE inside `#parallly-widget-host` (`mode: 'page'`) instead
 * of as a floating bubble; this shell only draws the frame around it and reads
 * the public config to know whose page this is.
 *
 * Only the DEMO widget gets a page here. A tenant's production widget is fenced
 * to the domains they allowed; mounting it on this URL would quietly turn it
 * into a page anyone can share, so a non-demo id reads as a link that does not
 * exist.
 *
 * The chrome speaks the TENANT's language (`data.locale`), not the visitor's
 * cookie: whoever opens this link is the business's customer, and the business
 * chose the language its agent answers in.
 *
 * Rate-limit and allowance notices are the loader's to show, inside the chat.
 * The two states this page owns are the ones the loader cannot reach: a link
 * that no longer exists, and a config it could not fetch.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** The element the loader fills. Shared with the a11y spec, never renamed casually. */
export const WIDGET_HOST_ID = "parallly-widget-host";

/** Marks the injected loader so a second effect run finds it instead of adding another. */
const LOADER_ATTRIBUTE = "data-parallly-loader";

interface PublicWidgetConfig {
  widgetId: string;
  agentName: string;
  tenantName: string;
  isDemo: boolean;
  /** The tenant's language, when it is one of the four the product speaks. */
  locale: Locale | null;
}

type ShellState =
  | { kind: "loading" }
  | { kind: "ready"; config: PublicWidgetConfig }
  | { kind: "not_found" }
  | { kind: "error" };

/** What the loader reads before it runs. `mode: 'page'` renders open and inline. */
interface ParalllyWidgetGlobal {
  widgetId: string;
  mode: "page";
  host: string;
}

/** The locale plus the messages the page chrome is rendered with. */
interface ShellChrome {
  locale: Locale;
  messages: Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The four locales the product ships, and nothing else.
 *
 * The value comes off the wire and ends up inside an import path, so it is
 * matched against the allow-list rather than sanitised: an id nobody recognises
 * falls back to the visitor's locale instead of reaching the filesystem.
 */
function asShellLocale(value: unknown): Locale | null {
  return typeof value === "string" && (locales as readonly string[]).includes(value)
    ? (value as Locale)
    : null;
}

/** Loads one locale's messages. A failure is a worse-fitting page, never a broken one. */
async function loadShellChrome(locale: Locale | null): Promise<ShellChrome | null> {
  if (!locale) return null;
  try {
    const messages = (await import(`../../../../../messages/${locale}.json`)).default;
    return messages && typeof messages === "object"
      ? { locale, messages: messages as Record<string, unknown> }
      : null;
  } catch {
    return null;
  }
}

async function readPublicConfig(widgetId: string): Promise<ShellState> {
  const response = await fetch(`${API_URL}/widget/config/${encodeURIComponent(widgetId)}`);
  // Ours, not the link's: the only failure worth offering a retry for.
  if (response.status >= 500) return { kind: "error" };
  // A missing, inactive or unavailable widget answers in two shapes — an HTTP
  // 404, and the one the API actually sends: a 200 carrying
  // `{ success: false, error: 'Widget not found' }`. Both are the same fact,
  // and telling a visitor to check their connection over a dead link is a lie.
  if (!response.ok) return { kind: "not_found" };
  const body = await response.json().catch(() => null);
  // A 200 that is not even JSON is a proxy or a captive portal, not the API.
  if (!body || typeof body !== "object") return { kind: "error" };
  const envelope = body as { success?: unknown; data?: unknown };
  if (envelope.success !== true) return { kind: "not_found" };
  if (!envelope.data || typeof envelope.data !== "object") return { kind: "error" };
  const data = envelope.data as Record<string, unknown>;
  // The public page belongs to the demo widget alone.
  if (data.isDemo !== true) return { kind: "not_found" };
  return {
    kind: "ready",
    config: {
      widgetId: asText(data.widgetId) || widgetId,
      agentName: asText(data.agentName),
      tenantName: asText(data.tenantName),
      isDemo: true,
      locale: asShellLocale(data.locale),
    },
  };
}

export default function PublicChatShell({ widgetId }: { widgetId: string }) {
  const [state, setState] = useState<ShellState>({ kind: "loading" });
  const [chrome, setChrome] = useState<ShellChrome | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!widgetId) { setChrome(null); setState({ kind: "not_found" }); return; }
    let cancelled = false;
    setState({ kind: "loading" });
    setChrome(null);
    void (async () => {
      let next: ShellState;
      try {
        next = await readPublicConfig(widgetId);
      } catch {
        if (!cancelled) setState({ kind: "error" });
        return;
      }
      // The messages land BEFORE the state, so the page never paints one
      // language and swaps to another a frame later.
      const loaded = next.kind === "ready" ? await loadShellChrome(next.config.locale) : null;
      if (cancelled) return;
      setChrome(loaded);
      setState(next);
    })();
    return () => { cancelled = true; };
  }, [widgetId, attempt]);

  // Assistive tech reads the page in whatever the document claims to be in.
  useEffect(() => {
    if (chrome) document.documentElement.lang = chrome.locale;
  }, [chrome]);

  const body = <ShellBody state={state} onRetry={() => setAttempt((count) => count + 1)} />;

  // Nested on purpose: the outer provider is the visitor's locale, and this one
  // overrides it for the tenant's. When the messages could not be loaded the
  // outer provider stays in charge — a page in the wrong language still works.
  if (state.kind === "ready" && chrome) {
    return (
      <NextIntlClientProvider locale={chrome.locale} messages={chrome.messages}>
        {body}
      </NextIntlClientProvider>
    );
  }
  return body;
}

function ShellBody({ state, onRetry }: { state: ShellState; onRetry: () => void }) {
  const t = useTranslations("publicChat");

  const config = state.kind === "ready" ? state.config : null;
  const headline = config
    ? (config.agentName && config.tenantName
      ? t("title", { agentName: config.agentName, tenantName: config.tenantName })
      : config.agentName || config.tenantName || t("fallbackTitle"))
    : "";

  // The chat mounts once the frame exists. The loader reads the global, so it
  // is set BEFORE the script is appended; and React's strict mode runs this
  // effect twice in development, so the second pass must find the first script
  // rather than load the chat a second time.
  useEffect(() => {
    if (!config) return;
    document.title = headline;
    const target = window as Window & { __paralllyWidget?: ParalllyWidgetGlobal };
    target.__paralllyWidget = { widgetId: config.widgetId, mode: "page", host: `#${WIDGET_HOST_ID}` };
    if (document.querySelector(`script[${LOADER_ATTRIBUTE}]`)) return;
    const script = document.createElement("script");
    script.src = widgetLoaderUrl();
    script.async = true;
    script.setAttribute(LOADER_ATTRIBUTE, "");
    document.body.appendChild(script);
  }, [config, headline]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 text-neutral-900">
        <div role="status" aria-label={t("loading")}>
          <Loader2 size={28} aria-hidden="true" className="animate-spin text-indigo-500" />
        </div>
      </div>
    );
  }

  if (state.kind === "not_found" || state.kind === "error") {
    const notFound = state.kind === "not_found";
    const Icon = notFound ? MessageCircleOff : WifiOff;
    return (
      <div className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900">
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
              <Icon size={22} aria-hidden="true" className="text-neutral-500" />
            </div>
            <h1 className="text-base font-semibold text-neutral-900">
              {notFound ? t("notFoundTitle") : t("errorTitle")}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              {notFound ? t("notFoundHint") : t("errorHint")}
            </p>
            {!notFound && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 cursor-pointer"
              >
                {t("tryAgain")}
              </button>
            )}
          </div>
        </main>
        <PoweredBy label={t("madeWith")} />
      </div>
    );
  }

  return (
    // A definite height on purpose: the host is a flex child of a `h-dvh`
    // column, which is what lets the loader fill it with `height: 100%`. A
    // `min-height` alone would leave the host content-sized and the chat one
    // line tall.
    <div className="flex h-dvh min-h-dvh flex-col bg-neutral-50 text-neutral-900">
      <header className="shrink-0 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <h1 className="truncate text-base font-semibold text-neutral-900">{headline}</h1>
          {config?.isDemo && (
            <span className="shrink-0 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-0.5 text-[11px] font-medium text-neutral-600">
              {t("demoBadge")}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col sm:px-4 sm:py-4">
        <section
          id={WIDGET_HOST_ID}
          aria-label={t("chatRegionLabel", { agentName: config?.agentName || headline })}
          className="flex-1 min-h-[70vh] bg-white sm:rounded-2xl sm:border sm:border-neutral-200 sm:shadow-sm"
        />
      </main>

      <PoweredBy label={t("madeWith")} />
    </div>
  );
}

function PoweredBy({ label }: { label: string }) {
  return (
    <footer className="shrink-0 py-3 text-center text-xs text-neutral-400">
      <a
        href="https://parallly-chat.cloud"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-neutral-600 hover:underline"
      >
        {label}
      </a>
    </footer>
  );
}
