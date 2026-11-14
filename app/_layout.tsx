import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppStore } from '@/src/state/appStore';
import { colors } from '@/src/design-system/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const ready = useAppStore((s) => s.ready);
  const profile = useAppStore((s) => s.profile);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    bootstrap().finally(() => {
      SplashScreen.hideAsync();
    });
  }, [bootstrap]);

  useEffect(() => {
    if (!ready) return;
    const inOnboarding = segments[0] === 'onboarding';
    if (!profile?.onboardingDone && !inOnboarding) {
      router.replace('/onboarding');
    } else if (profile?.onboardingDone && inOnboarding) {
      router.replace('/(tabs)/camp');
    }
  }, [ready, profile, segments, router]);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.ember} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="tools/breathing"
          options={{
            headerShown: true,
            title: 'Respiration',
            headerStyle: { backgroundColor: colors.bgElevated },
            headerTintColor: colors.ink,
          }}
        />
        <Stack.Screen
          name="tools/urge"
          options={{
            headerShown: true,
            title: 'Envie',
            headerStyle: { backgroundColor: colors.bgElevated },
            headerTintColor: colors.ink,
          }}
        />
        <Stack.Screen
          name="journal/index"
          options={{
            headerShown: true,
            title: 'Journal',
            headerStyle: { backgroundColor: colors.bgElevated },
            headerTintColor: colors.ink,
          }}
        />
        <Stack.Screen
          name="settings/index"
          options={{
            headerShown: true,
            title: 'Paramètres',
            headerStyle: { backgroundColor: colors.bgElevated },
            headerTintColor: colors.ink,
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
