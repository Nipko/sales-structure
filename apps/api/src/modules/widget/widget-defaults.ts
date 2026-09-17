/** Default widget strings by language (es/en/pt/fr). Fallback: es. */
export const WIDGET_DEFAULTS: Record<string, { welcomeMessage: string; agentName: string }> = {
    es: { welcomeMessage: '¡Hola! ¿En qué te puedo ayudar?', agentName: 'Asistente' },
    en: { welcomeMessage: 'Hello! How can I help you?',       agentName: 'Assistant' },
    pt: { welcomeMessage: 'Olá! Como posso te ajudar?',       agentName: 'Assistente' },
    fr: { welcomeMessage: 'Bonjour ! Comment puis-je vous aider ?', agentName: 'Assistant' },
};
