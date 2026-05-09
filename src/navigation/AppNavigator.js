import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEPurseStore } from '../store/ePurseStore';

import PermissionScreen from '../screens/PermissionScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import AddTransactionScreen from '../screens/AddTransactionScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import CategoriesScreen from '../screens/CategoriesScreen';
import LentBorrowedScreen from '../screens/LentBorrowedScreen';
import SmsDiagnosticScreen from '../screens/SmsDiagnosticScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  // Read from the persisted store — if the user has already onboarded we skip
  // the permission screen entirely on subsequent launches.
  const hasOnboarded = useEPurseStore((s) => s.hasOnboarded);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={hasOnboarded ? 'Dashboard' : 'Permission'}
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F4F5F7' },
        }}
      >
        {/* First-launch permission / onboarding screen */}
        <Stack.Screen
          name="Permission"
          component={PermissionScreen}
          options={{ animation: 'fade' }}
        />

        {/* Main app screens */}
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Transactions" component={TransactionsScreen} />
        <Stack.Screen
          name="AddTransaction"
          component={AddTransactionScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="Analytics" component={AnalyticsScreen} />
        <Stack.Screen name="Categories" component={CategoriesScreen} />
        <Stack.Screen name="LentBorrowed" component={LentBorrowedScreen} />
        <Stack.Screen name="SmsDiagnostic" component={SmsDiagnosticScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
