import * as fs from "fs";
import * as path from "path";
import { findAccessibilityViolations, interact, renderScreen, scanScreen, setValue } from "@/test/a11y";
import type {
    DispatchReconciliationEntry,
    DispatchReconciliationQueue,
    DispatchRolloutState,
} from "@/lib/dispatch-operations";
import DispatchOperationsPage from "./page";

/**
 * The dispatch operations screen, scanned in the state an operator uses it in.
 *
 * This one earns a rendered test more than most: it is where a person decides
 * whether a message that may already have reached a customer gets sent again.
 * It is dense with the controls axe is actually good at judging — a switch, two
 * multi-select fieldsets, a search field, a data table, a radio group and two
 * confirm steps — and it was written as endpoints first and a screen second, so
 * nothing about its markup has ever been reviewed by anything but a person's
 * eye.
 *
 * Fixtures come from the module's own exported interfaces, so a contract change
 * breaks this file at `tsc` rather than quietly scanning an empty page.
 */

const rollout: DispatchRolloutState = {
    enabled: true,
    tenantIds: ["11111111-1111-4111-8111-111111111111"],
    channels: ["whatsapp", "telegram"],
    migratedChannels: ["whatsapp", "messenger", "instagram", "telegram"],
    effectiveChannels: ["whatsapp", "telegram"],
    ignoredChannels: [],
};

const entry = (index: number, overrides: Partial<DispatchReconciliationEntry> = {}): DispatchReconciliationEntry => ({
    id: `2222222${index}-2222-4222-8222-222222222222`,
    state: "reconciliation_required",
    conversationId: `3333333${index}-3333-4333-8333-333333333333`,
    inboundMessageId: `wamid.INBOUND${index}`,
    channelType: "whatsapp",
    channelAccountId: "573001112233",
    recipientHint: "•••• 2233",
    itemKind: "text",
    itemIndex: 0,
    attempts: 2,
    errorCode: "provider_timeout",
    receipt: null,
    settledLeaseToken: null,
    redacted: false,
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:05:00.000Z",
    ageSeconds: 5400,
    ...overrides,
});

const queue: DispatchReconciliationQueue = {
    entries: [entry(0), entry(1, { itemKind: "media", state: "reconciliation_required", ageSeconds: 120 })],
    backlog: { total: 2, oldestAgeSeconds: 5400, breachingSla: 1 },
    slaSeconds: 3600,
};

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getDispatchRollout: jest.fn(async () => ({ success: true, data: rolloutRef.current })),
        getTenants: jest.fn(async () => ({
            success: true,
            data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Peluquería Norte" }],
        })),
        getDispatchReconciliation: jest.fn(async () => ({ success: true, data: queueRef.current })),
        setDispatchRollout: jest.fn(async () => ({ success: true, data: rolloutRef.current })),
        disableDispatchRollout: jest.fn(async () => ({ success: true, data: rolloutRef.current })),
        resolveDispatchReconciliation: jest.fn(async () => ({ success: false, error: "not_called_in_this_test" })),
        exportDispatchResolutions: jest.fn(async () => ({ success: true, data: { rows: [] } })),
    },
}));

// Read through refs so a case can change what the mocked API answers without
// re-registering the module mock.
const rolloutRef = { current: rollout as DispatchRolloutState | null };
const queueRef = { current: queue as DispatchReconciliationQueue | null };

const TENANT = "11111111-1111-4111-8111-111111111111";

// Read from the message file rather than hardcoded, so renaming the button in
// Spanish fails this spec loudly instead of silently scanning the empty state.
const queueLoadLabel: string = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "messages", "es.json"), "utf8"),
).dispatchOperations.queue.load;

/** Picks a tenant and loads its queue, the way the operator reaches the table. */
async function openQueue(container: HTMLElement): Promise<void> {
    const select = container.querySelector<HTMLSelectElement>("#dispatch-queue-tenant");
    expect(select).not.toBeNull();
    await interact(() => setValue(select!, TENANT));
    const load = [...container.querySelectorAll("button")]
        .find((button) => !button.disabled && button.textContent?.includes(queueLoadLabel));
    expect(load).toBeDefined();
    await interact(() => load!.click());
}

describe("dispatch operations screen", () => {
    beforeEach(() => {
        rolloutRef.current = rollout;
        queueRef.current = queue;
    });

    it("has no violations with the rollout loaded", async () => {
        expect(await scanScreen(<DispatchOperationsPage />)).toEqual([]);
    });

    it("has no violations with an ignored channel on the switch", async () => {
        // The state an operator most needs to read: the switch names a channel
        // whose adapter cannot serve it, so the warning is on screen.
        rolloutRef.current = { ...rollout, channels: ["whatsapp", "sms"], ignoredChannels: ["sms"] };
        expect(await scanScreen(<DispatchOperationsPage />)).toEqual([]);
    });

    it("has no violations with the reconciliation queue open", async () => {
        const screen = await renderScreen(<DispatchOperationsPage />);
        try {
            await openQueue(screen.container);
            // Guards the guard: without the table this scan would grade the
            // page's emptiest state and still pass.
            expect(screen.container.querySelectorAll("table").length).toBeGreaterThan(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });
});
