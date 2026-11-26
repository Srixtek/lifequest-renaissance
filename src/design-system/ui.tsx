import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from './theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

/** Onglets : inset haut fixe hors scroll (barre d’état) + marge bas pour la tab bar. */
export function TabScrollView({
  children,
  safeTop = false,
  flushHorizontal = false,
  contentContainerStyle,
  style,
  ...scrollProps
}: {
  children: React.ReactNode;
  /** À true quand l’écran n’a pas de header natif (ex. Accueil). */
  safeTop?: boolean;
  /** Le contenu gère son propre padding horizontal (ex. illustration pleine largeur). */
  flushHorizontal?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
} & Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'style'>) {
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + spacing.xxl;

  const screenPad: ViewStyle = {
    paddingBottom: 0,
    ...(safeTop ? { paddingTop: insets.top } : null),
    ...(flushHorizontal ? { paddingHorizontal: 0 } : null),
  };

  return (
    <Screen style={screenPad}>
      <ScrollView
        style={[{ flex: 1 }, style]}
        contentContainerStyle={[
          {
            paddingBottom: bottomPad,
            paddingTop: safeTop ? spacing.xs : spacing.sm,
            paddingHorizontal: flushHorizontal ? spacing.lg : 0,
          },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

export function BrandTitle({ subtitle }: { subtitle?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.brand}>LifeQuest</Text>
      <Text style={styles.brandSub}>Renaissance · Eloria</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function SectionTitle({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <Text style={[styles.sectionTitle, accent && styles.sectionTitleAccent]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'neutral';
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        variant === 'neutral' && styles.btnNeutral,
        disabled && styles.btnDisabled,
        pressed && !disabled && { opacity: 0.88 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'secondary' && styles.btnTextSecondary,
          variant === 'ghost' && styles.btnTextGhost,
          variant === 'danger' && styles.btnTextDanger,
          variant === 'neutral' && styles.btnTextNeutral,
        ]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SecondaryLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        style={[styles.chipText, selected && styles.chipTextSelected]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.9}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  brand: { ...typography.brand, color: colors.ember },
  brandSub: { ...typography.caption, color: colors.muted, marginTop: 2 },
  title: { ...typography.title, color: colors.ink, marginBottom: spacing.sm },
  sectionTitle: {
    ...typography.title,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 20,
  },
  sectionTitleAccent: { color: colors.gold },
  body: { ...typography.body, color: colors.ink },
  muted: { color: colors.muted },
  btn: {
    backgroundColor: colors.copper,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.goldDim,
  },
  btnCompact: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    marginTop: 0,
  },
  btnSecondary: {
    backgroundColor: colors.cardHighlight,
    borderColor: colors.emeraldDim,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.line,
  },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnNeutral: {
    backgroundColor: colors.mist,
    borderColor: colors.line,
  },
  btnDisabled: {
    opacity: 0.45,
    backgroundColor: colors.mist,
    borderColor: colors.line,
  },
  btnText: { color: '#1A1208', fontWeight: '700', fontSize: 16 },
  btnTextSecondary: { color: colors.ink },
  btnTextGhost: { color: colors.muted },
  btnTextDanger: { color: colors.ink },
  btnTextNeutral: { color: colors.muted },
  link: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: { ...typography.body, color: colors.gold, fontWeight: '600', fontSize: 15 },
  input: {
    borderWidth: 1,
    borderColor: colors.lineBright,
    backgroundColor: colors.bgElevated,
    color: colors.ink,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: spacing.sm,
    fontSize: 16,
    minHeight: 48,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: '100%',
  },
  chipSelected: { backgroundColor: colors.mist, borderColor: colors.goldDim },
  chipText: { color: colors.muted },
  chipTextSelected: { color: colors.ink, fontWeight: '600' },
});
