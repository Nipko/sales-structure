import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { fmtDuration } from '../lib/useAudioRecorder';
import { theme } from '../theme';

/**
 * Inline audio player for voice notes (sent or received). Play/pause + progress.
 * Loads lazily on first play; unloads on unmount to free the native player.
 */
export function AudioPlayer({ uri, tint = theme.accent }: { uri: string; tint?: string }) {
    const soundRef = useRef<Audio.Sound | null>(null);
    const [playing, setPlaying] = useState(false);
    const [pos, setPos] = useState(0);
    const [dur, setDur] = useState(0);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        return () => { soundRef.current?.unloadAsync().catch(() => {}); soundRef.current = null; };
    }, []);

    const onStatus = useCallback((st: AVPlaybackStatus) => {
        if (!st.isLoaded) return;
        setPlaying(st.isPlaying);
        setPos(st.positionMillis || 0);
        if (st.durationMillis) setDur(st.durationMillis);
        if (st.didJustFinish) {
            setPlaying(false);
            setPos(0);
            soundRef.current?.setPositionAsync(0).catch(() => {});
        }
    }, []);

    const toggle = useCallback(async () => {
        try {
            if (!soundRef.current) {
                setLoading(true);
                await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
                const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, onStatus);
                soundRef.current = sound;
                setLoading(false);
                return;
            }
            if (playing) {
                await soundRef.current.pauseAsync();
            } else {
                await soundRef.current.playFromPositionAsync(pos >= dur && dur > 0 ? 0 : pos);
            }
        } catch {
            setLoading(false);
        }
    }, [uri, playing, pos, dur, onStatus]);

    const pct = dur > 0 ? Math.min(1, pos / dur) : 0;

    return (
        <View style={styles.row}>
            <TouchableOpacity onPress={toggle} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar' : 'Reproducir'} hitSlop={8}>
                <Ionicons name={loading ? 'hourglass-outline' : playing ? 'pause-circle' : 'play-circle'} size={34} color={tint} />
            </TouchableOpacity>
            <View style={styles.track}>
                <View style={[styles.bar, { backgroundColor: tint + '33' }]}>
                    <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
                </View>
                <Text style={[styles.time, { color: tint }]}>
                    🎤 {fmtDuration(pos)}{dur > 0 ? ` / ${fmtDuration(dur)}` : ''}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 180, paddingVertical: 2 },
    track: { flex: 1 },
    bar: { height: 3, borderRadius: 2, overflow: 'hidden' },
    fill: { height: 3, borderRadius: 2 },
    time: { fontSize: 11, marginTop: 4, opacity: 0.9 },
});
