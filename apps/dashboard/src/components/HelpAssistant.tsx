"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Compass, Loader2, Send, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import {
  buildHelpChatHistory,
  canUseHelpAssistantChat,
  HELP_CHAT_MESSAGE_MAX_LENGTH,
} from "@/lib/help-assistant-contract";
import {
  parseQualityAssistantDetail,
  qualityAssistantTarget,
  QUALITY_ASSIST_EVENT,
  type QualityAssistantOpenDetail,
  type QualityAssistantTarget,
} from "@/lib/quality-assistant-contract";
import { ParalllyAssistant } from "@/components/ParalllyAssistant";
import { canRunProductTourAtWidth } from "@/lib/product-tour-contract";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const ANNOUNCED_KEY = "parallly:assistant-announced";

const INTRO_SPARKS = [
  { sx: "-40px", sy: "-48px", delay: "120ms", cls: "size-1.5 bg-[#3897f0]" },
  { sx: "36px", sy: "-56px", delay: "260ms", cls: "size-2 bg-amber-400" },
  { sx: "-54px", sy: "-12px", delay: "400ms", cls: "size-1 bg-[#7ab9f5]" },
  { sx: "50px", sy: "-16px", delay: "540ms", cls: "size-1.5 bg-indigo-400" },
];

type IntroPhase = "hidden" | "enter" | "talk" | "done";
type ChatAction = {
  code: "open_quality_center" | "open_quality_action";
  labelKey: "openCenter" | "resolvePriority";
  href: string;
};
type ChatMessage = { role: "user" | "assistant"; content: string; actions?: ChatAction[] };

const useIntroLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The assistant is intentionally tenant-only. Platform users and users without
 * an effective tenant context have no authenticated Copilot endpoint, so they
 * must not see a launcher that cannot answer safely.
 */
export function HelpAssistant() {
  const { user } = useAuth();

  if (!canUseHelpAssistantChat(user)) return null;

  // Remount on tenant/session swaps so chat history and a quality target from
  // one tenant can never be replayed under another tenant's JWT context.
  return <TenantHelpAssistant key={user!.tenantId!} />;
}

