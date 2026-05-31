import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { AuthProvider } from './src/contexts/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { theme } from './src/theme';

const navTheme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: theme.bg,
        card: theme.bgCard,
        text: theme.text,
        border: theme.border,
        primary: theme.accent,
    },
};

export default function App() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <NavigationContainer theme={navTheme}>
                    <RootNavigator />
                </NavigationContainer>
                <StatusBar style="light" />
            </AuthProvider>
        </SafeAreaProvider>
    );
}
