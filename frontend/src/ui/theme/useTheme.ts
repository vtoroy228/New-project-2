import { useLayoutEffect } from 'react';
import { buildCssVariables, tokens } from './tokens';

export const useTheme = () => {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const variables = buildCssVariables(tokens);

    Object.entries(variables).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
  }, []);

  return tokens;
};
