import React from 'react';
import { Modal as NativeModal, type ModalProps, StyleSheet, View } from 'react-native';
import { ToastViewport } from './Toast';

/**
 * Native modal boundary used by the app. Keeping the toast viewport in this
 * shared wrapper makes errors visible above Android/iOS native modal windows
 * without introducing a second blocking modal or changing touch handling.
 */
export function Modal({ children, ...props }: ModalProps) {
    return (
        <NativeModal {...props}>
            <View pointerEvents="box-none" style={styles.root} testID="app-modal-content">
                {children}
                <ToastViewport />
            </View>
        </NativeModal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
});
