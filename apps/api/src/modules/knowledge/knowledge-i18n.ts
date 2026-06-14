/**
 * Parallly — Knowledge Base i18n
 *
 * Lang-keyed message map for admin-facing KB management errors and notices.
 * Mirrors the `EMAIL_MSG` + `emsg()` pattern in email-i18n.ts.
 *
 * Conventions:
 *  - kbmsg() normalises the lang (first 2 chars, e.g. "es-CO" -> "es")
 *    and falls back to "es".
 *  - Variable placeholders use double braces: `{{limit}}`, `{{used}}`, etc.
 *  - Logs / console strings are intentionally NOT translated (internal only).
 */

export const KB_MSG: Record<'es' | 'en' | 'pt' | 'fr', Record<string, string>> = {
    es: {
        // ── OpenAI key missing ──
        'embeddings.noKey':
            'La base de conocimiento requiere una API key de OpenAI configurada (se usa para generar los embeddings). Configúrala en el panel de super admin.',

        // ── Document too large ──
        'document.tooLarge':
            'El documento excede el límite de {{limit}} caracteres (~{{pages}} páginas) para tu plan.',

        // ── URL crawling ──
        'crawl.planRequired':
            'Tu plan no incluye la importación de URLs. Actualizá a Starter o superior.',
        'crawl.limitReached':
            'Tu plan permite hasta {{limit}} páginas importadas. Actualizá tu plan para agregar más.',
        'crawl.invalidUrl': 'La URL proporcionada no es válida.',
        'crawl.noContent': 'No se pudo extraer contenido útil de la URL.',

        // ── Document operations ──
        'doc.notUrlSource': 'Este documento no fue importado desde una URL.',
        'doc.emptyContent': 'El contenido del documento está vacío.',

        // ── Embedding plan limit ──
        'embed.limitReached':
            'Has alcanzado el límite de {{limit}} embeddings mensuales. Usado: {{used}}, necesarios: {{needed}}.',

        // ── AI article suggestions ──
        'suggestions.noUnanswered': 'No hay queries sin respuesta para analizar.',
    },

    en: {
        'embeddings.noKey':
            'The knowledge base requires a configured OpenAI API key (used to generate embeddings). Set it up in the super admin panel.',

        'document.tooLarge':
            'The document exceeds the limit of {{limit}} characters (~{{pages}} pages) for your plan.',

        'crawl.planRequired':
            'Your plan does not include URL import. Upgrade to Starter or above.',
        'crawl.limitReached':
            'Your plan allows up to {{limit}} imported pages. Upgrade your plan to add more.',
        'crawl.invalidUrl': 'The provided URL is not valid.',
        'crawl.noContent': 'Could not extract useful content from the URL.',

        'doc.notUrlSource': 'This document was not imported from a URL.',
        'doc.emptyContent': 'The document content is empty.',

        'embed.limitReached':
            'You have reached the monthly limit of {{limit}} embeddings. Used: {{used}}, needed: {{needed}}.',

        'suggestions.noUnanswered': 'No unanswered queries to analyse.',
    },

    pt: {
        'embeddings.noKey':
            'A base de conhecimento requer uma chave de API OpenAI configurada (usada para gerar embeddings). Configure-a no painel de super admin.',

        'document.tooLarge':
            'O documento excede o limite de {{limit}} caracteres (~{{pages}} páginas) para o seu plano.',

        'crawl.planRequired':
            'Seu plano não inclui importação de URLs. Atualize para o Starter ou superior.',
        'crawl.limitReached':
            'Seu plano permite até {{limit}} páginas importadas. Atualize seu plano para adicionar mais.',
        'crawl.invalidUrl': 'A URL fornecida não é válida.',
        'crawl.noContent': 'Não foi possível extrair conteúdo útil da URL.',

        'doc.notUrlSource': 'Este documento não foi importado a partir de uma URL.',
        'doc.emptyContent': 'O conteúdo do documento está vazio.',

        'embed.limitReached':
            'Você atingiu o limite mensal de {{limit}} embeddings. Usados: {{used}}, necessários: {{needed}}.',

        'suggestions.noUnanswered': 'Não há consultas sem resposta para analisar.',
    },

    fr: {
        'embeddings.noKey':
            "La base de connaissances nécessite une clé API OpenAI configurée (utilisée pour générer les embeddings). Configurez-la dans le panneau super admin.",

        'document.tooLarge':
            "Le document dépasse la limite de {{limit}} caractères (~{{pages}} pages) pour votre plan.",

        'crawl.planRequired':
            "Votre plan n'inclut pas l'importation d'URLs. Passez à Starter ou supérieur.",
        'crawl.limitReached':
            "Votre plan autorise jusqu'à {{limit}} pages importées. Mettez à niveau votre plan pour en ajouter d'autres.",
        'crawl.invalidUrl': "L'URL fournie n'est pas valide.",
        'crawl.noContent': "Impossible d'extraire du contenu utile depuis l'URL.",

        'doc.notUrlSource': "Ce document n'a pas été importé depuis une URL.",
        'doc.emptyContent': 'Le contenu du document est vide.',

        'embed.limitReached':
            "Vous avez atteint la limite mensuelle de {{limit}} embeddings. Utilisés : {{used}}, nécessaires : {{needed}}.",

        'suggestions.noUnanswered': "Il n'y a pas de requêtes sans réponse à analyser.",
    },
};

/** Supported KB languages (after normalisation). */
export type KbLang = keyof typeof KB_MSG;

/**
 * Resolve a translated KB management string.
 *
 * @param lang  Raw language tag (e.g. "es-CO", "en", "pt-BR"). First 2 chars are used.
 * @param key   Namespaced key (e.g. "crawl.invalidUrl").
 * @param vars  Optional `{{var}}` substitutions.
 * @returns     Translated string with vars replaced. Falls back to "es", then to the key itself.
 */
export function kbmsg(lang: string, key: string, vars: Record<string, string> = {}): string {
    const code = (lang || 'es').substring(0, 2).toLowerCase() as KbLang;
    const dict = KB_MSG[code] ?? KB_MSG.es;
    let text = dict[key] ?? KB_MSG.es[key] ?? key;

    for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return text;
}
