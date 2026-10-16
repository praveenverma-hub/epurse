import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { TabBarVisibilityProvider } from '../context/TabBarVisibilityContext';
import AnimatedTabBar from '../components/AnimatedTabBar';
import { useEPurseStore, selectAccountsTracked } from '../store/ePurseStore';

import DashboardScreen  from '../screens/DashboardScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import InsightsScreen   from '../screens/InsightsScreen';
import AccountsScreen   from '../screens/AccountsScreen';
import GroupsScreen     from '../screens/GroupsScreen';

const Tab = createBottomTabNavigator();

export default function MainTabNavigator() {
  const accountsTracked = useEPurseStore(selectAccountsTracked);

  return (
    <TabBarVisibilityProvider>
      <Tab.Navigator
        tabBar={(props) => (
          <AnimatedTabBar
            {...props}
            onCenterPress={accountsTracked ? undefined : () => props.navigation.navigate('AddTransaction')}
          />
        )}
        screenOptions={{ headerShown: false }}
        backBehavior="history"
      >
        <Tab.Screen name="Dashboard"    component={DashboardScreen} />
        <Tab.Screen name="Transactions" component={TransactionsScreen} />
        <Tab.Screen name="Groups"       component={GroupsScreen} />
        <Tab.Screen name="Insights"     component={InsightsScreen} />
        {accountsTracked ? <Tab.Screen name="Accounts" component={AccountsScreen} /> : null}
      </Tab.Navigator>
    </TabBarVisibilityProvider>
  );
}
