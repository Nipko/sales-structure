import { formatOutboundText, toWhatsAppFormatting } from './channel-text-format.util';

describe('toWhatsAppFormatting', () => {
    describe('bold', () => {
        it('converts the double-asterisk markdown the model emits into WhatsApp bold', () => {
            expect(toWhatsAppFormatting('Tenemos el apartamento **Amazon Minimalist** disponible'))
                .toBe('Tenemos el apartamento *Amazon Minimalist* disponible');
        });

        it('converts a bold label whose closing marker follows punctuation', () => {
            expect(toWhatsAppFormatting('- **Apartamento:** Amazon Minimalist'))
                .toBe('- *Apartamento:* Amazon Minimalist');
        });

        it('converts underscore bold', () => {
            expect(toWhatsAppFormatting('Precio __final__ hoy')).toBe('Precio *final* hoy');
        });

        it('leaves an unterminated marker alone rather than guessing where bold ends', () => {
            expect(toWhatsAppFormatting('Reservá **ahora mismo')).toBe('Reservá **ahora mismo');
        });

        it('converts several bold spans in the same message', () => {
            expect(toWhatsAppFormatting('**Uno** y **Dos**')).toBe('*Uno* y *Dos*');
        });
    });

    describe('italic', () => {
        it('converts single-asterisk italic when the message proves it was written in markdown', () => {
            expect(toWhatsAppFormatting('**Nota:** es *muy* cómodo')).toBe('*Nota:* es _muy_ cómodo');
        });

        it('leaves a lone *x* alone — with no markdown around it, it is an agent typing WhatsApp bold', () => {
            expect(toWhatsAppFormatting('Es *muy* cómodo')).toBe('Es *muy* cómodo');
        });

        it('leaves arithmetic asterisks untouched', () => {
            expect(toWhatsAppFormatting('2 * 3 * 4 = 24')).toBe('2 * 3 * 4 = 24');
        });

        it('leaves list bullets untouched', () => {
            expect(toWhatsAppFormatting('* Wifi\n* Piscina')).toBe('* Wifi\n* Piscina');
        });

        it('leaves an asterisk glued to a word untouched', () => {
            expect(toWhatsAppFormatting('a*b*c')).toBe('a*b*c');
        });
    });

    describe('headings', () => {
        it('turns h1/h2/h3 into a bold line', () => {
            expect(toWhatsAppFormatting('# Uno\n## Dos\n### Tres')).toBe('*Uno*\n*Dos*\n*Tres*');
        });

        it('does not double-wrap a heading that is already bold', () => {
            expect(toWhatsAppFormatting('### **Servicios**')).toBe('*Servicios*');
        });

        it('keeps inline emphasis inside the heading', () => {
            expect(toWhatsAppFormatting('## Precios *especiales*')).toBe('*Precios _especiales_*');
        });

        it('ignores a hash that is not a heading marker', () => {
            expect(toWhatsAppFormatting('Apartamento #5 y #promo')).toBe('Apartamento #5 y #promo');
        });
    });

    describe('urls', () => {
        it('never rewrites underscores inside a link', () => {
            const text = 'Reservá en https://parallly-chat.cloud/apto_amazon_minimalist__2 ahora';
            expect(toWhatsAppFormatting(text)).toBe(text);
        });

        it('never rewrites asterisks inside a link', () => {
            const text = 'Ver https://ejemplo.com/a**b**c';
            expect(toWhatsAppFormatting(text)).toBe(text);
        });

        it('formats around a link without touching it', () => {
            expect(toWhatsAppFormatting('**Reservá acá:** www.ejemplo.com/promo_2026.'))
                .toBe('*Reservá acá:* www.ejemplo.com/promo_2026.');
        });
    });

    describe('code', () => {
        it('leaves fenced blocks byte-identical (WhatsApp renders ``` natively)', () => {
            const text = 'Mirá:\n```\nconst a = **b**;\n```\nlisto';
            expect(toWhatsAppFormatting(text)).toBe(text);
        });

        it('leaves inline code byte-identical', () => {
            expect(toWhatsAppFormatting('Usá `**literal**` así')).toBe('Usá `**literal**` así');
        });

        it('formats outside a code span while preserving the span', () => {
            expect(toWhatsAppFormatting('**Comando:** `npm run **dev**`'))
                .toBe('*Comando:* `npm run **dev**`');
        });
    });

    describe('plain text', () => {
        it('returns text without markdown unchanged', () => {
            const text = 'Hola Ana, el apartamento está disponible del 3 al 7. ¿Te reservo?';
            expect(toWhatsAppFormatting(text)).toBe(text);
        });

        it('leaves text that is already WhatsApp-formatted unchanged', () => {
            expect(toWhatsAppFormatting('*Amazon Minimalist* — _disponible_'))
                .toBe('*Amazon Minimalist* — _disponible_');
        });

        it('handles empty input', () => {
            expect(toWhatsAppFormatting('')).toBe('');
        });
    });

    describe('nesting', () => {
        it('converts italic nested inside bold', () => {
            expect(toWhatsAppFormatting('**Hola *Ana* bienvenida**')).toBe('*Hola _Ana_ bienvenida*');
        });

        it('converts bold-italic written with three asterisks', () => {
            expect(toWhatsAppFormatting('***Urgente***')).toBe('*_Urgente_*');
        });

        it('keeps markdown italic underscores that WhatsApp already understands', () => {
            expect(toWhatsAppFormatting('**Nota:** _leé las reglas_')).toBe('*Nota:* _leé las reglas_');
        });

        it('converts strikethrough', () => {
            expect(toWhatsAppFormatting('~~$200.000~~ $150.000')).toBe('~$200.000~ $150.000');
        });

        it('converts a full multi-line reply the way the model writes it', () => {
            const model = [
                '## Disponibilidad',
                '',
                'Tenemos el apartamento **Amazon Minimalist** disponible.',
                '- **Apartamento:** Amazon Minimalist',
                '- **Precio:** $150.000 por noche',
            ].join('\n');
            expect(toWhatsAppFormatting(model)).toBe([
                '*Disponibilidad*',
                '',
                'Tenemos el apartamento *Amazon Minimalist* disponible.',
                '- *Apartamento:* Amazon Minimalist',
                '- *Precio:* $150.000 por noche',
            ].join('\n'));
        });
    });

    it('drops the internal sentinels if they ever arrive in the input', () => {
        expect(toWhatsAppFormatting('a\ue000000\ue000b\ue001c')).toBe('a000bc');
    });
});

