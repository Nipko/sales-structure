"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

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
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState("");
    const startedRef = useRef(false);
    const settledRef = useRef(false);
    const deadlineRef = useRef<number | null>(null);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        /** The one outcome. A late reply cannot overwrite what was already said. */
        const finish = (result: "success" | "error", message?: string) => {
            if (settledRef.current) return;
            settledRef.current = true;
            if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
            setStatus(result);
            if (message) setErrorMessage(message);

            // `window.opener` is lost across the redirect, so the result travels
            // over a channel the opening screen is already listening on.
            try {
                const channel = new BroadcastChannel("ig_oauth");
                channel.postMessage(
                    message
                        ? { type: result === "success" ? "ig_oauth_success" : "ig_oauth_error", message }
                        : { type: "ig_oauth_success" }
                );
                channel.close();
            } catch {
                // BroadcastChannel not supported — opener will reload on focus
            }

            setTimeout(() => window.close(), 800);
        };

        deadlineRef.current = window.setTimeout(
            () => finish("error", t("instagram.connectTimeout")),
            EXCHANGE_TIMEOUT_MS,
        );

        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");

        if (error) {
            finish("error", params.get("error_description") || error);
            return;
        }

        if (!code) {
            finish("error", "Missing authorization code");
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
            finish("error", t("instagram.connectAlreadyUsed"));
            return;
        }
        sessionStorage.setItem(codeKey, "1");

        // Validate OAuth state parameter (CSRF protection)
        const returnedState = params.get("state");
        const savedState = localStorage.getItem("ig_oauth_state");
        if (!returnedState || !savedState || returnedState !== savedState) {
            finish("error", "Invalid OAuth state — possible CSRF attack. Please try again.");
            return;
        }
        localStorage.removeItem("ig_oauth_state");

        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) finish("success");
                else finish("error", data.error || data.message || "Connection failed");
            })
            .catch((err: any) => finish("error", err.message));

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
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
                <div className="text-center max-w-xs">
                    <div className="w-12 h-12 rounded-full bg-red-900/40 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <p className="text-white font-semibold text-sm">{t("instagram.connectFailed")}</p>
                    <p className="text-neutral-500 text-xs mt-1">{errorMessage}</p>
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
