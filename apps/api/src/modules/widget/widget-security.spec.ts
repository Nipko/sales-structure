import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
    CreateWidgetSessionDto,
    WIDGET_MESSAGE_MAX_CHARS,
    WidgetMessageDto,
} from './dto/widget-public.dto';
import { isWidgetOriginAllowed } from './widget-security';

describe('widget public security contracts', () => {
    describe('origin validation', () => {
        it('fails closed when Origin is missing or malformed', () => {
            expect(isWidgetOriginAllowed(undefined, [])).toBe(false);
            expect(isWidgetOriginAllowed('null', [])).toBe(false);
            expect(isWidgetOriginAllowed('javascript:alert(1)', [])).toBe(false);
        });

        it('allows any valid web origin only when the allowlist is empty', () => {
            expect(isWidgetOriginAllowed('https://customer.example', [])).toBe(true);
            expect(isWidgetOriginAllowed('http://localhost:3000', [])).toBe(true);
        });

        it('matches exact domains and subdomains without suffix confusion', () => {
            const allowed = ['example.com'];
            expect(isWidgetOriginAllowed('https://example.com', allowed)).toBe(true);
            expect(isWidgetOriginAllowed('https://shop.example.com', allowed)).toBe(true);
            expect(isWidgetOriginAllowed('https://example.com.evil.test', allowed)).toBe(false);
            expect(isWidgetOriginAllowed('https://notexample.com', allowed)).toBe(false);
        });
    });

    describe('strict DTOs', () => {
        it('rejects oversized and extra websocket message fields', () => {
            const oversized = plainToInstance(WidgetMessageDto, {
                content: 'x'.repeat(WIDGET_MESSAGE_MAX_CHARS + 1),
                injected: true,
            });
            const errors = validateSync(oversized, {
                whitelist: true,
                forbidNonWhitelisted: true,
            });
            expect(errors.some(error => error.property === 'content')).toBe(true);
            expect(errors.some(error => error.property === 'injected')).toBe(true);
        });

        it('rejects malformed pre-chat identity and unknown fields', () => {
            const dto = plainToInstance(CreateWidgetSessionDto, {
                widgetId: 'wgt_123',
                visitorId: 'visitor-1',
                email: 'not-an-email',
                admin: true,
            });
            const errors = validateSync(dto, {
                whitelist: true,
                forbidNonWhitelisted: true,
            });
            expect(errors.some(error => error.property === 'email')).toBe(true);
            expect(errors.some(error => error.property === 'admin')).toBe(true);
        });
    });
});
