"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { LogOut, Eye, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { broadcastAuthSessionSwap } from "@/lib/auth-session-sync";

interface ImpersonationState {
  originalAccessToken: string;
  originalRefreshToken: string;
  originalUser: string;
  tenantName: string;
  tenantId?: string;
  sessionId?: string;
  impersonatedUserId?: string;
}

export default function ImpersonationBanner() {
  const t = useTranslations("tenants");
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("impersonation");
      if (raw) {
        setImpersonation(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }, []);

  if (!impersonation) return null;

  const handleExit = async () => {
    setExiting(true);

    // Restore the operator's own tokens FIRST so the close-out call is made as
    // the real super_admin, then tell the server the session is over. A start
    // with no end leaves the exposure window of a privileged session unbounded.
    if (impersonation.originalAccessToken) {
      localStorage.setItem("accessToken", impersonation.originalAccessToken);
    }
    if (impersonation.originalRefreshToken) {
      localStorage.setItem("refreshToken", impersonation.originalRefreshToken);
    }
    if (impersonation.originalUser) {
      localStorage.setItem("user", impersonation.originalUser);
    }

    if (impersonation.tenantId) {
      try {
        await api.exitImpersonation({
          tenantId: impersonation.tenantId,
          sessionId: impersonation.sessionId,
          impersonatedUserId: impersonation.impersonatedUserId,
        });
      } catch {
        // Never trap the operator in an impersonated session over a failed
        // audit write — the token expires within the hour regardless.
      }
    }

    localStorage.removeItem("impersonation");
    localStorage.removeItem("verticalConfig");
    broadcastAuthSessionSwap("/admin/tenants");
    window.location.href = "/admin/tenants";
  };

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-amber-500 text-neutral-900 text-sm font-medium shrink-0">
      <Eye size={16} />
      <span>{t("impersonation.banner", { name: impersonation.tenantName })}</span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="ml-2 flex items-center gap-1.5 px-3 py-1 rounded-md bg-neutral-900/20 text-neutral-900 text-xs font-semibold cursor-pointer border-none hover:bg-neutral-900/30 disabled:opacity-60 transition-colors"
      >
        {exiting ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
        {t("impersonation.exit")}
      </button>
    </div>
  );
}
