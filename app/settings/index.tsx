import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { AppHeader } from '@/components/gym/AppHeader';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';
import { type ThemePreference, useTheme } from '@/theming/ThemeProvider';
import { isMessagingReadOnlyTestEnabled } from '@/lib/messaging-readonly-test-feature';
import { isMessagingControlledTestEnabled } from '@/lib/messaging-controlled-test-feature';
import { isPromotionNotificationsEnabled, promotionNotificationsCapability } from '@/lib/promotion-notifications-feature';

const isDevelopmentPreview = process.env.NODE_ENV === 'development';

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { linkedMembers, gymId, staffRole } = useGymAccess();
  const { themePreference, setThemePreference } = useTheme();
  const messagingReadOnlyTestEnabled = isMessagingReadOnlyTestEnabled();
  const messagingControlledTestEnabled = isMessagingControlledTestEnabled();
  const canOpenPromotionNotifications = isPromotionNotificationsEnabled()
    && gymId === promotionNotificationsCapability.gymId
    && (staffRole === 'admin' || staffRole === 'coach');
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const returnToDashboard = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  };

  const logout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setErrorMessage(null);
    try {
      await signOut();
    } catch {
      setErrorMessage('Could not sign out. Try again.');
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-2xl self-center pt-4">
          <AppHeader
            title="Settings"
            dataLabel="Gym administration"
            backAction={{
              accessibilityLabel: 'Back to dashboard',
              onPress: returnToDashboard,
            }}
          />
          <Text className="mt-2 text-3xl font-bold tracking-tight text-foreground">Settings</Text>
          <Text className="mt-2 text-sm leading-5 text-muted-foreground">Keep your gym’s public information current.</Text>

          <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Appearance</Text>
          <View className="rounded-2xl border border-border bg-card p-2">
            <Text className="px-2 pb-3 pt-2 text-sm leading-5 text-muted-foreground">Choose how GRAU looks on this device.</Text>
            <View className="flex-row flex-wrap gap-2">
              {(['system', 'light', 'dark'] as ThemePreference[]).map((preference) => {
                const selected = themePreference === preference;
                const label = preference === 'system' ? 'System' : preference === 'light' ? 'Light' : 'Dark';
                const icon = preference === 'system' ? 'Monitor' : preference === 'light' ? 'Sun' : 'MoonStar';
                return (
                  <Pressable
                    key={preference}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${label} theme`}
                    accessibilityState={{ selected }}
                    onPress={() => setThemePreference(preference)}
                    className={`min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl px-3 py-3 ${selected ? 'bg-primary' : 'bg-secondary active:bg-accent'}`}
                  >
                    <LucideIcon name={icon} className={`h-4 w-4 ${selected ? 'text-primary-foreground' : 'text-secondary-foreground'}`} />
                    <Text className={`font-bold ${selected ? 'text-primary-foreground' : 'text-secondary-foreground'}`}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Gym</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Open Gym Information" onPress={() => router.push('/settings/gym-information')} className="flex-row items-center rounded-2xl border border-border bg-card px-4 py-4 active:bg-accent"><View className="h-11 w-11 items-center justify-center rounded-xl bg-tertiary/15"><LucideIcon name="Building2" className="h-5 w-5 text-tertiary" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">Gym Information</Text><Text className="mt-1 text-xs text-muted-foreground">Name, contact details, website, and logo</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable>
          {canOpenPromotionNotifications ? <Pressable accessibilityRole="button" accessibilityLabel="Open promotion notifications" onPress={() => router.push('/promotion-notifications')} className="mt-3 flex-row items-center rounded-2xl border border-border bg-card px-4 py-4 active:bg-accent"><View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/15"><LucideIcon name="Award" className="h-5 w-5 text-primary" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">Promotion notifications</Text><Text className="mt-1 text-xs text-muted-foreground">Official Gym 4 celebration updates</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable> : null}

          {isDevelopmentPreview ? <><Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Development</Text><Pressable accessibilityRole="button" accessibilityLabel="Open signature pad test" onPress={() => router.push('/dev/signature-pad')} className="flex-row items-center rounded-2xl border border-warning/30 bg-card px-4 py-4 active:bg-accent"><View className="h-11 w-11 items-center justify-center rounded-xl bg-warning/15"><LucideIcon name="Signature" className="h-5 w-5 text-warning" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">Signature pad test</Text><Text className="mt-1 text-xs text-muted-foreground">TEST ONLY — nothing is saved</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable>{messagingReadOnlyTestEnabled ? <Pressable accessibilityRole="button" accessibilityLabel="Open messaging diagnostics" onPress={() => router.push('/dev/messaging-rpc')} className="mt-3 flex-row items-center rounded-2xl border border-warning/30 bg-card px-4 py-4 active:bg-accent"><View className="h-11 w-11 items-center justify-center rounded-xl bg-warning/15"><LucideIcon name="ShieldCheck" className="h-5 w-5 text-warning" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">Messaging diagnostics</Text><Text className="mt-1 text-xs text-muted-foreground">TEST ONLY — inbox RPCs only</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable> : null}{messagingControlledTestEnabled ? <Pressable accessibilityRole="button" accessibilityLabel="Open controlled messaging test" onPress={() => router.push('/dev/messaging-controlled-test')} className="mt-3 flex-row items-center rounded-2xl border border-destructive/30 bg-card px-4 py-4 active:bg-accent"><View className="h-11 w-11 items-center justify-center rounded-xl bg-destructive/15"><LucideIcon name="ShieldCheck" className="h-5 w-5 text-destructive" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">Controlled messaging test</Text><Text className="mt-1 text-xs text-muted-foreground">TEST ONLY — deliberate message checks</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable> : null}</> : null}

          <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Account</Text>
          {linkedMembers.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Open My members" onPress={() => router.push('/my-members')} className="mb-3 flex-row items-center rounded-2xl border border-border bg-card px-4 py-4 active:bg-accent"><View className="h-11 w-11 items-center justify-center rounded-xl bg-tertiary/15"><LucideIcon name="UsersRound" className="h-5 w-5 text-tertiary" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">My members</Text><Text className="mt-1 text-xs text-muted-foreground">Open your approved family member view</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Log out" disabled={isSigningOut} onPress={logout} className={`flex-row items-center rounded-2xl border border-destructive/30 bg-card px-4 py-4 ${isSigningOut ? 'opacity-60' : 'active:bg-destructive/10'}`}><View className="h-11 w-11 items-center justify-center rounded-xl bg-destructive/15">{isSigningOut ? <LoadingIndicator /> : <LucideIcon name="LogOut" className="h-5 w-5 text-destructive" />}</View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">{isSigningOut ? 'Signing out…' : 'Log out'}</Text><Text className="mt-1 text-xs text-muted-foreground">End this coach session on this device</Text></View></Pressable>{errorMessage ? <View className="mt-4 rounded-2xl bg-destructive/15 px-4 py-3"><Text className="text-sm text-foreground">{errorMessage}</Text></View> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
