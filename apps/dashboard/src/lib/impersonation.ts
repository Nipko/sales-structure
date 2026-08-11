import { api } from "@/lib/api";
import { broadcastAuthSessionSwap } from "@/lib/auth-session-sync";

/**
 * Start an act-as session on a tenant.
 *
 * Swaps the operator's tokens for the short-lived impersonation pair and keeps
 * everything the exit path needs: the originals to restore, plus the session
 * identifiers so the closing audit row pairs with the opening one and the
 * impersonated refresh token can be revoked on the way out.
 *
 * Shared by the tenant list and the tenant detail page so both escalate through
 * exactly the same gate.
 */
export async function startImpersonation(
    tenant: { id: string; name: string },
    access: { reason: string; ticketId?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await api.impersonateTenant(tenant.id, access);
    if (!result.success || !result.data) {
        return { ok: false, error: (result as any).error || "Impersonation failed" };
    }

    const data = result.data as any;
    localStorage.setItem("impersonation", JSON.stringify({
        originalAccessToken: localStorage.getItem("accessToken"),
        originalRefreshToken: localStorage.getItem("refreshToken"),
        originalUser: localStorage.getItem("user"),
        tenantName: tenant.name,
        tenantId: tenant.id,
        sessionId: data.sessionId,
        impersonatedUserId: data.user?.id,
    }));

    if (data.accessToken) localStorage.setItem("accessToken", data.accessToken);
    if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
    // The session must carry the tenant identity, otherwise the UI stays in
    // platform mode while holding a tenant token and no page resolves a tenant.
    if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
    // Vertical capabilities belong to the tenant being viewed. Never carry a
    // previous tenant's menu contract into an impersonated workspace.
    localStorage.removeItem("verticalConfig");

    broadcastAuthSessionSwap("/admin");
    window.location.href = "/admin";
    return { ok: true };
}
