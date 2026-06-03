/** Parallly mobile theme — mirrors the dashboard dark palette. */
export const theme = {
    bg: '#0a0a12',
    bgCard: '#12121e',
    bgElevated: '#1a1a2e',
    border: '#2a2a45',
    text: '#e8e8f0',
    textSecondary: '#9898b0',
    accent: '#6c5ce7',
    success: '#00d68f',
    warning: '#ffaa00',
    danger: '#ff4757',
    bubbleIn: '#1a1a2e',
    bubbleOut: '#6c5ce7',
};

export const channelColor: Record<string, string> = {
    whatsapp: '#25D366',
    instagram: '#E1306C',
    messenger: '#0084FF',
    telegram: '#0088CC',
    sms: '#8e8e93',
    email: '#EA4335',
    web_widget: '#6c5ce7',
};

/** Brand display names (proper nouns — not i18n-translated). */
export const channelLabel: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    messenger: 'Messenger',
    telegram: 'Telegram',
    sms: 'SMS',
    email: 'Email',
    web_widget: 'Web',
};

export const channelIcon: Record<string, string> = {
    whatsapp: 'logo-whatsapp', instagram: 'logo-instagram', messenger: 'logo-facebook',
    telegram: 'paper-plane', sms: 'chatbox', email: 'mail', web_widget: 'globe',
};
