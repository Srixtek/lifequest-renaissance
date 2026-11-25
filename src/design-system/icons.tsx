import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';
import type { GoalTemplate } from '@/src/data/content/goalTemplates';

const S = 24;

function strokeColor(focused: boolean) {
  return focused ? colors.gold : colors.muted;
}

export function TabHomeIcon({ focused }: { focused: boolean }) {
  const c = strokeColor(focused);
  return (
    <Svg width={S} height={S} viewBox="0 0 24 24">
      <Path
        d="M4 11 L12 4 L20 11 V19 H15 V14 H9 V19 H4 Z"
        fill={focused ? colors.mist : 'none'}
        stroke={c}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TabGoalsIcon({ focused }: { focused: boolean }) {
  const c = strokeColor(focused);
  return (
    <Svg width={S} height={S} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="8" stroke={c} strokeWidth={1.5} fill={focused ? colors.mist : 'none'} />
      <Circle cx="12" cy="12" r="3" fill={focused ? colors.gold : c} />
    </Svg>
  );
}

export function TabAdventureIcon({ focused }: { focused: boolean }) {
  const c = strokeColor(focused);
  return (
    <Svg width={S} height={S} viewBox="0 0 24 24">
      <Path
        d="M5 18 L12 5 L19 18 Z"
        stroke={c}
        strokeWidth={1.5}
        fill={focused ? colors.mist : 'none'}
        strokeLinejoin="round"
      />
      <Path d="M9 14 H15" stroke={c} strokeWidth={1.2} />
    </Svg>
  );
}

export function TabHeroIcon({ focused }: { focused: boolean }) {
  const c = strokeColor(focused);
  return (
    <Svg width={S} height={S} viewBox="0 0 24 24">
      <Circle cx="12" cy="8" r="4" stroke={c} strokeWidth={1.5} fill={focused ? colors.mist : 'none'} />
      <Path d="M5 21 C5 16 8 13 12 13 C16 13 19 16 19 21" stroke={c} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

export function TabStatsIcon({ focused }: { focused: boolean }) {
  const c = strokeColor(focused);
  return (
    <Svg width={S} height={S} viewBox="0 0 24 24">
      <Rect x="4" y="14" width="4" height="6" rx="1" fill={focused ? colors.gold : c} />
      <Rect x="10" y="10" width="4" height="10" rx="1" fill={c} opacity={focused ? 1 : 0.7} />
      <Rect x="16" y="6" width="4" height="14" rx="1" fill={c} opacity={focused ? 1 : 0.5} />
    </Svg>
  );
}

export function CategoryIcon({ category, size = 28 }: { category: GoalTemplate['category']; size?: number }) {
  const c = colors.emerald;
  switch (category) {
    case 'A':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M8 18 Q12 6 16 18" stroke={c} strokeWidth={1.5} fill="none" />
          <Circle cx="12" cy="8" r="2" fill={colors.gold} opacity={0.6} />
        </Svg>
      );
    case 'B':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M8 6 H14 C17 6 18 9 16 11 C18 13 17 16 14 16 H8 Z" stroke={c} strokeWidth={1.5} fill={colors.mist} />
        </Svg>
      );
    case 'C':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="7" stroke={c} strokeWidth={1.5} fill="none" />
          <Path d="M12 8 V12 L15 15" stroke={colors.gold} strokeWidth={1.2} />
        </Svg>
      );
    case 'D':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M7 18 L12 6 L17 18" stroke={c} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
          <Circle cx="12" cy="14" r="2" fill={colors.gold} />
        </Svg>
      );
    case 'E':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="5" y="6" width="14" height="12" rx="2" stroke={c} strokeWidth={1.5} fill={colors.mist} />
          <Path d="M9 18 L9 20 M15 18 L15 20" stroke={c} strokeWidth={1.2} />
        </Svg>
      );
    case 'F':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="9" cy="9" r="3" stroke={c} strokeWidth={1.2} fill="none" />
          <Circle cx="16" cy="10" r="2.5" stroke={c} strokeWidth={1.2} fill="none" />
          <Path d="M4 20 C6 16 14 16 20 19" stroke={colors.gold} strokeWidth={1.2} fill="none" />
        </Svg>
      );
    default:
      return null;
  }
}

export function ClassSymbol({ classId, size = 32 }: { classId: string; size?: number }) {
  const c = colors.gold;
  switch (classId) {
    case 'rodeur':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 18 L14 8 L20 14" stroke={c} strokeWidth={1.5} fill="none" strokeLinecap="round" />
          <Circle cx="16" cy="6" r="2" fill={colors.emerald} />
        </Svg>
      );
    case 'gardien':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4 L18 8 V14 C18 18 12 21 12 21 C12 21 6 18 6 14 V8 Z" stroke={c} strokeWidth={1.5} fill={colors.mist} />
        </Svg>
      );
    case 'sage':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3 L14 9 H20 L15 13 L17 20 L12 16 L7 20 L9 13 L4 9 H10 Z" stroke={c} strokeWidth={1} fill={colors.mist} />
        </Svg>
      );
    case 'artisan':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="5" y="10" width="14" height="8" rx="1" stroke={c} strokeWidth={1.5} fill={colors.mist} />
          <Path d="M8 10 V7 H16 V10" stroke={c} strokeWidth={1.2} />
        </Svg>
      );
    default:
      return null;
  }
}