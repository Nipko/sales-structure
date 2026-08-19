import { Injectable } from '@nestjs/common';

export interface AffectiveState {
    frustration: number; // 0-1
    confusion: number;
    urgency: 'low' | 'mid' | 'high';
    lastObjection?: string;
}

/**
 * Lightweight affective detection (D6 fix for "No tengo precio verificado" frío).
 * Keyword-based, <1ms, no LLM call. Hume EVI / Sierra style but local.
 * Frustration >0.7 triggers empathic preamble in L1 (one sentence validation).
 */
@Injectable()
export class EmotionService {
    private readonly frustrationSignals = [
        'frustrado','molesto','enojado','furioso','harto','cansado','reclamo','queja','pesimo','horrible','estafa','demanda','abogado','inaceptable','no funciona','no sirve','perdi tiempo','ya dije','otra vez','siempre lo mismo',
        'frustrated','angry','upset','annoyed','terrible','awful','scam','lawsuit',
    ];
    private readonly confusionSignals = [
        'no entiendo','confundido','confusa','no se','no sé','como funciona','qué significa','???','??','no me queda claro','explicame','explícame',
        "don't understand",'confused','how does','what does',
    ];
    private readonly urgencySignals = [
        'urgente','urgencia','hoy mismo','ahora mismo','lo antes posible','asap','emergencia','inmediato','rapido','rápido',
        'urgent','as soon as possible','emergency','right now',
    ];

    detect(text: string, history?: string[]): AffectiveState {
        const lower = (text || '').toLowerCase();
        const hist = (history || []).join(' ').toLowerCase();
        const combined = `${lower} ${hist}`.slice(0, 2000);

        const countMatches = (signals: string[]) => signals.filter(s => combined.includes(s)).length;
        const frustCount = countMatches(this.frustrationSignals);
        const confCount = countMatches(this.confusionSignals);
        const urgCount = countMatches(this.urgencySignals);

        // Repeated question or exclamation indicates frustration
        const repeatQuestion = (lower.match(/\?/g) || []).length >= 2 ? 0.2 : 0;
        const capsRatio = lower.length > 20 ? (lower.replace(/[^A-Z]/g, '').length / lower.length) : 0;
        const capsBoost = capsRatio > 0.3 ? 0.2 : 0;

        const frustration = Math.min(1, frustCount * 0.35 + repeatQuestion + capsBoost + (lower.includes('!') ? 0.15 : 0));
        const confusion = Math.min(1, confCount * 0.4);
        const urgency: AffectiveState['urgency'] = urgCount >= 2 ? 'high' : urgCount === 1 ? 'mid' : 'low';

        // Extract last objection (first frustration signal sentence)
        let lastObjection: string | undefined;
        if (frustration > 0.5) {
            const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
            for (const s of sentences) {
                const sl = s.toLowerCase();
                if (this.frustrationSignals.some(sig => sl.includes(sig))) { lastObjection = s.slice(0, 120); break; }
            }
        }

        return { frustration, confusion, urgency, lastObjection };
    }
}
