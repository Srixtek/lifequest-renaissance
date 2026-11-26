import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  TabAdventureIcon,
  TabGoalsIcon,
  TabHeroIcon,
  TabHomeIcon,
  TabStatsIcon,
} from '@/src/design-system/icons';
import { colors, spacing } from '@/src/design-system/theme';

const TAB_BASE_HEIGHT = 56;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? spacing.sm : 0);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.line,
          height: TAB_BASE_HEIGHT + bottomPad,
          paddingTop: spacing.xs,
          paddingBottom: bottomPad,
        },
        tabBarActiveTintColor: colors.goldBright,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="camp"
        options={{
          title: 'Accueil',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabHomeIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Habitudes',
          tabBarIcon: ({ focused }) => <TabGoalsIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="adventure"
        options={{
          title: 'Royaume',
          tabBarIcon: ({ focused }) => <TabAdventureIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="character"
        options={{
          title: 'Héros',
          tabBarIcon: ({ focused }) => <TabHeroIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Bilan',
          tabBarIcon: ({ focused }) => <TabStatsIcon focused={focused} />,
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}