import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
  darkColors,
  lightColors,
  darkElevation,
  lightElevation,
  healthCategories,
  typography,
  spacing,
  radius,
  animation,
  layout,
  controlHeights,
  visualizationForMode,
  type ThemeTokens,
} from './tokens';

interface ThemeContextValue {
  theme: ThemeTokens;
  mode: 'light' | 'dark';
  colors: ThemeTokens['colors'];
  health: ThemeTokens['health'];
  visualization: ReturnType<typeof visualizationForMode>;
  spacing: ThemeTokens['spacing'];
  radius: ThemeTokens['radius'];
  typography: ThemeTokens['typography'];
  elevation: ThemeTokens['elevation'];
  animation: ThemeTokens['animation'];
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  /**
   * 'dark' (default) keeps the app's current rendering byte-for-byte.
   * 'system' follows the device Appearance. 'light' forces light tokens.
   * Light mode is fully token-supported; screens migrate incrementally.
   */
  mode?: 'system' | 'light' | 'dark';
}

/**
 * HealthGraph theme provider.
 *
 * - Defaults to the existing dark palette (zero visual change).
 * - `mode="system"` follows the device Appearance setting.
 * - Components opt in via useTheme(); the shared primitives in /components
 *   already render correctly in both modes.
 */
export function ThemeProvider({ children, mode = 'dark' }: ThemeProviderProps) {
  const system = useColorScheme();
  const forced = mode !== 'system';
  const isDark = forced ? mode === 'dark' : system !== 'light';
  const themeMode = isDark ? 'dark' : 'light';

  const value = useMemo<ThemeContextValue>(() => {
    const theme: ThemeTokens = {
      colors: isDark ? darkColors : lightColors,
      health: healthCategories,
      typography,
      spacing,
      radius,
      elevation: isDark ? darkElevation : lightElevation,
      animation,
      layout,
      controlHeights,
      visualization: visualizationForMode(isDark),
      isDark,
    };
    return {
      theme,
      mode: themeMode,
      colors: theme.colors,
      health: theme.health,
      visualization: visualizationForMode(isDark),
      spacing: theme.spacing,
      radius: theme.radius,
      typography: theme.typography,
      elevation: theme.elevation,
      animation: theme.animation,
      isDark,
    };
  }, [isDark, themeMode]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Access the current theme. Throws if used outside ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Resolve theme tokens for a given mode without React context. */
export function themeForMode(mode: 'light' | 'dark'): ThemeTokens {
  const isDark = mode === 'dark';
  return {
    colors: isDark ? darkColors : lightColors,
    health: healthCategories,
    typography,
    spacing,
    radius,
    elevation: isDark ? darkElevation : lightElevation,
    animation,
    layout,
    controlHeights,
    visualization: visualizationForMode(isDark),
    isDark,
  };
}