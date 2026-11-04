import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/ctx';
import { colors } from './src/ui';
import Login from './src/screens/Login';
import Home from './src/screens/Home';
import Approvals from './src/screens/Approvals';
import Documents from './src/screens/Documents';
import More from './src/screens/More';
import Chat from './src/screens/Chat';
import { ErpForm, ErpKinds, ErpList, ErpModules } from './src/screens/Erp';

const Tab = createBottomTabNavigator();
const ErpStack = createNativeStackNavigator();

function ErpNav() {
  const { t } = useApp();
  return (
    <ErpStack.Navigator>
      <ErpStack.Screen name="ErpModules" component={ErpModules} options={{ title: t('erp.title') }} />
      <ErpStack.Screen name="ErpKinds" component={ErpKinds} />
      <ErpStack.Screen name="ErpList" component={ErpList} />
      <ErpStack.Screen name="ErpForm" component={ErpForm} />
    </ErpStack.Navigator>
  );
}

function Tabs() {
  const { t } = useApp();
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.primary }}>
      <Tab.Screen name="Home" component={Home} options={{ title: t('tab.home'), tabBarIcon: () => null }} />
      <Tab.Screen name="Approvals" component={Approvals} options={{ title: t('tab.approvals'), tabBarIcon: () => null }} />
      <Tab.Screen name="Documents" component={Documents} options={{ title: t('tab.documents'), tabBarIcon: () => null }} />
      <Tab.Screen name="ERP" component={ErpNav} options={{ title: t('tab.erp'), headerShown: false, tabBarIcon: () => null }} />
      <Tab.Screen name="Chat" component={Chat} options={{ title: t('tab.chat'), tabBarIcon: () => null }} />
      <Tab.Screen name="More" component={More} options={{ title: t('tab.more'), tabBarIcon: () => null }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, session } = useApp();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  return <NavigationContainer>{session ? <Tabs /> : <Login />}</NavigationContainer>;
}

export default function App() {
  return <SafeAreaProvider><AppProvider><StatusBar style="dark" /><Root /></AppProvider></SafeAreaProvider>;
}
