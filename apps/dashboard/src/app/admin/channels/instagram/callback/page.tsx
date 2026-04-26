"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

export default function InstagramCallback() {
    const t = useTranslations("channels");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");
        const error = params.get("error");

        // Validate state
        const expectedState = sessionStorage.getItem("ig_oauth_state");
        sessionStorage.removeItem("ig_oauth_state");

        if (error) {
            window.opener?.postMessage(
                { type: "ig_oauth_error", message: params.get("error_description") || error },
                window.location.origin
            );
            window.close();
            return;
        }

        if (!code || state !== expectedState) {
            window.opener?.postMessage(
                { type: "ig_oauth_error", message: "Invalid state or missing code" },
                window.location.origin
            );
            window.close();
            return;
        }

        // Exchange code via backend
        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) {
                    window.opener?.postMessage({ type: "ig_oauth_success" }, window.location.origin);
                } else {
                    window.opener?.postMessage(
                        { type: "ig_oauth_error", message: data.error || "Connection failed" },
                        window.location.origin
                    );
                }
            })
            .catch((err: any) => {
                window.opener?.postMessage(
                    { type: "ig_oauth_error", message: err.message },
                    window.location.origin
                );
            })
            .finally(() => {
                window.close();
            });
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
            <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-neutral-600 dark:text-neutral-400">{t("connectingInstagram")}</p>
            </div>
        </div>
    );
}
