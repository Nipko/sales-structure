/**
 * useAudioRecorder — hook para grabar notas de voz salientes.
 *
 * Flujo:
 *  - startRecording() → solicita permiso de micrófono, inicia grabación en OGG/AAC.
 *  - stopRecording()  → detiene y devuelve { uri, duration } del audio grabado.
 *  - cancelRecording() → descarta sin devolver nada.
 *
 * El archivo grabado vive en el cache del dispositivo y se limpia después de enviar.
 * expo-av graba en AAC/m4a en Android y m4a en iOS → compatible con WhatsApp.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';

export interface RecordingResult {
    uri: string;
    durationMs: number;
}

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping';

export function useAudioRecorder() {
    const [state, setState] = useState<RecordingState>('idle');
    const [durationMs, setDurationMs] = useState(0);
    const recordingRef = useRef<Audio.Recording | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            recordingRef.current?.stopAndUnloadAsync().catch(() => {});
        };
    }, []);

    const startRecording = useCallback(async (): Promise<boolean> => {
        if (state !== 'idle') return false;
        setState('requesting');
        try {
            const perm = await Audio.requestPermissionsAsync();
            if (!perm.granted) { setState('idle'); return false; }

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY,
            );
            recordingRef.current = recording;
            setDurationMs(0);
            setState('recording');

            timerRef.current = setInterval(() => {
                setDurationMs((d) => d + 1000);
            }, 1000);
            return true;
        } catch {
            setState('idle');
            return false;
        }
    }, [state]);

    const stopRecording = useCallback(async (): Promise<RecordingResult | null> => {
        if (state !== 'recording' || !recordingRef.current) return null;
        setState('stopping');
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        try {
            await recordingRef.current.stopAndUnloadAsync();
            const uri = recordingRef.current.getURI();
            const duration = durationMs;
            recordingRef.current = null;
            setState('idle');
            setDurationMs(0);
            if (!uri) return null;
            return { uri, durationMs: duration };
        } catch {
            recordingRef.current = null;
            setState('idle');
            return null;
        }
    }, [state, durationMs]);

    const cancelRecording = useCallback(async () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        try { await recordingRef.current?.stopAndUnloadAsync(); } catch { /* noop */ }
        recordingRef.current = null;
        setState('idle');
        setDurationMs(0);
    }, []);

    return { state, durationMs, startRecording, stopRecording, cancelRecording };
}

/** Format ms → "0:SS" or "M:SS" */
export function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}
