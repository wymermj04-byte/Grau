import AsyncStorage from '@react-native-async-storage/async-storage';
import { ReactNode, createContext, useState, useMemo, useContext, useCallback, useEffect } from 'react';
import { useColorScheme as useNativeColorScheme, View } from 'react-native';
import { Theme } from './Theme';
import lightTheme from './themes/light';
import { vars } from 'nativewind';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  themePreference: ThemePreference;
  isThemePreferenceLoaded: boolean;
  setThemePreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: lightTheme,
  themePreference: 'system',
  isThemePreferenceLoaded: false,
  setThemePreference: () => {},
});

const themePreferenceStorageKey = 'garde-zero.theme-preference';

export const ThemeProvider = ({
  themes,
  children,
}: {
  themes: Theme[];
  children: ReactNode;
}) => {
  if (themes.length === 0) {
    throw new Error('At least one theme must be provided in the ThemeProvider');
  }

  const nativeColorScheme = useNativeColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [isThemePreferenceLoaded, setIsThemePreferenceLoaded] = useState(false);

  useEffect(() => {
    let isActive = true;

    AsyncStorage.getItem(themePreferenceStorageKey)
      .then((storedPreference) => {
        if (!isActive) return;
        if (storedPreference === 'light' || storedPreference === 'dark' || storedPreference === 'system') {
          setThemePreferenceState(storedPreference);
        }
      })
      .catch(() => {
        // A system preference remains a safe fallback if local storage is unavailable.
      })
      .finally(() => {
        if (isActive) setIsThemePreferenceLoaded(true);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const resolvedThemeName = themePreference === 'system'
    ? nativeColorScheme === 'dark' ? 'dark' : 'light'
    : themePreference;

  const currentTheme = useMemo(
    () => themes.find((theme) => theme.name === resolvedThemeName) ?? themes[0],
    [resolvedThemeName, themes],
  );

  const setThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    AsyncStorage.setItem(themePreferenceStorageKey, preference).catch(() => {
      // The selected preference remains active for this session if persistence is unavailable.
    });
  }, []);

  const themeContextValue: ThemeContextValue = useMemo(
    () => ({
      theme: currentTheme,
      themePreference,
      isThemePreferenceLoaded,
      setThemePreference,
    }),
    [currentTheme, isThemePreferenceLoaded, setThemePreference, themePreference],
  );

  const flattenedTypographyVariables = useMemo(() => {
    const flattened: Record<string, string> = {};
    Object.entries(currentTheme.typography).forEach(([typographyItem, values]) => {
      if (values) {
        Object.entries(values).forEach(([key, value]) => {
          if (value !== undefined) {
            flattened[`${typographyItem}-${key}`] = value;
          }
        });
      }
    });
    return flattened;
  }, [currentTheme.typography]);

  const strippedHslColors = useMemo(() => {
    const stripped: Record<string, string> = {};
    Object.entries(currentTheme.colors).forEach(([key, value]) => {
      if (value?.startsWith('hsl(')) {
        stripped[key] = value.replace('hsl(', '').replace(')', '');
      }
    });
    return stripped;
  }, [currentTheme.colors]);

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <View
        className="h-full w-full"
        style={vars({ ...strippedHslColors, ...flattenedTypographyVariables })}>
        {children}
      </View>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  return useContext(ThemeContext);
};
