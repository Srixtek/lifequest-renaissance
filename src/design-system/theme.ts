/**
 * Eloria — dark fantasy illustré : forêt nocturne, émeraude, cuivre, or vieilli, lueurs magiques.
 */
export const colors = {
  bg: '#070F0E',
  bgElevated: '#0F2420',
  mist: '#163A34',
  card: '#0D1F1C',
  cardHighlight: '#132A26',
  ink: '#E8F4EF',
  muted: '#8FA89F',
  forest: '#0A1E1B',
  emerald: '#3D8B72',
  emeraldBright: '#4DAF8C',
  emeraldDim: '#2A6352',
  copper: '#C17F4A',
  copperDim: '#8F5A32',
  gold: '#D4B56A',
  goldBright: '#E8CD82',
  goldDim: '#9A7D3E',
  glow: '#5EB89A',
  glowSoft: 'rgba(94, 184, 154, 0.18)',
  ember: '#E0A45A',
  emberDim: '#B8792E',
  success: '#5FAF7A',
  warn: '#D4A017',
  danger: '#C75C5C',
  line: '#243D38',
  lineBright: '#3A5A52',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

export const typography = {
  brand: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.5 },
  hero: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.3 },
  title: { fontSize: 22, fontWeight: '700' as const },
  subtitle: { fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  timer: { fontSize: 48, fontWeight: '700' as const, letterSpacing: 1 },
};

export const touchTarget = { minHeight: 48, minWidth: 48 };