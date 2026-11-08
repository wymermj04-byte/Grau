import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';
import { useTheme } from '@/theming/ThemeProvider';

type LoadingIndicatorProps = ActivityIndicatorProps & {
  tone?: 'primary' | 'on-primary';
};

function LoadingIndicator({ tone = 'primary', color, ...props }: LoadingIndicatorProps) {
  const { theme } = useTheme();
  const semanticColor = tone === 'on-primary' ? theme.colors.primaryForeground : theme.colors.primary;

  return <ActivityIndicator color={color ?? semanticColor} {...props} />;
}

export { LoadingIndicator };
