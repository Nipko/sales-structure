import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { registerForPush, registerNotificationCategories, onNotificationTap, getColdStartData, presentLocalNotification } from '../lib/push';
import { api } from '../lib/api';
import { getAgentSocket, connectRealtime } from '../lib/socket';
import { subscribeUnread, getUnreadTotal } from '../lib/unread';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';
import { LoginScreen } from '../screens/LoginScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { NoWorkspaceScreen } from '../screens/NoWorkspaceScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { CrmScreen } from '../screens/CrmScreen';
import { LeadDetailScreen } from '../screens/LeadDetailScreen';
import { PipelineScreen } from '../screens/PipelineScreen';
import { AppointmentsScreen } from '../screens/AppointmentsScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { NotificationPrefsScreen } from '../screens/NotificationPrefsScreen';
import { OutboundScreen } from '../screens/OutboundScreen';

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
            {/* Sin header nativo: el BrandHeader (Parallly + tenant + redactar)
                dentro de InboxScreen lo reemplaza, con colapso al hacer scroll. */}
            <InboxStack.Screen name="InboxList" component={InboxScreen} options={{ headerShown: false }} />
            <InboxStack.Screen name="Conversation" component={ConversationScreen}
                options={({ route }) => ({ title: route.params?.title || 'Conversación' })} />
        </InboxStack.Navigator>
    );
}

function CrmStackNavigator() {
    const { t } = useI18n();
    return (
        <CrmStack.Navigator screenOptions={stackOptions}>
            <CrmStack.Screen name="CrmList" component={CrmScreen}
                options={({ navigation }) => ({
                    title: 'CRM',
                    // Labeled entry (not a bare icon) so the pipeline is discoverable (QW6).
                    headerRight: () => (
                        <TouchableOpacity onPress={() => navigation.navigate('Pipeline')}
                            accessibilityRole="button" accessibilityLabel={t('nav.pipeline')}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, paddingVertical: 4 }}>
                            <Ionicons name="git-branch-outline" size={19} color={theme.accent} />
                            <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>{t('nav.pipeline')}</Text>
                        </TouchableOpacity>
                    ),
                })} />
            <CrmStack.Screen name="LeadDetail" component={LeadDetailScreen}
                options={({ route }) => ({ title: route.params?.title || t('nav.lead') })} />
            <CrmStack.Screen name="Pipeline" component={PipelineScreen} options={{ title: t('nav.pipeline') }} />
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
    const { t } = useI18n();
    const term = verticalConfig?.terminology || {};
    // Vertical-aware label only for the bookings tab (turismo → "Reservas",
    // restaurantes → "Pedidos"). Falls back to the i18n label. CRM stays "CRM".
    const citasLabel = loc(term.transactionNoun) || t('nav.citas');

    // Unread badge on the Inbox tab (QW5) — fed by the unread store from InboxScreen.
    const [unread, setUnread] = useState(getUnreadTotal());
    useEffect(() => subscribeUnread(setUnread), []);
    // Un tap háptico cuando SUBEN los no-leídos: feedback físico de "entró algo".
    const prevUnread = useRef(unread);
    useEffect(() => {
        if (unread > prevUnread.current) haptic.tap();
        prevUnread.current = unread;
    }, [unread]);
    const inboxBadge = unread > 0 ? (unread > 99 ? '99+' : unread) : undefined;

    return (
        <Tabs.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                animation: 'shift',
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
            <Tabs.Screen name="Inbox" component={InboxStackNavigator} options={{ tabBarLabel: t('nav.inbox'), tabBarBadge: inboxBadge, tabBarBadgeStyle: { backgroundColor: theme.danger, fontSize: 10 } }} />
            <Tabs.Screen name="CRM" component={CrmStackNavigator} options={{ tabBarLabel: t('nav.crm') }} />
            <Tabs.Screen name="Citas" component={AppointmentsScreen} options={{ tabBarLabel: citasLabel }} />
            <Tabs.Screen name="Más" component={MoreScreen} options={{ tabBarLabel: t('nav.mas') }} />
        </Tabs.Navigator>
    );
}

const WELCOME_KEY = 'welcome_seen';

