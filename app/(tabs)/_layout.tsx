import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors } from '@/src/design-system/theme';

function TabIcon({ focused, glyph }: { focused: boolean; glyph: string }) {
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colors.mist : 'transparent',
        borderWidth: 1,
        borderColor: focused ? colors.ember : colors.line,
      }}
    >
      <Text style={{ color: focused ? colors.ember : colors.muted, fontSize: 12, fontWeight: '700' }}>{glyph}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerTintColor: colors.ink,
        tabBarStyle: { backgroundColor: colors.bgElevated, borderTopColor: colors.line, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarActiveTintColor: colors.ember,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="camp"
        options={{
          title: 'Camp',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="C" />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Objectifs',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="O" />,
        }}
      />
      <Tabs.Screen
        name="adventure"
        options={{
          title: 'Aventure',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="A" />,
        }}
      />
      <Tabs.Screen
        name="character"
        options={{
          title: 'Héros',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="H" />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="S" />,
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
