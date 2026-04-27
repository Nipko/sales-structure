"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

export default function InstagramCallback() {
    const t = useTranslations("channels");
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");

        if (error) {
            handleResult("error", params.get("error_description") || error);
            return;
        }

        if (!code) {
            handleResult("error", "Missing authorization code");
            return;
        }

        // Exchange code via backend
        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) {
                    handleResult("success");
                } else {
                    handleResult("error", data.error || "Connection failed");
                }
            })
            .catch((err: any) => {
                handleResult("error", err.message);
            });
    }, []);

    function handleResult(result: "success" | "error", message?: string) {
        setStatus(result);
        if (message) setErrorMessage(message);

        const payload = message
            ? { type: result === "success" ? "ig_oauth_success" : "ig_oauth_error", message }
            : { type: "ig_oauth_success" };

        // Try postMessage to opener (works if popup wasn't navigated)
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.postMessage(payload, window.location.origin);
                setTimeout(() => window.close(), 600);
                return;
            } catch (e) {
                // postMessage failed — fall through to redirect
            }
        }

        // Popup lost opener after navigation — redirect back after brief delay
        if (result === "success") {
            setTimeout(() => {
                window.location.href = "/admin/channels/instagram";
            }, 1500);
        }
    }

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
                <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
                    <p className="text-neutral-600 dark:text-neutral-400">{t("connectingInstagram")}</p>
                </div>
            </div>
        );
    }

    if (status === "success") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
                <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <p className="text-neutral-800 dark:text-neutral-200 font-semibold">{t("instagram.connectSuccess")}</p>
                    <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{t("instagram.redirecting")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
            <div className="text-center max-w-sm">
                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </div>
                <p className="text-neutral-800 dark:text-neutral-200 font-semibold">{t("instagram.connectFailed")}</p>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{errorMessage}</p>
                <a
                    href="/admin/channels/instagram"
                    className="inline-block mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium no-underline hover:bg-indigo-700 transition-colors"
                >
                    {t("instagram.backToSetup")}
                </a>
            </div>
        </div>
    );
}