describe('formatOutboundText', () => {
    it('formats WhatsApp text', () => {
        expect(formatOutboundText('**Hola**', 'whatsapp')).toBe('*Hola*');
    });

    it('leaves every other channel untouched', () => {
        for (const channel of ['telegram', 'instagram', 'messenger', 'email', 'sms', 'widget']) {
            expect(formatOutboundText('**Hola**', channel)).toBe('**Hola**');
        }
    });
});

/**
 * Regressions found by adversarially reviewing the first version of this
 * formatter. Each one is a way a cosmetic rule could damage a real message.
 */
describe('toWhatsAppFormatting — daños que el formateador no puede causar', () => {
    it('nunca altera una URL, ni siquiera un dominio pelado con path', () => {
        // El guard original sólo conocía http(s):// y www., así que
        // `parallly-chat.cloud/__promo__` salía como `.../*promo*`: link roto.
        for (const url of [
            'parallly-chat.cloud/__promo__',
            'www.parallly-chat.cloud/__x__',
            'https://checkout.wompi.co/l/AbC__x',
            'http://a.co/**b**',
        ]) {
            expect(toWhatsAppFormatting(`Mirá ${url} ahora`)).toContain(url);
        }
    });

    it('no confunde números ni abreviaturas con URLs', () => {
        // El precio de un pedido no puede quedar congelado por el guard de URLs.
        expect(toWhatsAppFormatting('cuesta 3.5 millones, etc. y **listo**'))
            .toBe('cuesta 3.5 millones, etc. y *listo*');
    });

    it('un título degenerado no puede vaciar el cuerpo del mensaje', () => {
        // Meta responde 400 a un body vacío: el job saliente falla y se pierde
        // el mensaje. Una regla de presentación nunca debe poder causar eso.
        for (const degenerate of ['#   ', '##\t', '#']) {
            expect(toWhatsAppFormatting(degenerate)).not.toBe('');
        }
    });
});
