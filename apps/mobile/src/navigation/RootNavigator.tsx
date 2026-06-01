import React, { useEffect } from 'react';
import { View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { registerForPush, onNotificationTap, getColdStartData, presentLocalNotification } from '../lib/push';
import { getAgentSocket } from '../lib/socket';
import { theme } from '../theme';
import { LoginScreen } from '../screens/LoginScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { CrmScreen } from '../screens/CrmScreen';
import { LeadDetailScreen } from '../screens/LeadDetailScreen';
import { PipelineScreen } from '../screens/PipelineScreen';
import { AppointmentsScreen } from '../screens/AppointmentsScreen';
import { MoreScreen } from '../screens/MoreScreen';

export const navigationRef = createNavigationContainerRef<any>();

export type InboxStackParams = {
    InboxList: undefined;
    Conversation: { conversationId: string; title: string };
};
export type CrmStackParams = {
    CrmList: undefined;
    LeadDetail: { leadId: string; title: string };
    Pipeline: undefined;
};

const Stack = createNativeStackNavigator();
const InboxStack = createNativeStackNavigator<InboxStackParams>();
const CrmStack = createNativeStackNavigator<CrmStackParams>();
const Tabs = createBottomTabNavigator();

const stackOptions = { headerStyle: { backgroundColor: theme.bgCard }, headerTintColor: theme.text };

function InboxStackNavigator() {
    return (
        <InboxStack.Navigator screenOptions={stackOptions}>
            <InboxStack.Screen name="InboxList" component={InboxScreen} options={{ title: 'Inbox' }} />
            <InboxStack.Screen name="Conversation" component={ConversationScreen}
                options={({ route }) => ({ title: route.params?.title || 'Conversación' })} />
        </InboxStack.Navigator>
    );
}

function CrmStackNavigator() {
    return (
        <CrmStack.Navigator screenOptions={stackOptions}>
            <CrmStack.Screen name="CrmList" component={CrmScreen}
                options={({ navigation }) => ({
                    title: 'CRM',
                    headerRight: () => (
                        <TouchableOpacity onPress={() => navigation.navigate('Pipeline')} style={{ paddingHorizontal: 4 }}>
                            <Ionicons name="git-branch-outline" size={22} color={theme.accent} />
                        </TouchableOpacity>
                    ),
                })} />
            <CrmStack.Screen name="LeadDetail" component={LeadDetailScreen}
                options={({ route }) => ({ title: route.params?.title || 'Lead' })} />
            <CrmStack.Screen name="Pipeline" component={PipelineScreen} options={{ title: 'Embudo' }} />
        </CrmStack.Navigator>
    );
}

function loc(v: any): string {
    if (!v) return '';
    const s = typeof v === 'string' ? v : (v.es || v.en || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function MainTabs() {
    const { verticalConfig } = useAuth();
    const term = verticalConfig?.terminology || {};
    // Vertical-aware label only for the bookings tab (turismo → "Reservas",
    // restaurantes → "Pedidos"). CRM stays "CRM" to avoid confusion.
    const citasLabel = loc(term.transactionNoun) || 'Citas';

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
            <Tabs.Screen name="CRM" component={CrmStackNavigator} />
            <Tabs.Screen name="Citas" component={AppointmentsScreen} options={{ tabBarLabel: citasLabel }} />
            <Tabs.Screen name="Más" component={MoreScreen} />
        </Tabs.Navigator>
    );
}

export function RootNavigator() {
    const { user, loading } = useAuth();

    // Register native push + deep-link taps to the exact conversation.
    useEffect(() => {
        if (!user) return;
        registerForPush();

        const goTo = (data: any) => {
            if (!navigationRef.isReady()) return;
            if (data?.conversationId) {
                navigationRef.navigate('Main', {
                    screen: 'Inbox',
                    params: { screen: 'Conversation', params: { conversationId: data.conversationId, title: 'Conversación' } },
                });
            } else {
                navigationRef.navigate('Main', { screen: 'Inbox' });
            }
        };

        const sub = onNotificationTap(goTo);
        // Cold start: app opened by tapping a notification while closed.
        getColdStartData().then((data) => { if (data) setTimeout(() => goTo(data), 600); });
        return () => sub.remove();
    }, [user]);

    // Real-time handoff alerts (works while the app is running, no EAS/FCM needed).
    // The /agent gateway broadcasts these to the tenant after agent:join.
    useEffect(() => {
        if (!user) return;
        const agent = getAgentSocket();
        const onHandoff = (p: any) => presentLocalNotification(
            'Conversación escalada',
            `${p?.contactName || 'Un cliente'} necesita atención${p?.reason ? ' — ' + p.reason : ''}`,
            { conversationId: p?.conversationId },
        );
        const onAssigned = (p: any) => presentLocalNotification(
            'Asignada a ti',
            p?.message || `${p?.contactName || 'Un cliente'} fue asignado a ti`,
            { conversationId: p?.conversationId },
        );
        const onEscalation = (p: any) => presentLocalNotification(
            'Escalación SLA',
            `${p?.contactName || 'Conversación'} sin respuesta hace ${p?.waitMinutes || 5} min`,
            { conversationId: p?.conversationId },
        );
        agent.on('inbox:handoff', onHandoff);
        agent.on('inbox:assigned_to_you', onAssigned);
        agent.on('inbox:escalation', onEscalation);
        return () => {
            agent.off('inbox:handoff', onHandoff);
            agent.off('inbox:assigned_to_you', onAssigned);
            agent.off('inbox:escalation', onEscalation);
        };
    }, [user]);

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
