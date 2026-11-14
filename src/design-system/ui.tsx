import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, spacing, typography } from './theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
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

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        (pressed || disabled) && { opacity: 0.7 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'ghost' && styles.btnTextGhost,
          variant === 'danger' && styles.btnTextDanger,
        ]}
      >
        {label}
      </Text>
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
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
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
  body: { ...typography.body, color: colors.ink },
  muted: { color: colors.muted },
  btn: {
    backgroundColor: colors.ember,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: colors.bg, fontWeight: '700', fontSize: 16 },
  btnTextGhost: { color: colors.ink },
  btnTextDanger: { color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElevated,
    color: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: spacing.sm,
    fontSize: 16,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: { backgroundColor: colors.mist, borderColor: colors.ember },
  chipText: { color: colors.muted },
  chipTextSelected: { color: colors.ink, fontWeight: '600' },
});
