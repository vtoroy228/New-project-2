export const tokens = {
  app: {
    eventName: 'csfest telegram cup',
    settingsTitle: 'настройки'
  },
  colors: {
    background: '#d9d9d9',
    card: '#f3f3f3',
    cardMuted: '#ffffff',
    accentMagenta: '#e86173',
    accentLime: '#45a62a',
    accentBlue: '#005ee8',
    textDark: '#0f0f0f',
    textMuted: '#3f3f3f',
    successGreen: '#0f6d18',
    borderSoft: '#000000',
    overlay: 'rgba(0, 0, 0, 0.35)',
    canvasSky: '#227a11',
    canvasGround: '#3cab28',
    canvasObstacle: '#0f2a10'
  },
  spacing: {
    xxs: 4,
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 22,
    xxl: 28
  },
  radius: {
    sm: 0,
    md: 2,
    lg: 4,
    xl: 6,
    full: 999
  },
  shadow: {
    card: 'none',
    floating: 'none'
  },
  typography: {
    fontFamily: '"Trigram", "Courier New", monospace',
    sizeXs: 11,
    sizeSm: 13,
    sizeMd: 15,
    sizeLg: 20,
    sizeXl: 28,
    weightRegular: 500,
    weightBold: 700
  },
  layout: {
    maxWidth: 520,
    headerHeight: 70,
    tabBarHeight: 58
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