export function RootNavigator() {
    const { user, tenantId, loading } = useAuth();
    const { t } = useI18n();

    // null = todavía leyendo el flag (el BootSplash cubre ese instante).
    const [welcomeSeen, setWelcomeSeen] = useState<boolean | null>(null);
    useEffect(() => {
        AsyncStorage.getItem(WELCOME_KEY)
            .then((v) => setWelcomeSeen(v === '1'))
            .catch(() => setWelcomeSeen(true)); // ante la duda, no molestar
    }, []);
    const dismissWelcome = useCallback(() => {
        setWelcomeSeen(true);
        AsyncStorage.setItem(WELCOME_KEY, '1').catch(() => { /* best effort */ });
    }, []);

    // Register native push + notification quick actions + deep-link taps.
    useEffect(() => {
        if (!user) return;
        registerForPush();
        registerNotificationCategories();

        const navigateTo = (data: any) => {
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

        const handleResponse = (info: { data: any; actionIdentifier: string; userText?: string }) => {
            const data = info?.data || {};
            // Inline "Responder" from the notification → send the reply directly.
            if (info.actionIdentifier === 'reply' && info.userText?.trim() && data.conversationId && tenantId) {
                api.sendMessage(tenantId, data.conversationId, info.userText.trim(), user?.id).catch(() => {});
                return;
            }
            navigateTo(data);
        };

        const sub = onNotificationTap(handleResponse);
        // Cold start: app opened by tapping a notification while closed.
        getColdStartData().then((data) => { if (data) setTimeout(() => navigateTo(data), 600); });
        return () => sub.remove();
    }, [user, tenantId]);

    // Real-time handoff alerts (works while the app is running, no EAS/FCM needed).
    // The /agent gateway broadcasts these to the tenant after agent:join.
    useEffect(() => {
        if (!user) return;
        connectRealtime(); // open /inbox + /agent eagerly right after login
        const agent = getAgentSocket();
        const onHandoff = (p: any) => presentLocalNotification(
            t('notif.escalatedTitle'),
            t('notif.escalatedBody', { name: p?.contactName || t('notif.someone') }) + (p?.reason ? ` — ${p.reason}` : ''),
            { conversationId: p?.conversationId },
            'handoff',
        );
        const onAssigned = (p: any) => presentLocalNotification(
            t('notif.assignedTitle'),
            t('notif.assignedBody', { name: p?.contactName || t('notif.someone') }),
            { conversationId: p?.conversationId },
            'handoff',
        );
        const onEscalation = (p: any) => presentLocalNotification(
            t('notif.slaTitle'),
            t('notif.slaBody', { name: p?.contactName || t('notif.conversation'), min: p?.waitMinutes || 5 }),
            { conversationId: p?.conversationId },
            'sla',
        );
        agent.on('inbox:handoff', onHandoff);
        agent.on('inbox:assigned_to_you', onAssigned);
        agent.on('inbox:escalation', onEscalation);

        // Reconnect realtime whenever the app returns to the foreground (the socket
        // may have dropped while backgrounded → live updates would stay stale).
        const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') connectRealtime(); });

        return () => {
            agent.off('inbox:handoff', onHandoff);
            agent.off('inbox:assigned_to_you', onAssigned);
            agent.off('inbox:escalation', onEscalation);
            appSub.remove();
        };
    }, [user]);

    if (loading) {
        // Solo el fondo: el BootSplashGate (App.tsx) cubre este estado con la
        // animación de marca — un spinner debajo sería ruido duplicado.
        return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
    }

    // Cuenta sin empresa (wizard web abandonado): la consola no tiene nada que
    // mostrar — se explica y se manda a terminarlo, en vez de dejarlo dentro de
    // pantallas vacías sin salida. super_admin no tiene tenant por diseño.
    if (user && !tenantId && (user as any).role !== 'super_admin') {
        return (
            <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
                <Stack.Screen name="NoWorkspace" component={NoWorkspaceScreen} />
            </Stack.Navigator>
        );
    }

    return (
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 250 }}>
            {user ? (
                <>
                    <Stack.Screen name="Main" component={MainTabs} />
                    <Stack.Screen
                        name="NotificationPrefs"
                        component={NotificationPrefsScreen}
                        options={() => ({
                            headerShown: true,
                            headerStyle: { backgroundColor: theme.bgCard },
                            headerTintColor: theme.text,
                            title: 'Notificaciones',
                        })}
                    />
                    <Stack.Screen
                        name="Outbound"
                        component={OutboundScreen}
                        options={() => ({
                            headerShown: true,
                            headerStyle: { backgroundColor: theme.bgCard },
                            headerTintColor: theme.text,
                            title: 'Nueva conversación',
                            presentation: 'modal',
                        })}
                    />
                </>
            ) : welcomeSeen === false ? (
                // Primer arranque tras instalar desde Play Store: contexto de
                // producto + alta en la web, antes del formulario de login.
                <Stack.Screen name="Welcome">
                    {() => <WelcomeScreen onContinue={dismissWelcome} />}
                </Stack.Screen>
            ) : (
                <Stack.Screen name="Login" component={LoginScreen} />
            )}
        </Stack.Navigator>
    );
}
