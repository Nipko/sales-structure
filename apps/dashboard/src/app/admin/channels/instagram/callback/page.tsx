"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { META_CONNECT_ERROR } from "@parallext/shared";
import {
    connectFailureForCode,
    readConnectErrorCode,
    readConnectEvidence,
    type ChannelConnectFailure,
    type ConnectErrorCode,
} from "../../_components/connect-errors";

/**
 * How long the popup waits for the token exchange before saying something.
 *
 * There was no limit. The exchange goes to our API, which goes to Meta, and if
 * either stalls the popup spins forever: no message, no retry, no hint that the
 * window can be closed — and the screen that opened it waiting for a result
 * never posted. Nothing in `api.ts` sets a deadline, so this one lives here
 * rather than there, where a global timeout would change every call in the
 * product to fix one window.
 *
 * Generous on purpose: an exchange that takes twelve seconds is slow, not
 * broken, and reporting a failure over a connection that then succeeds is the
 * worse of the two mistakes. That is also why the message says we could not
 * confirm it, and sends the person to look, instead of saying it failed.
 */
const EXCHANGE_TIMEOUT_MS = 20_000;

/**
 * The window that comes back from Instagram authorization.
 *
 * One authorization code, one outcome, one window — and the whole difficulty is
 * that React does not promise to run an effect exactly once. In development it
 * mounts every effect twice on purpose, and a remount would do the same in
 * production. The run is therefore owned by refs rather than by an effect
 * closure: a second run finds the work already started and leaves both the
 * exchange and its deadline alone, instead of cancelling the first run and
 * stranding the window on a spinner.
 *
 * `sessionStorage` still guards the other repetition — a reload, which gets a
 * fresh component and fresh refs but must not spend the code twice.
 */
export default function InstagramCallback() {
    const t = useTranslations("channels");
    const te = useTranslations("channels.instagram.errors");
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [failure, setFailure] = useState<ChannelConnectFailure | null>(null);
    const startedRef = useRef(false);
    const settledRef = useRef(false);
    const deadlineRef = useRef<number | null>(null);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        /**
         * The one outcome. A late reply cannot overwrite what was already said.
         *
         * What travels is a CODE, not a sentence. This window used to post
         * whatever string it happened to hold — Meta's `error_description`,
         * "Missing authorization code", a paragraph about a CSRF attack — and
         * the screen underneath printed it verbatim: English prose in all four
         * locales, blaming the person, with nothing to press.
         */
        const finish = (result: "success" | "error", errorCode?: ConnectErrorCode | null) => {
            if (settledRef.current) return;
            settledRef.current = true;
            if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
            setStatus(result);
            if (result === "error") {
                setFailure(connectFailureForCode("instagram", errorCode ?? undefined));
            }

            // `window.opener` is lost across the redirect, so the result travels
            // over a channel the opening screen is already listening on.
            try {
                const channel = new BroadcastChannel("ig_oauth");
                channel.postMessage(
                    result === "error"
                        ? { type: "ig_oauth_error", code: errorCode ?? null }
                        : { type: "ig_oauth_success" }
                );
                channel.close();
            } catch {
                // BroadcastChannel not supported — opener will reload on focus
            }

            setTimeout(() => window.close(), 800);
        };

        deadlineRef.current = window.setTimeout(() => finish("error", "timeout"), EXCHANGE_TIMEOUT_MS);

        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");

        if (error) {
            // Instagram denies with `access_denied`/`user_denied`; anything else
            // is a provider-side problem we cannot name, and neither can the
            // person. Both end in the same one action, so both get a card.
            console.error("[InstagramCallback] Authorization refused:", error, params.get("error_reason"));
            finish("error", error === "access_denied" || params.get("error_reason") === "user_denied"
                ? META_CONNECT_ERROR.WINDOW_CANCELLED
                : META_CONNECT_ERROR.UNAVAILABLE);
            return;
        }

        if (!code) {
            // No authorization came back: the window closed before the end.
            finish("error", META_CONNECT_ERROR.WINDOW_CANCELLED);
            return;
        }

        // A code is spent once, and this check comes BEFORE the CSRF pair is
        // consumed. It used to come after: the state was validated and deleted
        // immediately, so a second run found nothing saved and accused the
        // person of a CSRF attack over a connection that had just succeeded.
        const codeKey = `ig_code_used_${code.slice(0, 16)}`;
        if (sessionStorage.getItem(codeKey)) {
            // A reload of a window whose code was already exchanged. Saying so
            // is the honest answer; spinning until the deadline would report a
            // timeout for something that already finished.
            finish("error", "already_used");
            return;
        }
        sessionStorage.setItem(codeKey, "1");

        // Validate OAuth state parameter (CSRF protection). The person reading
        // this did not mount an attack and cannot act on the word "CSRF": what
        // they get is the one thing that works, which is starting again.
        const returnedState = params.get("state");
        const savedState = localStorage.getItem("ig_oauth_state");
        if (!returnedState || !savedState || returnedState !== savedState) {
            console.error("[InstagramCallback] OAuth state did not match the one this browser saved.");
            finish("error", "session_mismatch");
            return;
        }
        localStorage.removeItem("ig_oauth_state");

        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) {
                    finish("success");
                    return;
                }
                // Evidence is for the console. It is where Meta's own wording
                // lives, which is exactly what must not reach the screen.
                console.error("[InstagramCallback] Exchange refused:", readConnectEvidence(data) ?? data);
                finish("error", readConnectErrorCode(data) ?? META_CONNECT_ERROR.TOKEN_EXCHANGE_FAILED);
            })
            .catch((err: any) => {
                console.error("[InstagramCallback] Exchange failed:", err);
                finish("error", META_CONNECT_ERROR.UNAVAILABLE);
            });

        // No cleanup that cancels: the exchange belongs to the window, not to
        // this effect run. Unmounting mid-exchange would leave the code spent
        // and nobody told.
        // `t` is stable for the life of this window; listing it would re-run
        // the effect on a locale change, and the guard above would then answer
        // a fresh authorization as if it had already been used.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (status === "success") {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
                <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-green-900/40 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <p className="text-white font-semibold text-sm">{t("instagram.connectSuccess")}</p>
                    <p className="text-neutral-500 text-xs mt-2">{t("instagram.closeWindow")}</p>
                </div>
            </div>
        );
    }

    if (status === "error") {
        // Same title-and-one-action card as the screen underneath, minus the
        // buttons: this window cannot reopen Meta, and the one action is waiting
        // on the page that opened it.
        const cardKey = failure?.key ?? "generic";
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
                <div role="alert" className="text-center max-w-xs">
                    <div className="w-12 h-12 rounded-full bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                        </svg>
                    </div>
                    <p className="text-white font-semibold text-sm">{te(`${cardKey}.title`)}</p>
                    <p className="text-neutral-400 text-xs mt-1.5 leading-relaxed">{te(`${cardKey}.action`)}</p>
                    <p className="text-neutral-600 text-xs mt-3">{t("instagram.closeWindow")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
            <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-neutral-400 text-sm">{t("connectingInstagram")}</p>
            </div>
        </div>
    );
}
