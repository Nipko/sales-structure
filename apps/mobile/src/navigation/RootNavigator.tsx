import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';
import { LoginScreen } from '../screens/LoginScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

export type InboxStackParams = {
    InboxList: undefined;
    Conversation: { conversationId: string; title: string };
};

const Stack = createNativeStackNavigator();
const InboxStack = createNativeStackNavigator<InboxStackParams>();
const Tabs = createBottomTabNavigator();

function InboxStackNavigator() {
    return (
        <InboxStack.Navigator screenOptions={{ headerStyle: { backgroundColor: theme.bgCard }, headerTintColor: theme.text }}>
            <InboxStack.Screen name="InboxList" component={InboxScreen} options={{ title: 'Inbox' }} />
            <InboxStack.Screen name="Conversation" component={ConversationScreen}
                options={({ route }) => ({ title: route.params?.title || 'Conversación' })} />
        </InboxStack.Navigator>
    );
}

function MainTabs() {
    return (
        <Tabs.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: { backgroundColor: theme.bgCard, borderTopColor: theme.border },
                tabBarActiveTintColor: theme.accent,
                tabBarInactiveTintColor: theme.textSecondary,
                tabBarIcon: ({ color, size }) => {
                    const icons: Record<string, any> = {
                        Inbox: 'chatbubbles-outline', CRM: 'people-outline', Citas: 'calendar-outline', 'Más': 'ellipsis-horizontal',
                    };
                    return <Ionicons name={icons[route.name] || 'ellipse-outline'} size={size} color={color} />;
                },
            })}
        >
            <Tabs.Screen name="Inbox" component={InboxStackNavigator} />
            <Tabs.Screen name="CRM" children={() => <PlaceholderScreen title="CRM" subtitle="Próximamente: contactos, pipeline y deals." />} />
            <Tabs.Screen name="Citas" children={() => <PlaceholderScreen title="Citas" subtitle="Próximamente: agenda del día y confirmaciones." />} />
            <Tabs.Screen name="Más" children={() => <PlaceholderScreen title="Más" subtitle="Analytics, perfil y disponibilidad." showLogout />} />
        </Tabs.Navigator>
    );
}

export function RootNavigator() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={theme.accent} size="large" />
            </View>
        );
    }

    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            {user ? (
                <Stack.Screen name="Main" component={MainTabs} />
            ) : (
                <Stack.Screen name="Login" component={LoginScreen} />
            )}
        </Stack.Navigator>
    );
}
