export const tokens = {
  app: {
    eventName: 'NEON DINO CUP',
    settingsTitle: 'настройки'
  },
  colors: {
    background: '#CDFF3B',
    card: '#FFFFFF',
    cardMuted: '#F3F5FF',
    accentMagenta: '#FF2D9B',
    accentLime: '#CDFF3B',
    accentBlue: '#73A7FF',
    textDark: '#111321',
    textMuted: '#5C6073',
    successGreen: '#00A357',
    borderSoft: '#E2E6FF',
    overlay: 'rgba(17, 19, 33, 0.35)',
    canvasSky: '#F7FFE2',
    canvasGround: '#B5DE2D',
    canvasObstacle: '#1E2438'
  },
  spacing: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32
  },
  radius: {
    sm: 12,
    md: 18,
    lg: 24,
    xl: 30,
    full: 999
  },
  shadow: {
    card: '0 14px 24px rgba(17, 19, 33, 0.12)',
    floating: '0 8px 18px rgba(17, 19, 33, 0.22)'
  },
  typography: {
    fontFamily: '"Trigram", "Trebuchet MS", "Arial", sans-serif',
    sizeXs: 12,
    sizeSm: 14,
    sizeMd: 16,
    sizeLg: 22,
    sizeXl: 32,
    weightRegular: 500,
    weightBold: 700
  },
  layout: {
    maxWidth: 560,
    headerHeight: 80,
    tabBarHeight: 92
  }
} as const;

export type ThemeTokens = typeof tokens;

export const buildCssVariables = (theme: ThemeTokens): Record<string, string> => {
  return {
    '--color-background': theme.colors.background,
    '--color-card': theme.colors.card,
    '--color-card-muted': theme.colors.cardMuted,
    '--color-accent-magenta': theme.colors.accentMagenta,
    '--color-accent-lime': theme.colors.accentLime,
    '--color-accent-blue': theme.colors.accentBlue,
    '--color-text-dark': theme.colors.textDark,
    '--color-text-muted': theme.colors.textMuted,
    '--color-success-green': theme.colors.successGreen,
    '--color-border-soft': theme.colors.borderSoft,
    '--color-overlay': theme.colors.overlay,
    '--color-canvas-sky': theme.colors.canvasSky,
    '--color-canvas-ground': theme.colors.canvasGround,
    '--color-canvas-obstacle': theme.colors.canvasObstacle,
    '--space-xxs': `${theme.spacing.xxs}px`,
    '--space-xs': `${theme.spacing.xs}px`,
    '--space-sm': `${theme.spacing.sm}px`,
    '--space-md': `${theme.spacing.md}px`,
    '--space-lg': `${theme.spacing.lg}px`,
    '--space-xl': `${theme.spacing.xl}px`,
    '--space-xxl': `${theme.spacing.xxl}px`,
    '--radius-sm': `${theme.radius.sm}px`,
    '--radius-md': `${theme.radius.md}px`,
    '--radius-lg': `${theme.radius.lg}px`,
    '--radius-xl': `${theme.radius.xl}px`,
    '--radius-full': `${theme.radius.full}px`,
    '--shadow-card': theme.shadow.card,
    '--shadow-floating': theme.shadow.floating,
    '--font-family': theme.typography.fontFamily,
    '--font-size-xs': `${theme.typography.sizeXs}px`,
    '--font-size-sm': `${theme.typography.sizeSm}px`,
    '--font-size-md': `${theme.typography.sizeMd}px`,
    '--font-size-lg': `${theme.typography.sizeLg}px`,
    '--font-size-xl': `${theme.typography.sizeXl}px`,
    '--font-weight-regular': `${theme.typography.weightRegular}`,
    '--font-weight-bold': `${theme.typography.weightBold}`,
    '--layout-max-width': `${theme.layout.maxWidth}px`,
    '--layout-header-height': `${theme.layout.headerHeight}px`,
    '--layout-tabbar-height': `${theme.layout.tabBarHeight}px`
  };
};
