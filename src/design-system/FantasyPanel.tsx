import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, radius, spacing } from './theme';

export function FantasyPanel({
  children,
  style,
  accent = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  accent?: boolean;
}) {
  return (
    <View style={[styles.outer, accent && styles.outerAccent, style]}>
      <Svg
        width="100%"
        height={6}
        viewBox="0 0 320 6"
        preserveAspectRatio="none"
        style={styles.ornament}
      >
        <Defs>
          <LinearGradient id="panelLine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.goldDim} stopOpacity="0" />
            <Stop offset="0.5" stopColor={colors.gold} stopOpacity="0.6" />
            <Stop offset="1" stopColor={colors.goldDim} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M0 4 Q160 0 320 4" stroke="url(#panelLine)" strokeWidth="1.5" fill="none" />
      </Svg>
      <View style={styles.inner}>{children}</View>
      <Svg width="100%" height={4} viewBox="0 0 320 4" preserveAspectRatio="none">
        <Rect x="40" y="1" width="240" height="1" fill={colors.line} opacity={0.5} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  outerAccent: {
    borderColor: colors.goldDim,
    backgroundColor: colors.bgElevated,
  },
  ornament: { marginTop: spacing.xs },
  inner: { paddingTop: spacing.sm },
});