import { TextInput, type TextInputProps } from 'react-native';
import { useTheme } from '@/theming/ThemeProvider';

function ThemedTextInput({ placeholderTextColor, ...props }: TextInputProps) {
  const { theme } = useTheme();

  return <TextInput placeholderTextColor={placeholderTextColor ?? theme.colors.mutedForeground} {...props} />;
}

export { ThemedTextInput };
