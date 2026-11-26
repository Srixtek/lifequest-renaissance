import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { ep } from './eloriaPalette';
import { colors } from '../theme';

type ColumnCenters = { combat: number; camp: number; forge: number };

type Props = {
  height: number;
  forgeLevel: number;
  centers: ColumnCenters;
  buildingDp: number;
};

/** Village nocturne du bastion — fond composé (original SVG). */
export function BastionSceneArt({ height, forgeLevel, centers, buildingDp }: Props) {
  const vbH = 220;
  const scale = buildingDp / 72;
  const groundY = vbH - 28;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height={height} viewBox={`0 0 360 ${vbH}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="bastionSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ep.nightSkyTop} />
            <Stop offset="0.45" stopColor={ep.nightSkyMid} />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
          <RadialGradient id="moonGlow" cx="50%" cy="0%" r="65%">
            <Stop offset="0" stopColor={colors.gold} stopOpacity="0.22" />
            <Stop offset="1" stopColor={colors.bg} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="pathGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={ep.pathDust} stopOpacity="0.5" />
            <Stop offset="0.5" stopColor={ep.copperDim} stopOpacity="0.35" />
            <Stop offset="1" stopColor={ep.pathDust} stopOpacity="0.5" />
          </LinearGradient>
          <RadialGradient id="forgeGlow" cx="50%" cy="80%" r="50%">
            <Stop offset="0" stopColor={ep.forgeFire} stopOpacity={forgeLevel >= 1 ? 0.55 : 0} />
            <Stop offset="1" stopColor={ep.forgeFire} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x="0" y="0" width="360" height={vbH} fill="url(#bastionSky)" />
        <Rect x="0" y="0" width="360" height={vbH * 0.7} fill="url(#moonGlow)" />

        {[
          [28, 16],
          [90, 24],
          [150, 12],
          [250, 18],
          [310, 10],
        ].map(([x, y], i) => (
          <Circle key={`star-${i}`} cx={x} cy={y} r={i % 2 === 0 ? 1.1 : 0.8} fill={colors.goldBright} opacity={0.35 + (i % 3) * 0.12} />
        ))}

        <Circle cx="312" cy="32" r="14" fill={colors.gold} opacity="0.35" />
        <Circle cx="312" cy="32" r="20" fill={colors.gold} opacity="0.08" />

        {/* collines */}
        <Path d={`M0 ${groundY + 8} Q90 ${groundY - 22} 180 ${groundY - 8} T360 ${groundY + 6} V${vbH} H0 Z`} fill={ep.hillFar} opacity="0.85" />
        <Path d={`M0 ${groundY + 14} Q120 ${groundY + 2} 200 ${groundY + 10} T360 ${groundY + 12} V${vbH} H0 Z`} fill={ep.hillNear} opacity="0.55" />

        {/* arbres décor */}
        <Tree x={18} baseY={groundY + 4} h={52} />
        <Tree x={330} baseY={groundY + 4} h={48} dark />
        <Bush x={125} baseY={groundY + 18} />
        <Bush x={235} baseY={groundY + 16} />

        {/* chemin sinueux */}
        <Path
          d={`M20 ${groundY + 20} Q60 ${groundY + 8} ${centers.combat} ${groundY + 14}
            Q${(centers.combat + centers.camp) / 2} ${groundY + 6} ${centers.camp} ${groundY + 12}
            Q${(centers.camp + centers.forge) / 2} ${groundY + 4} ${centers.forge} ${groundY + 10}
            Q320 ${groundY + 16} 345 ${groundY + 22}`}
          stroke="url(#pathGrad)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* zones */}
        <ArenaMark cx={centers.combat} baseY={groundY} scale={scale} />
        <CampMark cx={centers.camp} baseY={groundY} scale={scale} />
        <ForgeMark cx={centers.forge} baseY={groundY} scale={scale} level={forgeLevel} />

        {forgeLevel >= 1 ? <Ellipse cx={centers.forge} cy={groundY - 42 * scale} rx={38 * scale} ry={28 * scale} fill="url(#forgeGlow)" /> : null}

        <Path d={`M0 ${groundY + 22} L360 ${groundY + 22} L360 ${vbH} L0 ${vbH} Z`} fill="#070F0E" opacity="0.9" />

        {/* labels */}
        <ZoneLabel x={centers.combat} y={groundY + 36} text="Arène" accent={colors.goldBright} />
        <ZoneLabel x={centers.camp} y={groundY + 36} text="Camp" accent={colors.ink} />
        <ZoneLabel x={centers.forge} y={groundY + 36} text="Forge" accent={forgeLevel > 0 ? colors.gold : colors.muted} />
      </Svg>
    </View>
  );
}

function ZoneLabel({ x, y, text, accent }: { x: number; y: number; text: string; accent: string }) {
  return (
    <SvgText
      x={x}
      y={y}
      fill={accent}
      fontSize="11"
      fontWeight="700"
      textAnchor="middle"
    >
      {text}
    </SvgText>
  );
}

function Tree({ x, baseY, h, dark }: { x: number; baseY: number; h: number; dark?: boolean }) {
  const fill = dark ? ep.bark : ep.moss;
  return (
    <G>
      <Path d={`M${x} ${baseY} L${x + 10} ${baseY - h} L${x + 20} ${baseY} Z`} fill={fill} />
      <Path d={`M${x + 4} ${baseY - h * 0.55} L${x + 10} ${baseY - h * 0.95} L${x + 16} ${baseY - h * 0.55} Z`} fill={dark ? '#24564D' : '#356B5E'} opacity={0.85} />
    </G>
  );
}

function Bush({ x, baseY }: { x: number; baseY: number }) {
  return <Ellipse cx={x} cy={baseY - 6} rx="14" ry="8" fill={ep.moss} opacity="0.7" />;
}

function ArenaMark({ cx, baseY, scale }: { cx: number; baseY: number; scale: number }) {
  const w = 52 * scale;
  const h = 38 * scale;
  return (
    <G>
      <Ellipse cx={cx} cy={baseY - 4} rx={w * 0.55} ry={h * 0.22} fill={ep.stoneDark} opacity="0.9" />
      <Path
        d={`M${cx - w / 2} ${baseY - h * 0.15} A${w / 2} ${h * 0.35} 0 0 1 ${cx + w / 2} ${baseY - h * 0.15}
          L${cx + w * 0.38} ${baseY - h * 0.55} L${cx} ${baseY - h * 0.72} L${cx - w * 0.38} ${baseY - h * 0.55} Z`}
        fill={ep.stone}
        stroke={colors.goldDim}
        strokeWidth="0.8"
      />
      <Path d={`M${cx - 6} ${baseY - h * 0.5} L${cx + 6} ${baseY - h * 0.5}`} stroke={colors.goldBright} strokeWidth="1.2" opacity="0.7" />
      <Circle cx={cx} cy={baseY - h * 0.62} r={3 * scale} fill={colors.goldBright} opacity="0.5" />
    </G>
  );
}

function CampMark({ cx, baseY, scale }: { cx: number; baseY: number; scale: number }) {
  const w = 48 * scale;
  return (
    <G>
      <Path
        d={`M${cx - w * 0.42} ${baseY} L${cx} ${baseY - 46 * scale} L${cx + w * 0.42} ${baseY} Z`}
        fill="#2E5E52"
        stroke={colors.goldDim}
        strokeWidth="0.7"
      />
      <Rect x={cx - w * 0.12} y={baseY - 22 * scale} width={w * 0.24} height={22 * scale} rx="1" fill={colors.copperDim} />
      <Ellipse cx={cx} cy={baseY - 6} rx={22 * scale} ry={7 * scale} fill={colors.ember} opacity="0.35" />
      <Path
        d={`M${cx - 4} ${baseY - 12} Q${cx} ${baseY - 22} ${cx + 4} ${baseY - 12}`}
        fill={colors.ember}
        opacity="0.85"
      />
      <Circle cx={cx + w * 0.3} cy={baseY - 8} r={2.5 * scale} fill={ep.lantern} opacity="0.8" />
    </G>
  );
}

function ForgeMark({ cx, baseY, scale, level }: { cx: number; baseY: number; scale: number; level: number }) {
  const w = 50 * scale;
  return (
    <G opacity={level === 0 ? 0.78 : 1}>
      {level >= 2 ? (
        <Path
          d={`M${cx - w * 0.55} ${baseY} V${baseY - 38 * scale} H${cx + w * 0.55} V${baseY} Z`}
          fill={ep.stoneDark}
          stroke={colors.line}
          strokeWidth="0.6"
        />
      ) : null}
      <Rect x={cx - w * 0.38} y={baseY - 32 * scale} width={w * 0.76} height={32 * scale} rx="1" fill="#3D4F4A" stroke={colors.line} strokeWidth="0.5" />
      <Path d={`M${cx - w * 0.5} ${baseY - 34 * scale} L${cx} ${baseY - 48 * scale} L${cx + w * 0.5} ${baseY - 34 * scale} Z`} fill="#4A5C57" stroke={colors.copperDim} strokeWidth="0.6" />
      <Rect x={cx - w * 0.22} y={baseY - 14 * scale} width={w * 0.44} height={6 * scale} fill={ep.stone} />
      <Rect x={cx - w * 0.08} y={baseY - 20 * scale} width={w * 0.16} height={10 * scale} fill={colors.copper} />
      {level >= 1 ? (
        <G>
          <Circle cx={cx} cy={baseY - 24 * scale} r={8 * scale} fill={colors.ember} opacity="0.5" />
          <Path d={`M${cx - 3} ${baseY - 22} Q${cx} ${baseY - 30} ${cx + 3} ${baseY - 22}`} fill={level >= 2 ? colors.goldBright : colors.ember} />
        </G>
      ) : null}
      {level >= 2 ? <Rect x={cx + w * 0.28} y={baseY - 28 * scale} width={w * 0.12} height={20 * scale} fill={colors.copperDim} /> : null}
    </G>
  );
}