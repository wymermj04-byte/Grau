import "@/global.css";
import "@/appearance-polyfill";

import {
  Theme as NavigationTheme,
  ThemeProvider as NavigationThemeProvider,
  DefaultTheme as NavigationDefaultTheme,
  DarkTheme as NavigationDarkTheme,
} from "@react-navigation/native";
import { Stack } from "expo-router/stack";
import { usePathname } from 'expo-router';
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { Text } from "@/components/ui/text";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider, useTheme } from "@/theming/ThemeProvider";
import darkTheme from "@/theming/themes/dark";
import lightTheme from "@/theming/themes/light";
import {
  useFonts,
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { PortalHost } from "@rn-primitives/portal";
import { WebPortalContext } from "@/components/WebPortalContext";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { GymAccessProvider, useGymAccess } from '@/providers/GymAccessProvider';
import { isMessagingEnabled } from '@/lib/messaging-feature';
import { isPromotionNotificationsEnabled, promotionNotificationsCapability } from '@/lib/promotion-notifications-feature';
import { isMessagingReadOnlyTestEnabled } from '@/lib/messaging-readonly-test-feature';
import { isMessagingControlledTestEnabled } from '@/lib/messaging-controlled-test-feature';
import { FAMILY_SELF_CHECK_IN_GYM_ID, isSelfCheckInEnabledForGym, isSelfCheckInPreviewEnabled } from '@/lib/self-check-in-feature';
import { isFamilySelfCheckInAuthorizationTestEnabled } from '@/lib/family-self-check-in-authorization-test-feature';
import { isFamilyLinkTestApprovalUtilityEnabled } from '@/lib/family-link-test-approval-feature';
import { isPromotionNotificationControlledTestEnabled } from '@/lib/promotion-notification-controlled-test-feature';
import { isPromotionNotificationFamilyReadOnlyTestEnabled, promotionNotificationFamilyReadOnlyTestCapability } from '@/lib/promotion-notification-family-readonly-test-feature';
import { PasswordSetupProvider } from '@/providers/PasswordSetupProvider';
import { INVITE_ACCEPT_PATH, bypassesGymAccessGuard } from '@/lib/auth-route-guard';

SplashScreen.preventAutoHideAsync();

const isDevelopmentPreview = process.env.NODE_ENV === 'development';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

function RootContent() {
  const hasMounted = React.useRef(false);
  const [portalContainer, setPortalContainer] = React.useState<View | null>(null);
  const portalContainerRef = React.useRef<View | null>(null);
  const { theme, isThemePreferenceLoaded } = useTheme();
  const { session, isRestoringSession, signOut } = useAuth();
  const { gymId, isResolvingAccess, accessStatus, accessError, linkedMembers, linkedGyms, staffRole } = useGymAccess();
  const messagingEnabled = isMessagingEnabled();
  const promotionNotificationsEnabled = isPromotionNotificationsEnabled();
  const messagingReadOnlyTestEnabled = isMessagingReadOnlyTestEnabled();
  const messagingControlledTestEnabled = isMessagingControlledTestEnabled();
  const selfCheckInPreviewEnabled = isSelfCheckInPreviewEnabled();
  const selfCheckInGymEnabled = isSelfCheckInEnabledForGym(FAMILY_SELF_CHECK_IN_GYM_ID);
  const familySelfCheckInAuthorizationTestEnabled = isFamilySelfCheckInAuthorizationTestEnabled();
  const familyLinkTestApprovalUtilityEnabled = isFamilyLinkTestApprovalUtilityEnabled();
  const promotionNotificationControlledTestEnabled = isPromotionNotificationControlledTestEnabled();
  const promotionNotificationFamilyReadOnlyTestEnabled = isPromotionNotificationFamilyReadOnlyTestEnabled();
  const pathname = usePathname();
  const [isColorSchemeLoaded, setIsColorSchemeLoaded] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);

  const setStablePortalContainer = React.useCallback((node: View | null) => {
    if (node && portalContainerRef.current === null) {
      portalContainerRef.current = node;
      setPortalContainer(node);
    }
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const isLoadingFonts = !fontsLoaded && !fontError;

  const navigationTheme: NavigationTheme = React.useMemo(() => {
    const navigationThemeBase = theme.name === 'dark' ? NavigationDarkTheme : NavigationDefaultTheme;
    const baseColors = navigationThemeBase.colors;
    return {
      ...navigationThemeBase,
      colors: {
        ...baseColors,
        background: theme.colors.background ?? baseColors.background,
        border: theme.colors.border ?? baseColors.border,
        card: theme.colors.card ?? baseColors.card,
        notification: theme.colors.destructive ?? baseColors.notification,
        primary: theme.colors.primary ?? baseColors.primary,
        text: theme.colors.foreground ?? baseColors.text,
      },
    };
  }, [theme]);

  React.useEffect(() => {
    if (hasMounted.current) {
      return;
    }

    if (Platform.OS === "web" && typeof document !== "undefined") {
      // Adds the background color to the html element to prevent white background on overscroll.
      // eslint-disable-next-line no-undef
      document.documentElement.classList.add("bg-background");
    }
    setIsColorSchemeLoaded(true);
    hasMounted.current = true;
  }, []);

  React.useEffect(() => {
    if (!isLoadingFonts) {
      SplashScreen.hideAsync();
    }
  }, [isLoadingFonts]);

  if (!isColorSchemeLoaded || isLoadingFonts || isRestoringSession || !isThemePreferenceLoaded) {
    return <View className="flex-1 items-center justify-center bg-background"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Restoring secure session…</Text></View>;
  }

  const isInviteRoute = bypassesGymAccessGuard(pathname);
  const hasResolvedAccess = Boolean(session && !isResolvingAccess && !accessError);
  const canReadAnnouncements = hasResolvedAccess && (accessStatus === 'staff' || accessStatus === 'family');
  const canCreateAnnouncements = hasResolvedAccess && accessStatus === 'staff' && (staffRole === 'admin' || staffRole === 'coach');

  if (session && isResolvingAccess && !isInviteRoute) {
    return <View className="flex-1 items-center justify-center bg-background px-6"><LoadingIndicator /><Text className="mt-3 text-center text-sm text-muted-foreground">Verifying gym access…</Text></View>;
  }
  if (session && accessError && !isInviteRoute) {
    const title = accessStatus === 'lookup-failed' ? 'Gym access unavailable' : accessStatus === 'selection-required' ? 'Gym selection required' : 'Gym access required';
    const handleSignOut = async () => {
      if (isSigningOut) return;
      setIsSigningOut(true);
      setSignOutError(null);
      try {
        await signOut();
      } catch {
        setSignOutError('Could not sign out. Try again.');
        setIsSigningOut(false);
      }
    };
    return <View className="flex-1 items-center justify-center bg-background px-6"><View className={`w-full max-w-sm items-center rounded-3xl px-6 py-10 ${accessStatus === 'lookup-failed' ? 'bg-destructive/10' : 'bg-warning/15'}`}><Text className="text-center text-xl font-bold text-foreground">{title}</Text><Text className="mt-3 text-center text-sm leading-5 text-muted-foreground">{accessError}</Text>{signOutError ? <Text className="mt-4 text-center text-sm text-destructive">{signOutError}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="Sign out and switch account" disabled={isSigningOut} onPress={handleSignOut} className={`mt-7 flex-row items-center justify-center rounded-xl bg-primary px-5 py-3 ${isSigningOut ? 'opacity-60' : ''}`}><Text className="font-bold text-primary-foreground">{isSigningOut ? 'Signing out…' : 'Sign out and switch account'}</Text></Pressable></View></View>;
  }

  return (
    <WebPortalContext.Provider
      value={{ container: portalContainer as unknown as HTMLElement | null }}
    >
      <NavigationThemeProvider value={navigationTheme}>
        <StatusBar style={theme.name === 'dark' ? "light" : "dark"} />
        <Stack
          key={session?.user.id ?? 'signed-out'}
          screenOptions={() => ({
            headerStyle: {
              backgroundColor: theme.colors.background,
              borderBottomColor: theme.colors.border,
            },
            headerTintColor: theme.colors.foreground,
            headerTitleAlign: "center",
            headerTitleStyle: {
              fontFamily: theme.typography.h1?.fontFamily,
            },

            headerRight: () => <ThemeToggle />,
          })}
        >
          <Stack.Protected guard={isInviteRoute}>
            <Stack.Screen name={INVITE_ACCEPT_PATH.slice(1)} options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!session}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Screen name="check-in/[gymId]" options={{ headerShown: false }} />
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError)}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && accessStatus === 'staff')}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="attendance-reports" options={{ headerShown: false }} />
            <Stack.Screen name="financial-reports" options={{ headerShown: false }} />
            <Stack.Screen name="payment-tracking" options={{ headerShown: false }} />
            <Stack.Screen name="billing" options={{ headerShown: false }} />
            <Stack.Screen name="settings/index" options={{ headerShown: false }} />
            <Stack.Screen name="settings/gym-information" options={{ headerShown: false }} />
            <Stack.Screen name="promotions" options={{ headerShown: false }} />
            <Stack.Screen name="members/[studentId]" options={{ headerShown: false }} />
            <Stack.Screen name="members/add" options={{ headerShown: false }} />
            <Stack.Screen name="members/[studentId]/[action]" options={{ headerShown: false }} />
            <Stack.Screen name="members/[studentId]/check-in" options={{ headerShown: false }} />
            <Stack.Screen
              name="members/[studentId]/attendance-history"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="members/[studentId]/promote" options={{ headerShown: false }} />
            <Stack.Screen name="members/[studentId]/add-payment" options={{ headerShown: false }} />
            <Stack.Screen
              name="members/[studentId]/payment-history"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="members/[studentId]/edit" options={{ headerShown: false }} />
            <Stack.Screen name="members/[studentId]/waiver" options={{ headerShown: false }} />
            <Stack.Screen name="members/[studentId]/stripe-progress-setup" options={{ headerShown: false }} />
            <Stack.Screen name="classes/add" options={{ headerShown: false }} />
            <Stack.Screen name="classes/[classId]" options={{ headerShown: false }} />
            <Stack.Screen name="classes/[classId]/edit" options={{ headerShown: false }} />
            <Stack.Protected guard={Boolean(selfCheckInGymEnabled && gymId === FAMILY_SELF_CHECK_IN_GYM_ID)}>
              <Stack.Screen name="classes/[classId]/family-check-in-requests" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack.Protected>
          <Stack.Protected guard={canReadAnnouncements}>
            <Stack.Screen name="announcements" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(messagingEnabled && session && !isResolvingAccess && !accessError && (accessStatus === 'family' || accessStatus === 'staff'))}>
            <Stack.Screen name="messages/index" options={{ headerShown: false }} />
            <Stack.Screen name="messages/[conversationId]" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(
            promotionNotificationsEnabled
            && session
            && !isResolvingAccess
            && !accessError
            && accessStatus === 'family'
            && linkedGyms.some((gym) => gym.gym_id === promotionNotificationsCapability.gymId)
          )}>
            <Stack.Screen name="promotion-notifications" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(
            session
            && !isResolvingAccess
            && !accessError
            && accessStatus === 'family'
            && (
              (messagingEnabled && linkedGyms.length > 0)
              || (promotionNotificationsEnabled
                && linkedGyms.some((gym) => gym.gym_id === promotionNotificationsCapability.gymId))
            )
          )}>
            <Stack.Screen name="notifications" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={canCreateAnnouncements}>
            <Stack.Screen name="announcements/create" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && (accessStatus === 'family' || accessStatus === 'unlinked' || (accessStatus === 'staff' && linkedMembers.length > 0)))}>
            <Stack.Screen name="my-members" options={{ headerShown: false }} />
            <Stack.Screen name="my-members/[studentId]" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && selfCheckInGymEnabled && linkedGyms.some((gym) => gym.gym_id === FAMILY_SELF_CHECK_IN_GYM_ID) && (accessStatus === 'family' || (accessStatus === 'staff' && gymId === FAMILY_SELF_CHECK_IN_GYM_ID)))}>
            <Stack.Screen name="family-check-in/[gymId]" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview)}>
            <Stack.Screen name="dev/signature-pad" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && messagingReadOnlyTestEnabled && (accessStatus === 'family' || accessStatus === 'staff'))}>
            <Stack.Screen name="dev/messaging-rpc" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && messagingControlledTestEnabled && (accessStatus === 'family' || accessStatus === 'staff'))}>
            <Stack.Screen name="dev/messaging-controlled-test" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && selfCheckInPreviewEnabled && accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === 4))}>
            <Stack.Screen name="dev/family-self-check-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && selfCheckInPreviewEnabled && accessStatus === 'staff' && (staffRole === 'admin' || staffRole === 'coach'))}>
            <Stack.Screen name="dev/family-check-in-qr" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && selfCheckInPreviewEnabled && ((accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === 4)) || (accessStatus === 'staff' && gymId === 4 && (staffRole === 'admin' || staffRole === 'coach'))))}>
            <Stack.Screen name="dev/family-self-check-in-pilot-readiness" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && familySelfCheckInAuthorizationTestEnabled && ((accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === 4)) || (accessStatus === 'staff' && gymId === 4 && (staffRole === 'admin' || staffRole === 'coach'))))}>
            <Stack.Screen name="dev/family-self-check-in-authorization" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && familyLinkTestApprovalUtilityEnabled && accessStatus === 'staff' && gymId === 4 && staffRole === 'admin')}>
            <Stack.Screen name="dev/approve-notification-test-family-link" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && promotionNotificationControlledTestEnabled && accessStatus === 'staff' && gymId === 4 && staffRole === 'admin')}>
            <Stack.Screen name="dev/promotion-notification-controlled-test" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(session && !isResolvingAccess && !accessError && isDevelopmentPreview && promotionNotificationFamilyReadOnlyTestEnabled && accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === promotionNotificationFamilyReadOnlyTestCapability.gymId))}>
            <Stack.Screen name="dev/family-promotion-notification-inbox" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
        {
          // View used as a portal container on web
          <View
            // eslint-disable-next-line react-native/no-inline-styles
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: "none",
            }}
            ref={setStablePortalContainer}
          />
        }
        {
          // PortalHost used as a portal container on native
          <PortalHost />
        }
      </NavigationThemeProvider>
    </WebPortalContext.Provider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider
      themes={[lightTheme, darkTheme]}
    >
      <AuthProvider><PasswordSetupProvider><GymAccessProvider><RootContent /></GymAccessProvider></PasswordSetupProvider></AuthProvider>
    </ThemeProvider>
  );
}
