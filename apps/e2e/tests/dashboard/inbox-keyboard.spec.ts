import { expect, test } from "@playwright/test";
import { dashboardShell, readyBusiness } from "../../fixtures/dashboard-routes";
import { expectHermetic, hermeticDashboard, ok, settled, signIn } from "../../fixtures/dashboard-session";

const TENANT = "33333333-3333-4333-8333-333333333333";
const CONVERSATIONS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

// Real browser keyboard defaults, with the real page and a declared synthetic API.
// No provider, model or business write is part of selecting a conversation.
for (const viewport of [{ width: 319, height: 604 }, { width: 1280, height: 800 }]) {
  test.describe(`Inbox keyboard at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const key of ["Enter", "Space"]) {
      test(`${key} opens the focused conversation without an operator action`, async ({ page }) => {
        const state = await hermeticDashboard(page, {
          ...dashboardShell(TENANT), ...readyBusiness(TENANT),
          [`agent-console/inbox/${TENANT}`]: ok(CONVERSATIONS.map((id, index) => ({
            id, contactName: `QA Keyboard ${index ? "Two" : "One"}`, contactId: `contact-${index}`,
            status: "active", channel: "telegram", unreadCount: 1,
            lastMessage: "Synthetic keyboard fixture", lastMessageAt: "2026-10-15T08:00:00.000Z",
          }))),
          ...Object.fromEntries(CONVERSATIONS.flatMap((id, index) => [
            [`agent-console/conversation/${TENANT}/${id}`, ok({
              id, status: "active", contact: { id: `contact-${index}`, name: `QA Keyboard ${index ? "Two" : "One"}`, customFields: {} },
              messages: [], notes: [],
            })],
            [`conversations/${TENANT}/${id}/active-objects`, ok({ items: [] })],
          ])),
          [`tool-approvals/${TENANT}`]: ok([]),
        });
        await signIn(page, "tenant_admin");
        await page.goto("/admin/inbox");
        await settled(page);

        const action = page.getByRole("button", { name: "Abrir conversación con QA Keyboard Two", exact: true });
        await expect(action).toBeVisible();
        const composer = page.getByPlaceholder("Escribe un mensaje... (/ para respuestas rapidas)", { exact: true });
        if (viewport.width < 768) await expect(composer).toBeHidden();

        // Reach it with Tab, rather than forcing focus onto an otherwise unreachable row.
        await page.getByPlaceholder("Buscar conversaciones...", { exact: true }).focus();
        for (let step = 0; step < 5 && !(await action.evaluate(element => element === document.activeElement)); step++) {
          await page.keyboard.press("Tab");
        }
        await expect(action).toBeFocused();
        await page.keyboard.press(key);

        await expect(action).toHaveAttribute("aria-current", "true");
        await expect(composer).toBeVisible();
        await expect(composer).toHaveValue("");
        await expect.poll(() => state.observed.includes(`agent-console/conversation/${TENANT}/${CONVERSATIONS[1]}`)).toBe(true);
        expect(state.writes.filter(request => /agent-console|conversations|tool-approvals/.test(request))).toEqual([]);
        await expectHermetic(state);
      });
    }
  });
}
