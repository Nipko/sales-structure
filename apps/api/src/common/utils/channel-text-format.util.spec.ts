import { formatOutboundText, toPlainText, toTelegramHtml, toWhatsAppFormatting } from './channel-text-format.util';

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

    it('formats Telegram as the HTML subset it parses', () => {
        expect(formatOutboundText('**Hola**', 'telegram')).toBe('<b>Hola</b>');
    });

    it('strips the markers on channels that render plain text', () => {
        for (const channel of ['instagram', 'messenger', 'sms', 'widget', 'WebChat']) {
            expect(formatOutboundText('**Hola**', channel)).toBe('Hola');
        }
    });

    it('never touches email or an unknown channel', () => {
        // Email is composed from HTML templates on its own path, and guessing a
        // format we have not verified against a provider is how you corrupt it.
        for (const channel of ['email', 'carrier-pigeon', '']) {
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

describe('toTelegramHtml', () => {
    it('convierte el marcado a las etiquetas que Telegram parsea', () => {
        expect(toTelegramHtml('Tenemos el **Amazon Minimalist** disponible'))
            .toBe('Tenemos el <b>Amazon Minimalist</b> disponible');
        expect(toTelegramHtml('~~agotado~~')).toBe('<s>agotado</s>');
        expect(toTelegramHtml('## Resumen')).toBe('<b>Resumen</b>');
    });

    it('escapa ANTES de convertir, así el texto del cliente no puede inyectar etiquetas', () => {
        // Una etiqueta desbalanceada hace que Telegram rechace el envío con 400
        // y se pierda la respuesta: lo único que puede quedar como markup es lo
        // que produjo esta función.
        const out = toTelegramHtml('El cliente escribió <b>hola</b> y 1 < 2');
        expect(out).toContain('&lt;b&gt;hola&lt;/b&gt;');
        expect(out).toContain('1 &lt; 2');
        expect(out).not.toMatch(/<b>hola<\/b>/);
    });

    it('escapa las URLs al restaurarlas y no las altera', () => {
        const out = toTelegramHtml('Pagá en https://checkout.wompi.co/l/x?a=1&b=2');
        expect(out).toContain('https://checkout.wompi.co/l/x?a=1&amp;b=2');
    });

    it('preserva el código como <code>/<pre> con su contenido escapado', () => {
        expect(toTelegramHtml('usá `a < b`')).toBe('usá <code>a &lt; b</code>');
    });

    it('un título degenerado no puede vaciar el mensaje', () => {
        expect(toTelegramHtml('#   ')).not.toBe('');
    });
});

describe('toPlainText', () => {
    it('quita los marcadores y conserva las palabras', () => {
        expect(toPlainText('Tenemos el **Amazon Minimalist** disponible'))
            .toBe('Tenemos el Amazon Minimalist disponible');
        expect(toPlainText('- **Apartamento:** Amazon Minimalist'))
            .toBe('- Apartamento: Amazon Minimalist');
        expect(toPlainText('## Resumen')).toBe('Resumen');
    });

    it('no altera una URL ni el texto sin marcado', () => {
        const url = 'Mirá parallly-chat.cloud/__promo__ ahora';
        expect(toPlainText(url)).toBe(url);
        expect(toPlainText('cuesta 3.5 millones, etc.')).toBe('cuesta 3.5 millones, etc.');
    });

    it('conserva el contenido del código sin las comillas', () => {
        expect(toPlainText('usá `npm run dev`')).toBe('usá npm run dev');
    });
});
