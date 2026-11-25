/** Eloria — forêt profonde, émeraude, or ancien, ambre chaud. */
export const colors = {
  bg: '#0B1C1A',
  bgElevated: '#12302B',
  mist: '#1A3F3A',
  card: '#102824',
  ink: '#EAF5F0',
  muted: '#9BB5AD',
  forest: '#0E2A26',
  emerald: '#3D8B72',
  emeraldDim: '#2A6352',
  gold: '#D4B56A',
  goldDim: '#A88B42',
  ember: '#E0A45A',
  emberDim: '#B8792E',
  success: '#5FAF7A',
  warn: '#D4A017',
  danger: '#C75C5C',
  line: '#2A4A44',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const typography = {
  brand: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  subtitle: { fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
};
