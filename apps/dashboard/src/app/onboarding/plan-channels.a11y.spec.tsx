import * as fs from "fs";
import * as path from "path";
import { NextIntlClientProvider } from "next-intl";
import { renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import OnboardingPage from "./page";
import PlanChannels from "./_components/PlanChannels";

jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/LocaleSwitcher", () => ({ __esModule: true, default: () => null }));
jest.mock("@/lib/api", () => ({ api: {
    getBillingMarket: jest.fn(), getPublicBillingPlans: jest.fn(), getVerticalDefinitions: jest.fn(),
} }));

describe("onboarding names the channels in the runtime plan catalog", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it("shows each plan's own certified channel names in its selection label", async () => {
        localStorage.setItem('accessToken', 'local-test-token');
        localStorage.setItem('user', JSON.stringify({ id: 'new-user' }));
        localStorage.setItem('parallly:onboarding:draft:new-user', JSON.stringify({
            savedAt: Date.now(), step: 3, companyName: 'Example', about: 'Homes for sale', industry: 'inmobiliaria', orgSize: '1-10',
            audiences: ['buyers'], goals: ['lead_qualification'],
        }));
        sessionStorage.setItem('pricingIntent', JSON.stringify({ plan: 'emprendedor', country: 'CO' }));
        const base = {
            priceUsdCents: 2100, displayPriceCents: 8000000, displayCurrency: 'COP', trialDays: 7,
            requiresCardForTrial: false, requiresPaymentMethodAtSignup: false, providerConfigured: true,
            maxAgents: 1, maxAiMessages: 1000, signupAvailable: true, trialAvailable: true,
            monthlyAvailable: true, annualAvailable: false, checkoutMode: 'self_serve',
        };
        (api.getBillingMarket as jest.Mock).mockResolvedValue({ success: true, data: { country: 'CO', supportedCountries: ['CO'] } });
        (api.getPublicBillingPlans as jest.Mock).mockResolvedValue({ success: true, data: [
            { ...base, slug: 'emprendedor', name: 'Emprendedor', features: { channels: ['whatsapp', 'web_widget'] } },
            { ...base, slug: 'starter', name: 'Starter', features: { channels: ['telegram', 'instagram', 'messenger', 'sms', 'email', 'telegram', 42] } },
        ] });
        (api.getVerticalDefinitions as jest.Mock).mockResolvedValue({ success: true, data: {
            inmobiliaria: [], ...Object.fromEntries(Array.from({ length: 19 }, (_, index) => [`fixture-${index}`, []])),
        } });
        const screen = await renderScreen(<OnboardingPage />);
        try {
            const options = [...screen.container.querySelectorAll<HTMLInputElement>('input[name="plan"]')];
            expect(options).toHaveLength(2);
            const [emprendedor, starter] = options.map((input) => input.closest('label')!.textContent!);
            expect(emprendedor).toContain('Canales incluidos: WhatsApp y Chat web');
            expect(emprendedor).not.toContain('Telegram');
            expect(starter).toContain('Canales incluidos: Instagram, Messenger y Telegram');
            expect(starter).not.toMatch(/WhatsApp|SMS|Email|web_widget/);
            expect(starter.match(/Telegram/g)).toHaveLength(1);
        } finally { screen.unmount(); }
    });

    it.each([
        ['es', 'Canales incluidos:', 'Chat web'], ['en', 'Included channels:', 'Web Chat'],
        ['pt', 'Canais incluídos:', 'Chat no site'], ['fr', 'Canaux inclus :', 'Chat Web'],
    ])("uses the %s catalog to name a runtime channel list", async (locale, label, webName) => {
        const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../messages', `${locale}.json`), 'utf8'));
        const screen = await renderScreen(
            <NextIntlClientProvider locale={locale} messages={messages}>
                <PlanChannels channels={['web_widget', 'telegram', 'email', 'sms', 'unknown']} />
            </NextIntlClientProvider>,
        );
        try {
            expect(screen.container.textContent).toContain(label);
            expect(screen.container.textContent).toContain(webName);
            expect(screen.container.textContent).toContain('Telegram');
            expect(screen.container.textContent).not.toMatch(/web_widget|email|sms|unknown|onboarding\./);
        } finally { screen.unmount(); }
    });

    it.each([undefined, null, 'telegram'])('does not invent plan inclusions when the catalog has no channel list (%s)', async (channels) => {
        const screen = await renderScreen(<PlanChannels channels={channels} />);
        try {
            expect(screen.container.textContent).toBe('Información de canales no disponible.');
        } finally { screen.unmount(); }
    });

    it('does not offer internal or one-way surfaces as conversational channels', async () => {
        const screen = await renderScreen(<PlanChannels channels={['email', 'sms']} />);
        try {
            expect(screen.container.textContent).toBe('Este plan no incluye canales de conversación.');
        } finally { screen.unmount(); }
    });
});