function TenantHelpAssistant() {
  const t = useTranslations("helpAssistant");
  const locale = useLocale();
  const pathname = usePathname();
  const {
    canEditAgent,
    canEditKnowledge,
    canEditPipeline,
    canManageChannels,
    canManageSettings,
  } = useRole();
  const canRestartProductTour = canEditAgent && canManageChannels;

  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState<IntroPhase>("done");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: t("announce.body") },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [qualityTarget, setQualityTarget] = useState<QualityAssistantTarget>();
  const [qualityDetail, setQualityDetail] = useState<QualityAssistantOpenDetail>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const requestEpochRef = useRef(0);

  const resetToGenericContext = useCallback(() => {
    requestEpochRef.current += 1;
    setIsSending(false);
    setMessages([{ role: "assistant", content: t("announce.body") }]);
    setChatInput("");
    setQualityTarget(undefined);
    setQualityDetail(undefined);
  }, [t]);

  const openAssistant = () => {
    setIntro("done");
    if (qualityTarget) {
      resetToGenericContext();
    } else {
      setQualityTarget(undefined);
      setQualityDetail(undefined);
    }
    setOpen(true);
  };

  useIntroLayoutEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    try {
      if (typeof window === "undefined" || sessionStorage.getItem(ANNOUNCED_KEY)) return;
      if (canRunProductTourAtWidth(window.innerWidth)
        && localStorage.getItem("parallly:tour:pending") === "true") return;
    } catch {
      return;
    }

    const markAnnounced = () => {
      try {
        sessionStorage.setItem(ANNOUNCED_KEY, "1");
      } catch {
        // Storage can be unavailable in privacy-restricted browsers.
      }
    };
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      timers.push(setTimeout(() => {
        markAnnounced();
        setIntro("talk");
      }, 1200));
      timers.push(setTimeout(() => setIntro("done"), 10200));
    } else {
      setIntro("hidden");
      timers.push(setTimeout(() => {
        markAnnounced();
        setIntro("enter");
      }, 900));
      timers.push(setTimeout(() => setIntro("talk"), 1700));
      timers.push(setTimeout(() => setIntro("done"), 10000));
    }

    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("parallly:openCopilot")) {
        localStorage.removeItem("parallly:openCopilot");
        setIntro("done");
        resetToGenericContext();
        setOpen(true);
      }
    } catch {
      // Opening through the DOM event still works without local storage.
    }

    const handler = () => {
      setIntro("done");
      resetToGenericContext();
      setOpen(true);
    };
    window.addEventListener("parallly:open-copilot", handler);
    return () => window.removeEventListener("parallly:open-copilot", handler);
  }, [resetToGenericContext]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = parseQualityAssistantDetail((event as CustomEvent<unknown>).detail);
      if (!detail) return;
      requestEpochRef.current += 1;
      setIsSending(false);
      setIntro("done");
      setMessages([{ role: "assistant", content: t("announce.body") }]);
      setQualityDetail(detail);
      setQualityTarget(qualityAssistantTarget(detail));
      setChatInput(detail.prompt || (detail.agentName
        ? t("chat.quality.selectedAgent", { agent: detail.agentName })
        : t("chat.quality.explainPrompt")));
      setOpen(true);
    };
    window.addEventListener(QUALITY_ASSIST_EVENT, handler);
    return () => window.removeEventListener(QUALITY_ASSIST_EVENT, handler);
  }, [t]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim().slice(0, HELP_CHAT_MESSAGE_MAX_LENGTH);
    if (!text || isSending) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const requestEpoch = requestEpochRef.current;
    setMessages((current) => [...current, userMessage]);
    setChatInput("");
    setIsSending(true);

    try {
      const response = await api.copilotChat({
        message: text,
        page: pathname,
        locale,
        history: buildHelpChatHistory(messages),
        target: qualityTarget,
      });

      if (requestEpoch !== requestEpochRef.current) return;

      const content = response?.success && response.data?.reply
        ? response.data.reply
        : response?.error || t("chat.invalidResponse");
      const actions = response?.success && Array.isArray(response.data?.actions)
        ? response.data.actions.filter((action): action is ChatAction => (
          (action?.code === "open_quality_center" || action?.code === "open_quality_action")
          && (action?.labelKey === "openCenter" || action?.labelKey === "resolvePriority")
          && typeof action?.href === "string"
          && (action.href === "/admin" || action.href.startsWith("/admin/"))
          && !action.href.startsWith("//")
          && !action.href.includes("..")
        )).slice(0, 2)
        : undefined;
      setMessages((current) => [...current, { role: "assistant", content, actions }]);
    } catch (error) {
      if (requestEpoch !== requestEpochRef.current) return;
      console.error("Error calling copilotChat API:", error);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: t("chat.invalidResponse") },
      ]);
    } finally {
      if (requestEpoch === requestEpochRef.current) setIsSending(false);
    }
  };

  const renderFormattedText = (text: string) => text.split("\n").map((line, lineIndex) => {
    const trimmed = line.trim();
    const isListItem = trimmed.startsWith("- ") || trimmed.startsWith("* ");
    const isNumberedItem = /^\d+\.\s/.test(trimmed);
    const cleanLine = isListItem
      ? trimmed.substring(2)
      : isNumberedItem
        ? trimmed.replace(/^\d+\.\s/, "")
        : line;
    const parts = [];
    const inlinePattern = /(\*\*.*?\*\*|`.*?`)/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = inlinePattern.exec(cleanLine)) !== null) {
      const index = match.index;
      const matchedText = match[0];
      if (index > lastIndex) {
        parts.push(<span key={lastIndex}>{cleanLine.substring(lastIndex, index)}</span>);
      }
      if (matchedText.startsWith("**")) {
        parts.push(
          <strong key={index} className="font-extrabold text-neutral-900 dark:text-white">
            {matchedText.slice(2, -2)}
          </strong>,
        );
      } else {
        parts.push(
          <code
            key={index}
            className="rounded-md border border-neutral-200/30 bg-neutral-100 px-1 py-0.5 font-mono text-[10px] text-pink-600 dark:border-neutral-700/30 dark:bg-neutral-800 dark:text-pink-400"
          >
            {matchedText.slice(1, -1)}
          </code>,
        );
      }
      lastIndex = inlinePattern.lastIndex;
    }

    if (lastIndex < cleanLine.length) {
      parts.push(<span key={lastIndex}>{cleanLine.substring(lastIndex)}</span>);
    }

    if (isListItem || isNumberedItem) {
      return (
        <li
          key={lineIndex}
          className={`${isListItem ? "list-disc" : "list-decimal"} my-1 ml-4 pl-1 text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300`}
        >
          {parts}
        </li>
      );
    }

    return (
      <p
        key={lineIndex}
        className="my-1 min-h-[8px] text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300"
      >
        {parts}
      </p>
    );
  });

  const chatSuggestions = [
    qualityTarget ? t("chat.quality.firstPriority") : null,
    qualityTarget ? t("chat.quality.explainBlocker") : null,
    canManageChannels ? t("chat.suggestions.connectWhatsApp") : null,
    canEditPipeline ? t("chat.suggestions.leadScoring") : null,
    canEditKnowledge ? t("chat.suggestions.configureRag") : null,
    canManageSettings ? t("chat.suggestions.syncCalendar") : null,
  ].filter((suggestion): suggestion is string => Boolean(suggestion));
  const introMoving = intro === "enter" || intro === "talk";
  const showAnnouncement = intro === "talk" && !open;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          onClick={openAssistant}
          aria-label={t("launcherTooltip")}
          className={`group fixed bottom-4 right-4 z-40 flex cursor-pointer items-end justify-center drop-shadow-[0_6px_18px_rgba(56,151,240,0.35)] transition-[transform,opacity] duration-300 hover:scale-105 active:scale-95 sm:right-6 ${
            intro === "hidden" ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <span
            className={`absolute bottom-full right-0 mb-3 w-64 flex-col gap-1 rounded-2xl border border-[#3897f0]/25 bg-white/95 p-3.5 text-left shadow-2xl shadow-[#3897f0]/15 backdrop-blur-md dark:bg-neutral-900/95 ${
              showAnnouncement ? "parallly-bubble-in flex" : "hidden"
            }`}
          >
            <span className="flex items-center gap-1.5 text-[12px] font-extrabold text-neutral-900 dark:text-white">
              <Sparkles className="size-3.5 animate-pulse text-[#3897f0]" />
              {t("announce.title")}
            </span>
            <span className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
              {t("announce.body")}
            </span>
            <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full bg-[#3897f0]/10 px-2.5 py-1 text-[10px] font-bold text-[#2b7cd4] dark:text-[#7ab9f5]">
              {t("announce.cta")} <ChevronRight className="size-2.5" />
            </span>
            <span className="absolute -bottom-1.5 right-9 size-3 rotate-45 border-b border-r border-[#3897f0]/25 bg-white/95 dark:bg-neutral-900/95" />
          </span>

          <span className="absolute bottom-full right-0 mb-1 scale-0 whitespace-nowrap rounded-lg border border-white/10 bg-neutral-950 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-xl transition-transform duration-200 group-hover:scale-100 dark:bg-neutral-100 dark:text-neutral-900">
            {t("launcherTooltip")}
          </span>

          <span className={`relative flex items-end justify-center ${introMoving ? "parallly-pop" : ""}`}>
            {introMoving && (
              <>
                <span className="parallly-ring pointer-events-none absolute bottom-4 left-1/2 -ml-8 size-16 rounded-full border-2 border-[#3897f0]/50" />
                {INTRO_SPARKS.map((spark, index) => (
                  <span
                    key={index}
                    className={`parallly-spark pointer-events-none absolute bottom-8 left-1/2 rounded-full ${spark.cls}`}
                    style={{
                      animationDelay: spark.delay,
                      "--sx": spark.sx,
                      "--sy": spark.sy,
                    } as CSSProperties}
                  />
                ))}
              </>
            )}
            <ParalllyAssistant size={74} state={introMoving ? "wave" : "idle"} />
          </span>
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex h-full w-full flex-col overflow-hidden border-l border-neutral-200/70 bg-white p-0 sm:max-w-md dark:border-neutral-800/70 dark:bg-neutral-950"
      >
        <SheetHeader className="shrink-0 border-b border-neutral-200/50 px-6 py-5 text-left dark:border-neutral-800/50">
          <SheetTitle className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="size-4 text-[#3897f0]" />
            {t("drawerTitle")}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {t("drawerSubtitle")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-50/10 dark:bg-neutral-950/10">
          <div className="flex flex-1 flex-col space-y-4 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-neutral-200 dark:scrollbar-thumb-neutral-800">
            {qualityDetail && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100" role="status">
                <p className="text-[11px] font-bold">{t("chat.quality.contextTitle")}</p>
                <p className="mt-1 text-[11px] leading-relaxed">{t("chat.quality.contextDescription")}</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`max-w-[85%] ${message.role === "user" ? "self-end" : "self-start"}`}
              >
                <div
                  className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-xs ${
                    message.role === "user"
                      ? "rounded-tr-none border border-white/5 bg-linear-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/10 dark:from-indigo-500 dark:to-purple-500"
                      : "rounded-tl-none border border-neutral-200/50 bg-white text-neutral-800 shadow-2xs dark:border-neutral-800/50 dark:bg-neutral-900 dark:text-neutral-200"
                  }`}
                >
                  {message.role === "user" ? message.content : renderFormattedText(message.content)}
                </div>
                {message.role === "assistant" && message.actions && message.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.actions.map((action) => (
                      <Link
                        key={`${index}-${action.code}-${action.href}`}
                        href={action.href}
                        onClick={() => setOpen(false)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                      >
                        {t(`chat.quality.actions.${action.labelKey}`)} <ChevronRight className="size-2.5" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isSending && (
              <div className="flex max-w-[85%] items-center gap-1.5 self-start rounded-2xl rounded-tl-none border border-neutral-200/50 bg-white py-1.5 pl-2 pr-4 text-xs text-neutral-400 shadow-2xs dark:border-neutral-800/50 dark:bg-neutral-900 dark:text-neutral-500">
                <ParalllyAssistant size={30} state="think" />
                <span className="animate-pulse text-[10px]">{t("chat.typing")}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {chatSuggestions.length > 0 && (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-neutral-200/30 bg-neutral-50/20 px-6 py-2 scrollbar-none dark:border-neutral-800/30 dark:bg-neutral-950/20">
              {chatSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void sendMessage(suggestion)}
                  disabled={isSending}
                  className="cursor-pointer whitespace-nowrap rounded-full border border-neutral-200/50 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-neutral-600 shadow-2xs transition-all hover:border-indigo-500/30 hover:bg-indigo-500/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800/50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/5"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <div className="shrink-0 border-t border-neutral-200/50 bg-neutral-50 p-4 dark:border-neutral-800/50 dark:bg-neutral-900/50">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(chatInput);
              }}
              className="relative flex items-center gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                maxLength={HELP_CHAT_MESSAGE_MAX_LENGTH}
                disabled={isSending}
                placeholder={t("chat.inputPlaceholder")}
                className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-4 pr-12 text-xs text-neutral-900 transition-all placeholder:text-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white"
              />
              <button
                type="submit"
                aria-label={t("chat.inputPlaceholder")}
                disabled={isSending || !chatInput.trim()}
                className="absolute right-1.5 cursor-pointer rounded-lg bg-indigo-600 p-2 text-white transition-all hover:scale-105 hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 dark:bg-indigo-500"
              >
                {isSending
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <Send className="size-3.5" />}
              </button>
            </form>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-200/50 bg-neutral-50 p-4 dark:border-neutral-800/50 dark:bg-neutral-900/50">
          {canRestartProductTour && (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new Event("parallly:start-tour"));
                setOpen(false);
              }}
              className="hidden cursor-pointer items-center gap-1 text-[10px] font-bold text-indigo-600 hover:underline md:flex dark:text-indigo-400"
            >
              <Compass className="size-2.5" /> {t("footer.restartTour")}
            </button>
          )}
          <a
            href="https://parallly-chat.cloud/support"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {t("footer.support")} <ChevronRight className="size-2.5" />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
