import { expect, test } from "@playwright/test";
import { dashboardShell, disabledAgentTools } from "../../fixtures/dashboard-routes";
import { expectHermetic, hermeticDashboard, ok, settled, signIn } from "../../fixtures/dashboard-session";

const TENANT = "33333333-3333-4333-8333-333333333333";
const AGENT = "77777777-7777-4777-8777-777777777777";
const AGENT_NAME = "QA Ayuda";
const HELP_TITLE = "¿Cómo gestionar tus Agentes IA?";

// Real page, motion/AnimatePresence and native keyboard, against the existing
// hermetic synthetic API. No production session, model, tour or configuration
// write. The normal transition must mount its focus target before focusing it;
// the jsdom animation stand-in cannot demonstrate that sequence.
for (const viewport of [{ width: 319, height: 604 }, { width: 1280, height: 800 }]) {
  test.describe(`Context help keyboard at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, reducedMotion: "no-preference" });

    test("Enter opens help, focuses its named close and restores focus after collapse", async ({ page }) => {
      const state = await hermeticDashboard(page, {
        ...dashboardShell(TENANT),
        // The agent list's empty-state early return has no contextual HelpPanel.
        // A declared existing synthetic agent is therefore a prerequisite for
        // this control, independently of the live session's day-zero status.
        [`persona/${TENANT}/agents`]: ok([{
          id: AGENT, name: AGENT_NAME, is_active: true, is_default: true,
          version: 1, channels: [], schedule_mode: "24/7",
          config_json: { _personalizedAt: "2026-10-15T12:00:00.000Z" },
        }]),
        [`persona/${TENANT}/plan-features`]: ok({ maxAgents: 3, templates: false, customPrompt: false }),
        [`persona/${TENANT}/tool-configuration-summary`]: ok(disabledAgentTools(1)),
        // One synthetic current snapshot prevents a shell bootstrap; this is
        // declared CI data, not a model evaluation or a production fixture.
        [`quality/${TENANT}/attention-summary`]: ok({
          generatedAt: "2026-10-16T07:00:00.000Z", worstStatus: "ready_for_pilot",
          agentsTotal: 1, evaluatedAgents: 1, agentsNeedingAttention: 0,
          openCritical: 0, openHigh: 0, attentionCount: 0,
          agents: [{ id: AGENT, name: AGENT_NAME, version: 1, status: "ready_for_pilot", criticalCount: 0, highCount: 0 }],
        }),
        "channels/overview": ok([]),
        [`analytics/navigation-telemetry/${TENANT}`]: ok({ recorded: true }),
      });
      await signIn(page, "tenant_admin", { onboardingStage: "live" });
      await page.goto("/admin/agent");
      expect(await settled(page)).toBe("shell");
      await expect(page).toHaveURL(/\/admin\/agent(?:\?|$)/);

      await expect(page.getByText(AGENT_NAME, { exact: true })).toBeVisible();
      const trigger = page.getByRole("button", { name: HELP_TITLE, exact: true });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      // Begin on the preceding real page control. Tab must reach the help
      // trigger; the test never forces focus onto either target under test.
      await page.getByRole("button", { name: "Nuevo agente", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");

      const region = page.getByRole("region", { name: HELP_TITLE, exact: true });
      const close = region.getByRole("button", { name: "Cerrar", exact: true });
      await expect(region).toBeVisible();
      await expect(close).toBeVisible();
      await expect(close).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(region).toBeHidden();
      // Auto-retrying focus assertions observe the real animated unmount/mount,
      // with no fixed sleep or assumption that motion finished in one frame.
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      // These are the shell's declared bookkeeping calls. Everything that
      // would chat, start a tour, create an agent or change its mode is absent.
      const bookkeeping = new Set([
        "POST auth/activity-ping", "POST auth/refresh",
        `POST analytics/navigation-telemetry/${TENANT}`,
        `POST persona/${TENANT}/onboarding-events`,
      ]);
      expect(state.writes.filter(request => !bookkeeping.has(request))).toEqual([]);
      expect(state.observed.filter(request => request.startsWith("copilot/"))).toEqual([]);
      await expect(page.locator('[data-testid="guided-tour-card"], [role="dialog"][aria-modal="false"]')).toHaveCount(0);
      await expectHermetic(state);
    });
  });
}
