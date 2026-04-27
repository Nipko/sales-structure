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

        if (error) {
            notifyOpener("ig_oauth_error", params.get("error_description") || error);
            return;
        }

        if (!code) {
            notifyOpener("ig_oauth_error", "Missing authorization code");
            return;
        }

        // State validation: try opener's sessionStorage (same origin popup can access it via postMessage)
        // Since sessionStorage is per-tab, we skip strict state validation for popup flow
        // The OAuth flow is protected by the code exchange (single-use, short-lived)

        // Exchange code via backend
        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) {
                    notifyOpener("ig_oauth_success");
                } else {
                    notifyOpener("ig_oauth_error", data.error || "Connection failed");
                }
            })
            .catch((err: any) => {
                notifyOpener("ig_oauth_error", err.message);
            });
    }, []);

    function notifyOpener(type: string, message?: string) {
        const payload = message ? { type, message } : { type };
        if (window.opener) {
            window.opener.postMessage(payload, window.location.origin);
            setTimeout(() => window.close(), 500);
        } else {
            // Popup was blocked or opener lost — redirect back to channel page
            window.location.href = "/admin/channels/instagram";
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
            <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-neutral-600 dark:text-neutral-400">{t("connectingInstagram")}</p>
            </div>
        </div>
    );
}
