import React, { useEffect } from 'react';
import { View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { registerForPush, onNotificationTap } from '../lib/push';
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
            <Tabs.Screen name="CRM" component={CrmStackNavigator} />
            <Tabs.Screen name="Citas" component={AppointmentsScreen} />
            <Tabs.Screen name="Más" component={MoreScreen} />
        </Tabs.Navigator>
    );
}

export function RootNavigator() {
    const { user, loading } = useAuth();

    // Register native push + handle taps once logged in.
    useEffect(() => {
        if (!user) return;
        registerForPush();
        const sub = onNotificationTap(() => {
            if (navigationRef.isReady()) {
                navigationRef.navigate('Main', { screen: 'Inbox' });
            }
        });
        return () => sub.remove();
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
