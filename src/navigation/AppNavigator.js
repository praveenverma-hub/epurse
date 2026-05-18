import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEPurseStore } from '../store/ePurseStore';

import PermissionScreen    from '../screens/PermissionScreen';
import MainTabNavigator    from './MainTabNavigator';
import AddTransactionScreen from '../screens/AddTransactionScreen';
import CategoriesScreen    from '../screens/CategoriesScreen';
import LentBorrowedScreen  from '../screens/LentBorrowedScreen';
import SmsDiagnosticScreen from '../screens/SmsDiagnosticScreen';
import RewardShop          from '../screens/RewardShop';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const hasOnboarded = useEPurseStore((s) => s.hasOnboarded);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={hasOnboarded ? 'Main' : 'Permission'}
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F4F5F7' },
        }}
      >
        {/* First-launch onboarding */}
        <Stack.Screen
          name="Permission"
          component={PermissionScreen}
          options={{ animation: 'fade' }}
        />

        {/* Main tab navigator — Dashboard / Transactions / Insights / Accounts */}
        <Stack.Screen name="Main" component={MainTabNavigator} options={{ animation: 'fade' }} />

        {/* Modal-style stack screens pushed on top of the tab bar */}
        <Stack.Screen
          name="AddTransaction"
          component={AddTransactionScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="Categories"    component={CategoriesScreen} />
        <Stack.Screen name="LentBorrowed"  component={LentBorrowedScreen} />
        <Stack.Screen name="SmsDiagnostic" component={SmsDiagnosticScreen} />
        <Stack.Screen
          name="RewardShop"
          component={RewardShop}
          options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: '#0A0E1A' } }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
