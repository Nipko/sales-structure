import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Returns the bottom padding (px) needed to lift content above the on-screen
 * keyboard, for use under `android:windowSoftInputMode="adjustNothing"`.
 *
 * WHY this exists: Expo SDK 54 enforces edge-to-edge (Android 15+), which breaks
 * the classic `adjustResize` signal that `KeyboardAvoidingView` relies on (see
 * react-native-screens #2308 / #2467). With the OS doing nothing (adjustNothing),
 * we lift content ourselves by the exact amount.
 *
 * THE FORMULA: `keyboardHeight - bottomSafeAreaInset`. `endCoordinates.height` is
 * measured from the physical screen bottom and includes the navigation-bar area;
 * the content already sits above the nav bar, so we must subtract that inset to
 * avoid an over-pad gap (the bug we hit when padding by the raw keyboard height).
 */
export function useKeyboardSpace(): number {
    const insets = useSafeAreaInsets();
    const [space, setSpace] = useState(0);

    useEffect(() => {
        const onShow = Keyboard.addListener('keyboardDidShow', (e) => {
            const kb = e.endCoordinates?.height || 0;
            setSpace(Math.max(0, kb - insets.bottom));
        });
        const onHide = Keyboard.addListener('keyboardDidHide', () => setSpace(0));
        return () => { onShow.remove(); onHide.remove(); };
    }, [insets.bottom]);

    return space;
}
