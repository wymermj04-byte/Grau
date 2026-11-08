import * as React from 'react';
import * as Linking from 'expo-linking';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import { ThemedTextInput } from '@/components/ui/themed-text-input';
import { formatSafeAuthFailure, toSafeAuthFailure, type SafeAuthFailure } from '@/lib/auth-failure';
import { parseAuthLink } from '@/lib/auth-link';
import { withAuthRequestTimeout, AuthRequestTimeoutError } from '@/lib/auth-request';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { usePasswordSetup } from '@/providers/PasswordSetupProvider';
import { destinationAfterIncompleteAuthCallback } from '@/lib/password-setup';

type LinkState = 'checking' | 'ready' | 'invalid' | 'error';

export default function AcceptInviteScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { beginPasswordSetup, canSetPassword, clearPasswordSetup } = usePasswordSetup();
  const [linkState, setLinkState] = React.useState<LinkState>('checking');
  const [failure, setFailure] = React.useState<SafeAuthFailure | null>(null);
  const [password, setPassword] = React.useState('');
  const [passwordConfirmation, setPasswordConfirmation] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const hasHandledLinkRef = React.useRef(false);
  const isMountedRef = React.useRef(true);
  const submitInFlightRef = React.useRef(false);
  const submitAttemptRef = React.useRef(0);

  const handleUrl = React.useCallback(async (url: string | null) => {
    if (!url || hasHandledLinkRef.current) return;
    hasHandledLinkRef.current = true;
    const payload = parseAuthLink(url);

    if (payload.kind === 'invalid') {
      if (isMountedRef.current) setLinkState('invalid');
      return;
    }
    if (payload.kind === 'error') {
      if (isMountedRef.current) {
        setFailure({ stage: 'Invitation session' });
        setLinkState('error');
      }
      return;
    }

    const result = payload.kind === 'code'
      ? await supabase.auth.exchangeCodeForSession(payload.code)
      : await supabase.auth.setSession({
        access_token: payload.accessToken,
        refresh_token: payload.refreshToken,
      });

    if (result.error || !result.data.session) {
      if (isMountedRef.current) {
        setFailure(toSafeAuthFailure('Invitation session', result.error));
        setLinkState('error');
      }
      return;
    }

    beginPasswordSetup(result.data.session.user.id);
    if (isMountedRef.current) setLinkState('ready');
  }, [beginPasswordSetup]);

  React.useEffect(() => {
    let isActive = true;
    isMountedRef.current = true;

    void Linking.getInitialURL().then((url) => {
      if (!isActive) return;
      if (!url) {
        setLinkState('invalid');
        return;
      }
      void handleUrl(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });
    return () => {
      isActive = false;
      isMountedRef.current = false;
      subscription.remove();
    };
  }, [handleUrl]);

  const submit = async () => {
    if (!password || !passwordConfirmation || isSubmitting || submitInFlightRef.current) return;
    if (password !== passwordConfirmation) {
      setFormError('The two passwords do not match.');
      return;
    }

    const attempt = submitAttemptRef.current + 1;
    submitAttemptRef.current = attempt;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setFailure(null);
    let failureStage: SafeAuthFailure['stage'] = 'Session validation';
    try {
      const userResult = await withAuthRequestTimeout(() => supabase.auth.getUser());
      if (!isMountedRef.current || submitAttemptRef.current !== attempt) return;
      if (userResult.error || !userResult.data.user) {
        setFailure(toSafeAuthFailure('Session validation', userResult.error));
        return;
      }

      failureStage = 'Password save';
      const { error } = await withAuthRequestTimeout(() => supabase.auth.updateUser({ password }));
      if (!isMountedRef.current || submitAttemptRef.current !== attempt) return;
      if (error) {
        setFailure(toSafeAuthFailure('Password save', error));
        return;
      }
      clearPasswordSetup();
      router.replace('/(tabs)');
    } catch (error) {
      if (isMountedRef.current && submitAttemptRef.current === attempt) {
        setFailure(toSafeAuthFailure(failureStage, error, error instanceof AuthRequestTimeoutError));
      }
    } finally {
      if (isMountedRef.current && submitAttemptRef.current === attempt) {
        submitInFlightRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const showPasswordForm = linkState === 'ready' && canSetPassword;

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow justify-center px-6 py-8"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full max-w-md self-center rounded-3xl bg-card px-6 py-8">
            <Text className="text-2xl font-bold tracking-tight text-foreground">Set your GRAU password</Text>
            {linkState === 'checking' ? (
              <View className="mt-6 items-center py-4">
                <LoadingIndicator />
                <Text className="mt-3 text-center text-sm text-muted-foreground">Verifying your invitation…</Text>
              </View>
            ) : null}
            {showPasswordForm ? (
              <>
                <Text className="mt-3 text-sm leading-5 text-muted-foreground">
                  Choose a password for your coach account. Your gym access remains controlled by your administrator.
                </Text>
                <Text className="mb-2 mt-7 font-bold text-foreground">New password</Text>
                <ThemedTextInput
                  value={password}
                  onChangeText={setPassword}
                  autoComplete="new-password"
                  secureTextEntry
                  placeholder="Choose a password"
                  className="rounded-xl border border-border bg-background px-4 py-3.5 text-base text-foreground"
                />
                <Text className="mb-2 mt-5 font-bold text-foreground">Confirm password</Text>
                <ThemedTextInput
                  value={passwordConfirmation}
                  onChangeText={setPasswordConfirmation}
                  autoComplete="new-password"
                  secureTextEntry
                  placeholder="Enter it again"
                  className="rounded-xl border border-border bg-background px-4 py-3.5 text-base text-foreground"
                />
                {formError ? <Text className="mt-4 text-sm leading-5 text-destructive">{formError}</Text> : null}
                {failure ? <Text className="mt-4 text-sm leading-5 text-destructive">{formatSafeAuthFailure(failure)}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save password"
                  disabled={!password || !passwordConfirmation || isSubmitting}
                  onPress={() => void submit()}
                  className={`mt-7 items-center rounded-2xl bg-primary py-4 ${!password || !passwordConfirmation || isSubmitting ? 'opacity-60' : ''}`}
                >
                  <Text className="font-bold text-primary-foreground">{isSubmitting ? 'Saving password…' : 'Save password'}</Text>
                </Pressable>
              </>
            ) : null}
            {linkState === 'invalid' || linkState === 'error' ? (
              <>
                <Text className="mt-4 text-sm leading-5 text-destructive">
                  {failure ? formatSafeAuthFailure(failure) : 'This invitation link is incomplete. Open the invitation email link to set your password.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Go to sign in"
                  onPress={() => router.replace(destinationAfterIncompleteAuthCallback(session?.user.id ?? null))}
                  className="mt-7 items-center rounded-2xl bg-primary py-4"
                >
                  <Text className="font-bold text-primary-foreground">Go to sign in</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
