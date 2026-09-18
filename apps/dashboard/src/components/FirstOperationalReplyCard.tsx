"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { readSetupStatusFacts } from "@/lib/onboarding-guide";

const POLL_MS = 15_000;

export default function FirstOperationalReplyCard({
  tenantId,
  agentName,
  connectedChannelTypes,
  onVerified,
}: {
  tenantId: string;
  agentName?: string | null;
  connectedChannelTypes: readonly string[];
  onVerified: (at: string) => void;
}) {
  const t = useTranslations("qualityHealth.setup.firstReply");
  const tc = useTranslations("setupWizard.connect");
  const locale = useLocale();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const running = useRef(false);

  const channelNames = useMemo(() => connectedChannelTypes.map((channel) => {
    const key = `channel_${channel}`;
    return tc.has(key) ? tc(key as any) : channel;
  }), [connectedChannelTypes, tc]);
  const channels = channelNames.length > 0
    ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(channelNames)
    : t("channelFallback");

  const verify = useCallback(async (visible = false) => {
    if (running.current || verifiedAt) return;
    running.current = true;
    if (visible) setChecking(true);
    try {
      const facts = readSetupStatusFacts(await api.getSetupStatus(tenantId));
      if (facts?.firstReplyAt) setVerifiedAt(facts.firstReplyAt);
      else if (visible) setChecked(true);
    } catch {
      if (visible) setChecked(true);
    } finally {
      running.current = false;
      if (visible) setChecking(false);
    }
  }, [tenantId, verifiedAt]);

  useEffect(() => {
    void verify(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void verify(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [verify]);

  useEffect(() => {
    if (!verifiedAt) return;
    const timer = window.setTimeout(() => onVerified(verifiedAt), 1_500);
    return () => window.clearTimeout(timer);
  }, [onVerified, verifiedAt]);

  return (
    <section className="mb-8 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/[0.07]" aria-labelledby="first-operational-reply-title">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${verifiedAt ? "bg-emerald-600" : "bg-indigo-600"}`}>
          {verifiedAt ? <Check size={19} aria-hidden="true" /> : <MessageSquare size={19} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="first-operational-reply-title" className="text-base font-semibold text-foreground">
            {verifiedAt ? t("verifiedTitle") : t("title", { agent: agentName || t("agentFallback") })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {verifiedAt ? t("verifiedDescription") : t("description", { channels })}
          </p>
          {!verifiedAt && (
            <>
              <ol className="mt-3 space-y-1.5 text-sm text-foreground">
                <li>{t("stepSend")}</li>
                <li>{t("stepWait")}</li>
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">{checked ? t("notSeen") : t("evidence")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void verify(true)} disabled={checking}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {checking ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                  {t("check")}
                </button>
                <Link href="/admin/inbox" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                  {t("openInbox")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
