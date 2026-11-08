import { Theme } from '../Theme';

const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: 'hsl(44 31% 93%)',
    foreground: 'hsl(165 8% 10%)',
    card: 'hsl(70 10% 89%)',
    cardForeground: 'hsl(165 8% 10%)',
    popover: 'hsl(44 31% 93%)',
    popoverForeground: 'hsl(165 8% 10%)',
    primary: 'hsl(3 54% 42%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(70 10% 89%)',
    secondaryForeground: 'hsl(165 8% 10%)',
    tertiary: 'hsl(3 54% 42%)',
    tertiaryForeground: 'hsl(0 0% 100%)',
    muted: 'hsl(70 10% 89%)',
    mutedForeground: 'hsl(146 8% 17%)',
    accent: 'hsl(125 10% 85%)',
    accentForeground: 'hsl(165 8% 10%)',
    success: 'hsl(155 54% 40%)',
    successForeground: 'hsl(0 0% 100%)',
    warning: 'hsl(37 80% 57%)',
    warningForeground: 'hsl(165 8% 10%)',
    destructive: 'hsl(0 72% 59%)',
    destructiveForeground: 'hsl(0 0% 100%)',
    border: 'hsl(125 4% 50%)',
    notification: 'hsl(3 54% 42%)',
    input: 'hsl(125 4% 50%)',
    ring: 'hsl(3 54% 42%)',
    overlay: 'hsl(0 0% 0%)',
  },
  typography: {
    h1: {
      fontSize: '32px',
      fontFamily: 'Inter_700Bold',
    },
    h2: {
      fontSize: '24px',
      fontFamily: 'Inter_700Bold',
    },
    h3: {
      fontSize: '20px',
      fontFamily: 'Inter_600SemiBold',
    },
    h4: {
      fontSize: '18px',
      fontFamily: 'Inter_600SemiBold',
    },
    h5: {
      fontSize: '16px',
      fontFamily: 'Inter_500Medium',
    },
    h6: {
      fontSize: '14px',
      fontFamily: 'Inter_500Medium',
    },
    body: {
      fontSize: '14px',
      fontFamily: 'Inter_400Regular',
    },
    caption: {
      fontSize: '12px',
      fontFamily: 'Inter_300Light',
    },
    button: {
      fontSize: '16px',
      fontFamily: 'Inter_500Medium',
    },
  },
};

export default lightTheme;
