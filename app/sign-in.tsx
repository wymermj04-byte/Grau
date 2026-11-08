import * as React from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { ThemedTextInput } from '@/components/ui/themed-text-input';
import LucideIcon from '@/lib/icons/LucideIcon';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theming/ThemeProvider';

const styles = StyleSheet.create({
  logo: {
    height: 176,
    width: '100%',
  },
});

export default function SignInScreen() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { signIn } = useAuth();
  const { theme } = useTheme();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await signIn(email, password);
      const safeReturnTo = returnTo === '/check-in/4' ? returnTo : '/';
      router.replace(safeReturnTo);
    } catch {
      setErrorMessage('Sign-in failed. Check your email and password, then try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-center px-6 py-8"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full max-w-md self-center">
            <View className={theme.name === 'light'
              ? 'overflow-hidden rounded-3xl bg-card px-5 py-3'
              : 'overflow-hidden rounded-3xl bg-background'}>
              <Image
                accessibilityLabel="GRAU logo"
                className="h-44 w-full"
                resizeMode="contain"
                source={theme.name === 'light'
                  ? require('../assets/images/grau-logo-charcoal.png')
                  : require('../assets/images/grau-logo-ivory-on-charcoal.png')}
                style={styles.logo}
              />
            </View>
            <View className="mt-7">
              <Text className="text-2xl font-bold tracking-tight text-foreground">Sign in to GRAU</Text>
              <Text className="mt-2 text-sm leading-5 text-muted-foreground">
                Use the coach account created by your gym administrator.
              </Text>
              <Text className="mb-2 mt-7 font-bold text-foreground">Email</Text>
              <ThemedTextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="coach@example.com"
                className="rounded-xl border border-border bg-card px-4 py-3.5 text-base text-foreground"
              />
              <Text className="mb-2 mt-5 font-bold text-foreground">Password</Text>
              <ThemedTextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                secureTextEntry
                placeholder="Your password"
                className="rounded-xl border border-border bg-card px-4 py-3.5 text-base text-foreground"
              />
              {errorMessage ? (
                <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/15 px-4 py-3">
                  <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" />
                  <Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                disabled={!email.trim() || !password || isSubmitting}
                onPress={submit}
                className={`mt-7 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${!email.trim() || !password || isSubmitting ? 'opacity-60' : ''}`}
              >
                {isSubmitting ? (
                  <LoadingIndicator tone="on-primary" />
                ) : (
                  <LucideIcon name="LogIn" className="h-5 w-5 text-primary-foreground" />
                )}
                <Text className="font-bold text-primary-foreground">
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </Text>
              </Pressable>
              <View className="mt-8 items-center gap-1">
                <Text className="text-center text-sm leading-6 text-muted-foreground">BUILT FOR THE MATS.</Text>
                <Text className="text-center text-sm leading-6 text-muted-foreground">POWERED BY DISCIPLINE.</Text>
                <Text className="text-center text-sm leading-6 text-muted-foreground">DRIVEN BY COMMUNITY.</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
