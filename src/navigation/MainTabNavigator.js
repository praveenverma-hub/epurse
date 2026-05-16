import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { TabBarVisibilityProvider } from '../context/TabBarVisibilityContext';
import AnimatedTabBar from '../components/AnimatedTabBar';

import DashboardScreen  from '../screens/DashboardScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import InsightsScreen   from '../screens/InsightsScreen';
import AccountsScreen   from '../screens/AccountsScreen';

const Tab = createBottomTabNavigator();

export default function MainTabNavigator() {
  return (
    <TabBarVisibilityProvider>
      <Tab.Navigator
        tabBar={(props) => <AnimatedTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Dashboard"    component={DashboardScreen} />
        <Tab.Screen name="Transactions" component={TransactionsScreen} />
        <Tab.Screen name="Insights"     component={InsightsScreen} />
        <Tab.Screen name="Accounts"     component={AccountsScreen} />
      </Tab.Navigator>
    </TabBarVisibilityProvider>
  );
}
