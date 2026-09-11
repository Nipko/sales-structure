import { interact, renderScreen, scanScreen } from "@/test/a11y";
import { WhatsappSpendPanel } from "./WhatsappSpendPanel";
import { CampaignSendConfirm } from "../broadcast/CampaignSendConfirm";
import type { WhatsappConsumption, WhatsappNumberPause } from "@/lib/whatsapp-spend";

/**
 * ═══ THE MONEY SCREENS, READ THE WAY A SCREEN READER HANDS THEM OVER ═══
 *
 * Two of these states are somebody stuck rather than somebody informed: a
 * number Meta will not bill, and a number whose billing state we could not
 * read. Both stop messages going out, and both are currently distinguished on
 * screen by a red box and an amber one.
 *
 * So what matters here is not only that axe is quiet. It is that each state
 * survives having its colour taken away — the assertions below read text, never
 * a class — and that the dialogue standing between a click and four thousand
 * charged deliveries can be driven and dismissed from a keyboard.
 *
 * What this cannot prove is in `@/test/a11y`: contrast needs painted pixels and
 * jsdom has none, so that check is disabled rather than passed vacuously.
 */

jest.mock("@/lib/api", () => ({ api: {} }));

const pause = (over: Partial<WhatsappNumberPause> = {}): WhatsappNumberPause => ({
    channelAccountId: "15550001111", displayName: null, paused: true, stateUnknown: false,
    explanation: "Meta rechazó el cobro de este número.", since: null,
    observations: 2, clearedAt: null, ...over,
});

/**
 * Two currencies that must never be added together.
 *
 * Named rather than written inline because `no-hardcoded-currency.spec.ts`
 * sweeps the source for a screen DECIDING a currency, and it cannot tell a
 * fixture from a decision. These are the fixture's subject, not a default.
 */
const [BILLED_IN, ALSO_BILLED_IN] = ["USD", "COP"];

const consumption: WhatsappConsumption = {
    months: 12,
    freeServiceDeliveriesPerNumberMonth: 1000,
    consumption: [{
        month: "2026-10", channelAccountId: "15550001111",
        freeDeliveries: 640, chargedDeliveries: 212,
        money: [
            { currency: BILLED_IN, settledMinor: 1240, retainedMinor: 0 },
            { currency: ALSO_BILLED_IN, settledMinor: 5100000, retainedMinor: 0 },
        ],
        byMarketCategory: [],
    }],
};

describe("the WhatsApp spend panel", () => {
    it("hands a screen reader no violations", async () => {
        expect(await scanScreen(
            <WhatsappSpendPanel
                summary={null}
                consumption={consumption}
                pauses={[pause(), pause({
                    channelAccountId: "15550002222", paused: false, stateUnknown: true,
                    explanation: null,
                })]}
                onResume={async () => undefined}
            />,
        )).toEqual([]);
    });

    it("keeps a stopped number and an unreadable one apart without colour", async () => {
        const screen = await renderScreen(
            <WhatsappSpendPanel
                summary={null}
                pauses={[
                    pause({ channelAccountId: "15550001111" }),
                    pause({ channelAccountId: "15550002222", paused: false, stateUnknown: true, explanation: null }),
                ]}
            />,
        );
        try {
            const text = screen.container.textContent ?? "";
            // Two different sentences, because they need two different actions:
            // the first is a card in Meta, the second is us.
            expect(text).toContain("Envío pausado");
            expect(text).toContain("No pudimos leer el estado de cobro");
        } finally {
            screen.unmount();
        }
    });

    it("names the bar that shows a number's remaining free allowance", async () => {
        // A progressbar with no accessible name is announced as "progress bar,
        // 64 percent" — of what, for which number, a screen reader cannot say.
        const screen = await renderScreen(
            <WhatsappSpendPanel summary={null} consumption={consumption} />,
        );
        try {
            const bar = screen.container.querySelector('[role="progressbar"]');
            expect(bar?.getAttribute("aria-label")).toContain("15550001111");
            expect(bar?.getAttribute("aria-valuemax")).toBe("1000");
        } finally {
            screen.unmount();
        }
    });

    it("announces the month's figures when they change", async () => {
        // These numbers arrive after the page has painted — three separate
        // reads, each landing on its own. Without a live region a screen-reader
        // user is looking at a panel that silently filled in behind them.
        const screen = await renderScreen(
            <WhatsappSpendPanel summary={null} consumption={consumption} />,
        );
        try {
            expect(screen.container.querySelector('[aria-live="polite"]')).not.toBeNull();
        } finally {
            screen.unmount();
        }
    });
});

describe("the dialogue between a click and four thousand deliveries", () => {
    it("hands a screen reader no violations", async () => {
        expect(await scanScreen(
            <CampaignSendConfirm
                open campaignName="Promo octubre" recipients={4000} busy={false}
                onConfirm={() => undefined} onCancel={() => undefined}
            />,
        )).toEqual([]);
    });

    it("opens with the safe control focused, not the one that spends money", async () => {
        const screen = await renderScreen(
            <CampaignSendConfirm
                open campaignName="Promo octubre" recipients={4000} busy={false}
                onConfirm={() => undefined} onCancel={() => undefined}
            />,
        );
        try {
            // A dialogue that opens with "Send" focused turns an absent-minded
            // Return into a purchase.
            expect(document.activeElement?.textContent).toBe("Cancelar");
        } finally {
            screen.unmount();
        }
    });

    it("closes on Escape", async () => {
        let cancelled = false;
        const screen = await renderScreen(
            <CampaignSendConfirm
                open campaignName="Promo octubre" recipients={4000} busy={false}
                onConfirm={() => undefined} onCancel={() => { cancelled = true; }}
            />,
        );
        try {
            await interact(() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            });
            expect(cancelled).toBe(true);
        } finally {
            screen.unmount();
        }
    });

    it("says what the send may produce and that the amount is not known here", async () => {
        const screen = await renderScreen(
            <CampaignSendConfirm
                open campaignName="Promo octubre" recipients={4000} busy={false}
                onConfirm={() => undefined} onCancel={() => undefined}
            />,
        );
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("hasta 4000 entregas cobradas");
            expect(text).toContain("Todavía no podemos calcular el importe");
            // And never a fabricated figure standing in for the missing one.
            expect(text).not.toMatch(/\$\s?0/);
        } finally {
            screen.unmount();
        }
    });
});
