import { Theme } from '../Theme';

const darkTheme: Theme = {
  name: 'dark',
  colors: {
    background: 'hsl(165 8% 10%)',
    foreground: 'hsl(44 31% 93%)',
    card: 'hsl(146 8% 17%)',
    cardForeground: 'hsl(44 31% 93%)',
    popover: 'hsl(146 8% 17%)',
    popoverForeground: 'hsl(44 31% 93%)',
    primary: 'hsl(3 54% 42%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(146 8% 17%)',
    secondaryForeground: 'hsl(44 31% 93%)',
    tertiary: 'hsl(3 54% 42%)',
    tertiaryForeground: 'hsl(0 0% 100%)',
    muted: 'hsl(146 8% 17%)',
    mutedForeground: 'hsl(125 10% 78%)',
    accent: 'hsl(125 8% 24%)',
    accentForeground: 'hsl(44 31% 93%)',
    success: 'hsl(155 52% 44%)',
    successForeground: 'hsl(0 0% 100%)',
    warning: 'hsl(37 87% 62%)',
    warningForeground: 'hsl(165 8% 10%)',
    destructive: 'hsl(0 81% 65%)',
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

export default darkTheme;
