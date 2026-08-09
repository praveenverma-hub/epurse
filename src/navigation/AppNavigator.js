import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEPurseStore } from '../store/ePurseStore';

import OnboardingDeck, { AccountFilterScreen } from '../screens/OnboardingExperience';
import MainTabNavigator    from './MainTabNavigator';
import AddTransactionScreen from '../screens/AddTransactionScreen';
import AddGroupExpenseScreen from '../screens/AddGroupExpenseScreen';
import CategoriesScreen    from '../screens/CategoriesScreen';
import SettingsScreen      from '../screens/SettingsScreen';
import SpendRulesScreen    from '../screens/SpendRulesScreen';
import BackupScreen        from '../screens/BackupScreen';
import AccountDetailsScreen from '../screens/AccountDetailsScreen';
import LentBorrowedScreen  from '../screens/LentBorrowedScreen';
import BudgetPlanScreen    from '../screens/BudgetPlanScreen';
import LbPersonScreen      from '../screens/LbPersonScreen';
import SmsDiagnosticScreen from '../screens/SmsDiagnosticScreen';
import RewardShop          from '../screens/RewardShop';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const hasOnboarded = useEPurseStore((s) => s.hasOnboarded);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={hasOnboarded ? 'Main' : 'Onboarding'}
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F4F5F7' },
        }}
      >
        {/* First-launch onboarding — 4-slide deck + secure registration handshake */}
        <Stack.Screen
          name="Onboarding"
          component={OnboardingDeck}
          options={{ animation: 'fade', gestureEnabled: false }}
        />

        {/* "Is this yours?" account filter — shown once, right after the SMS
            permission handshake and before the dashboard mounts. */}
        <Stack.Screen
          name="AccountFilter"
          component={AccountFilterScreen}
          options={{ animation: 'fade', gestureEnabled: false }}
        />

        {/* Main tab navigator — Dashboard / Transactions / Insights / Accounts */}
        <Stack.Screen name="Main" component={MainTabNavigator} options={{ animation: 'fade' }} />

        {/* Full-screen "add" flows pushed on top of the tab bar */}
        <Stack.Screen name="AddTransaction"  component={AddTransactionScreen} />
        <Stack.Screen name="AddGroupExpense" component={AddGroupExpenseScreen} />
        <Stack.Screen name="Categories"     component={CategoriesScreen} />
        <Stack.Screen name="Settings"       component={SettingsScreen} />
        <Stack.Screen name="SpendRules"     component={SpendRulesScreen} />
        <Stack.Screen name="Backup"         component={BackupScreen} />
        <Stack.Screen name="AccountDetails" component={AccountDetailsScreen} />
        <Stack.Screen name="LentBorrowed"   component={LentBorrowedScreen} />
        <Stack.Screen name="BudgetPlan"     component={BudgetPlanScreen} />
        <Stack.Screen name="LbPerson"       component={LbPersonScreen} />
        <Stack.Screen name="SmsDiagnostic" component={SmsDiagnosticScreen} />
        <Stack.Screen
          name="RewardShop"
          component={RewardShop}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
