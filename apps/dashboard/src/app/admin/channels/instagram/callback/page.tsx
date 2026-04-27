"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

export default function InstagramCallback() {
    const t = useTranslations("channels");
    const [status, setStatus] = useState<"loading" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");

        if (error) {
            redirectWithResult("error", params.get("error_description") || error);
            return;
        }

        if (!code) {
            redirectWithResult("error", "Missing authorization code");
            return;
        }

        // Validate CSRF state (using localStorage since we're in the same browser)
        const state = params.get("state");
        const expectedState = localStorage.getItem("ig_oauth_state");
        localStorage.removeItem("ig_oauth_state");

        if (state && expectedState && state !== expectedState) {
            redirectWithResult("error", "Invalid state parameter");
            return;
        }

        // Exchange code via backend
        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) {
                    redirectWithResult("success");
                } else {
                    redirectWithResult("error", data.error || "Connection failed");
                }
            })
            .catch((err: any) => {
                setStatus("error");
                setErrorMessage(err.message);
                // Don't redirect automatically on error - let user see the error
            });
    }, []);

    function redirectWithResult(result: "success" | "error", message?: string) {
        const params = new URLSearchParams({ oauth_result: result });
        if (message) params.set("error_message", message);
        window.location.href = `/admin/channels/instagram?${params.toString()}`;
    }

    if (status === "error" && errorMessage) {
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

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
            <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-neutral-600 dark:text-neutral-400">{t("connectingInstagram")}</p>
            </div>
        </div>
    );
}
