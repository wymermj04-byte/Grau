import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { AcademyIdentity } from '@/components/gym/AcademyIdentity';
import { RecentAnnouncements } from '@/components/gym/RecentAnnouncements';
import LucideIcon from '@/lib/icons/LucideIcon';
import { getBeltColorProfile } from '@/lib/belt-colors';
import { useTheme } from '@/theming/ThemeProvider';
import { RankProgress } from '@/components/gym/RankProgress';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess, type LinkedGym, type LinkedMember } from '@/providers/GymAccessProvider';
import { useAnnouncementSummary } from '@/lib/use-announcement-summary';
import { formatMemberProgram } from '@/lib/students';
import { isMessagingReadOnlyTestEnabled } from '@/lib/messaging-readonly-test-feature';
import { isMessagingControlledTestEnabled } from '@/lib/messaging-controlled-test-feature';
import { isSelfCheckInEnabledForGym, isSelfCheckInPreviewEnabled } from '@/lib/self-check-in-feature';
import { isPromotionNotificationsEnabled, promotionNotificationsCapability } from '@/lib/promotion-notifications-feature';
import { isPromotionNotificationFamilyReadOnlyTestEnabled, promotionNotificationFamilyReadOnlyTestCapability } from '@/lib/promotion-notification-family-readonly-test-feature';
import { listPromotionNotifications } from '@/lib/promotion-notifications';
import { listFamilyMessagingConversations } from '@/lib/messaging';
import { isMessagingEnabled } from '@/lib/messaging-feature';

const isDevelopmentPreview = process.env.NODE_ENV === 'development';

type AcademyGroup = {
  gym?: LinkedGym;
  key: string;
  members: LinkedMember[];
};

function initials(member: LinkedMember) {
  return [member.first_name, member.last_name]
    .filter(Boolean)
    .map((name) => name?.[0])
    .join('')
    .toUpperCase() || 'M';
}

function membershipLabel(status?: string | null) {
  const value = status?.trim();
  if (!value) return 'Status unavailable';
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MemberCard({ member }: { member: LinkedMember }) {
  const { theme } = useTheme();
  const belt = getBeltColorProfile(member.belt_rank, {
    primaryColor: theme.colors.secondary ?? '#E4E5DF',
    borderColor: theme.colors.border ?? '#7B837D',
    textColor: theme.colors.secondaryForeground ?? '#171B1A',
  });
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member';
  const programs = member.programs?.filter((program) => program.trim()).map(formatMemberProgram).join(' · ');
  const isActive = member.membership_status?.trim().toLowerCase() === 'active';

  return (
    <View className="overflow-hidden rounded-[28px] border border-border bg-card">
      <View className="h-1 bg-primary" />
      <View className="px-4 pb-4 pt-4">
      <View className="flex-row items-center">
        <View
          accessibilityLabel={`${name} initials`}
          style={[styles.initials, { backgroundColor: belt.primaryColor, borderColor: belt.borderColor }]}
        >
          <Text style={[styles.initialsText, { color: belt.textColor }]}>{initials(member)}</Text>
        </View>
        <View className="ml-4 flex-1">
          <Text className="text-xl font-bold tracking-tight text-foreground">{name}</Text>
          <View className="mt-2 flex-row items-center gap-2">
            <View className={`rounded-full px-2.5 py-1 ${isActive ? 'bg-success/15' : 'bg-warning/15'}`}><Text numberOfLines={1} className={`text-xs font-bold ${isActive ? 'text-success' : 'text-warning'}`}>{membershipLabel(member.membership_status)}</Text></View>
            {programs ? <Text numberOfLines={1} className="flex-1 text-xs font-semibold text-muted-foreground">{programs}</Text> : null}
          </View>
        </View>
        <View className="ml-3 h-10 w-10 items-center justify-center rounded-full border border-border bg-muted">
          <LucideIcon name="ChevronRight" className="h-5 w-5 text-foreground" />
        </View>
      </View>
      <View className="mt-4 border-t border-border pt-4"><RankProgress beltRank={member.belt_rank} stripes={member.stripes} variant="athlete" /></View>
      </View>
    </View>
  );
}

function AcademyWelcome({ gym, children }: { gym?: LinkedGym; children: React.ReactNode }) {
  return (
    <View className="overflow-hidden rounded-[32px] border border-border bg-card">
      <View className="h-1.5 bg-primary" />
      <View className="px-4 pb-5 pt-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">{gym ? <AcademyIdentity name={gym.gym_name} logoUrl={gym.logo_url} label="Your academy" /> : <Text className="text-sm font-medium text-muted-foreground">Your academies</Text>}</View>
          <View className="flex-row items-center gap-1.5">{children}</View>
        </View>
        <Text className="mt-5 text-2xl font-bold tracking-tight text-foreground">My family</Text>
        <Text className="mt-1.5 text-sm leading-5 text-muted-foreground">{gym ? 'Training profiles, rank, and attendance in one place.' : 'Training profiles across your academies.'}</Text>
      </View>
    </View>
  );
}

export default function MyMembersScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { session, signOut } = useAuth();
  const { accessStatus, linkedMembers, linkedGyms, isResolvingAccess, refreshAccess } = useGymAccess();
  const { announcements, error: announcementError, isLoading: isLoadingAnnouncements, readAnnouncementIds, unreadCount } = useAnnouncementSummary();
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);
  const messagingReadOnlyTestEnabled = isMessagingReadOnlyTestEnabled();
  const messagingControlledTestEnabled = isMessagingControlledTestEnabled();
  const promotionNotificationFamilyReadOnlyTestEnabled = isPromotionNotificationFamilyReadOnlyTestEnabled();
  const familyCheckInPreviewEnabled = isSelfCheckInPreviewEnabled();
  const hasGym4FamilyMembers = accessStatus === 'family'
    && linkedGyms.some((gym) => gym.gym_id === 4)
    && linkedMembers.some((member) => member.gym_id === 4);
  const canOpenOperationalGym4CheckIn = hasGym4FamilyMembers
    && isSelfCheckInEnabledForGym(4);
  const canOpenPreviewGym4CheckIn = isDevelopmentPreview
    && familyCheckInPreviewEnabled
    && hasGym4FamilyMembers;
  const canOpenGym4CheckIn = canOpenOperationalGym4CheckIn || canOpenPreviewGym4CheckIn;
  const canOpenPromotionNotifications = isPromotionNotificationsEnabled()
    && linkedGyms.some((gym) => gym.gym_id === promotionNotificationsCapability.gymId)
    && linkedMembers.some((member) => member.gym_id === promotionNotificationsCapability.gymId);
  const canOpenFamilyPromotionNotifications = canOpenPromotionNotifications
    && accessStatus === 'family';
  const canOpenFamilyPromotionNotificationDiagnostic = isDevelopmentPreview
    && promotionNotificationFamilyReadOnlyTestEnabled
    && accessStatus === 'family'
    && linkedGyms.some((gym) => gym.gym_id === promotionNotificationFamilyReadOnlyTestCapability.gymId);
  const canOpenFamilyMessages = isMessagingEnabled()
    && accessStatus === 'family'
    && linkedGyms.length > 0;
  const canOpenUnifiedNotifications = canOpenFamilyMessages || canOpenFamilyPromotionNotifications;
  const [unifiedUnreadCount, setUnifiedUnreadCount] = React.useState(0);
  const notificationRequestVersionRef = React.useRef(0);
  const notificationScope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${linkedGyms.map((gym) => gym.gym_id).join(',')}:${linkedMembers.map((member) => `${member.gym_id}:${member.student_id}`).join(',')}`;

  React.useEffect(() => {
    notificationRequestVersionRef.current += 1;
    setUnifiedUnreadCount(0);
  }, [notificationScope]);

  const loadUnifiedUnreadCount = React.useCallback(async () => {
    const requestVersion = ++notificationRequestVersionRef.current;
    if (!canOpenUnifiedNotifications) {
      setUnifiedUnreadCount(0);
      return;
    }
    let unreadCount = 0;
    if (canOpenFamilyMessages) {
      try {
        const conversations = await listFamilyMessagingConversations();
        unreadCount += conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
      } catch {
        // A category failure must not hide another authorized category's count.
      }
    }
    if (canOpenFamilyPromotionNotifications) {
      try {
        const notifications = await listPromotionNotifications('family');
        unreadCount += notifications.filter((notification) => !notification.readAt).length;
      } catch {
        // The server rollout gate remains authoritative; show no inferred count.
      }
    }
    if (requestVersion !== notificationRequestVersionRef.current) return;
    setUnifiedUnreadCount(unreadCount);
  }, [canOpenFamilyMessages, canOpenFamilyPromotionNotifications, canOpenUnifiedNotifications]);

  useFocusEffect(React.useCallback(() => {
    void loadUnifiedUnreadCount();
    return () => {
      notificationRequestVersionRef.current += 1;
    };
  }, [loadUnifiedUnreadCount]));

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  const openMember = React.useCallback((member: LinkedMember) => {
    router.push({
      pathname: '/my-members/[studentId]',
      params: { studentId: String(member.student_id) },
    } as never);
  }, [router]);
  const memberGroups = React.useMemo(() => {
    const gymsById = new Map(linkedGyms.map((gym) => [gym.gym_id, gym]));
    const groups = new Map<string, AcademyGroup>();

    for (const member of linkedMembers) {
      const key = String(member.gym_id);
      const existing = groups.get(key);
      if (existing) {
        existing.members.push(member);
      } else {
        groups.set(key, { key, gym: gymsById.get(member.gym_id), members: [member] });
      }
    }

    return [...groups.values()];
  }, [linkedGyms, linkedMembers]);
  const headerGym = linkedGyms.length === 1 ? linkedGyms[0] : undefined;
  const useTwoColumnGrid = width >= 720;

  if (isResolvingAccess) {
    return <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-background"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Refreshing your member access…</Text></SafeAreaView>;
  }

  if (accessStatus === 'unlinked') {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-background px-5">
        <View className="flex-1 items-center justify-center self-center">
          <View className="items-center rounded-3xl border border-border bg-card px-6 py-9">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-tertiary/15"><LucideIcon name="UsersRound" className="h-7 w-7 text-tertiary" /></View>
            <Text className="mt-5 text-center text-2xl font-bold text-foreground">No linked members yet</Text>
            <Text className="mt-3 text-center text-sm leading-6 text-muted-foreground">Your account hasn’t been linked to a member yet. Contact your gym.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh member access" onPress={() => void refreshAccess()} className="mt-7 w-full items-center rounded-xl bg-primary px-5 py-3"><Text className="font-bold text-primary-foreground">Refresh</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" disabled={isSigningOut} onPress={() => void handleSignOut()} className="mt-3 w-full items-center rounded-xl border border-border px-5 py-3"><Text className="font-bold text-foreground">{isSigningOut ? 'Signing out…' : 'Sign out'}</Text></Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-5 pb-12" showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-4xl self-center pt-4">
          <AcademyWelcome gym={headerGym}>
              <Pressable accessibilityRole="button" accessibilityLabel={canOpenUnifiedNotifications ? unifiedUnreadCount > 0 ? `Open notifications, ${unifiedUnreadCount} unread` : 'Open notifications' : unreadCount > 0 ? `Open announcements, ${unreadCount} unread` : 'Open announcements'} onPress={() => router.push(canOpenUnifiedNotifications ? '/notifications' : '/announcements')} className="relative h-11 w-11 items-center justify-center rounded-full border border-border bg-card"><LucideIcon name="Bell" className="h-4 w-4 text-foreground" />{(canOpenUnifiedNotifications ? unifiedUnreadCount : unreadCount) > 0 ? <View className="absolute -right-1 -top-1 min-w-5 items-center rounded-full bg-primary px-1 py-0.5"><Text className="text-[10px] font-bold text-primary-foreground">{(canOpenUnifiedNotifications ? unifiedUnreadCount : unreadCount) > 99 ? '99+' : canOpenUnifiedNotifications ? unifiedUnreadCount : unreadCount}</Text></View> : null}</Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Refresh My family" onPress={() => void refreshAccess()} className="h-9 w-9 items-center justify-center rounded-full active:bg-accent"><LucideIcon name="RefreshCw" className="h-4 w-4 text-muted-foreground" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Account menu" accessibilityState={{ expanded: accountMenuOpen }} onPress={() => setAccountMenuOpen((open) => !open)} className="h-11 w-11 items-center justify-center rounded-full bg-secondary"><LucideIcon name="CircleUserRound" className="h-5 w-5 text-secondary-foreground" /></Pressable>
          </AcademyWelcome>

          {canOpenGym4CheckIn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Gym 4 family check-in"
              accessibilityHint="Opens the controlled Gym 4 family check-in gateway"
              onPress={() => router.push('/check-in/4')}
              className="mt-4 min-h-14 flex-row items-center justify-center gap-3 rounded-2xl bg-primary px-5 active:opacity-85"
            >
              <LucideIcon name="ScanLine" className="h-5 w-5 text-primary-foreground" />
              <View>
                <Text className="font-bold text-primary-foreground">Check In</Text>
                <Text className="text-xs text-primary-foreground/75">Gym 4 · {canOpenOperationalGym4CheckIn ? 'Request staff-approved check-in' : 'Development preview only'}</Text>
              </View>
            </Pressable>
          ) : null}

          {canOpenFamilyPromotionNotificationDiagnostic ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Test Promotion Notifications"
              accessibilityHint="Opens the development-only read-only family notification diagnostic"
              onPress={() => router.push('/dev/family-promotion-notification-inbox')}
              className="mt-4 min-h-14 flex-row items-center justify-center gap-3 rounded-2xl border border-warning/40 bg-warning/15 px-5 active:opacity-85"
            >
              <LucideIcon name="ShieldCheck" className="h-5 w-5 text-warning" />
              <View>
                <Text className="font-bold text-foreground">Test Promotion Notifications</Text>
                <Text className="text-xs text-muted-foreground">Development only · Read-only family inbox check</Text>
              </View>
            </Pressable>
          ) : null}

          {accountMenuOpen ? (
            <View className="mt-3 items-end">
              <View className="w-52 rounded-2xl border border-border bg-card p-2 shadow-sm">
                {accessStatus === 'staff' ? <Pressable accessibilityRole="button" accessibilityLabel="Open staff dashboard" onPress={() => router.replace('/(tabs)')} className="flex-row items-center gap-2 rounded-xl px-3 py-3"><LucideIcon name="LayoutDashboard" className="h-4 w-4 text-foreground" /><Text className="font-semibold text-foreground">Staff dashboard</Text></Pressable> : null}
                {isDevelopmentPreview && messagingReadOnlyTestEnabled ? <Pressable accessibilityRole="button" accessibilityLabel="Open messaging diagnostics" onPress={() => router.push('/dev/messaging-rpc')} className="flex-row items-center gap-2 rounded-xl px-3 py-3"><LucideIcon name="ShieldCheck" className="h-4 w-4 text-warning" /><Text className="font-semibold text-foreground">Messaging diagnostics</Text></Pressable> : null}
                {isDevelopmentPreview && messagingControlledTestEnabled ? <Pressable accessibilityRole="button" accessibilityLabel="Open controlled messaging test" onPress={() => router.push('/dev/messaging-controlled-test')} className="flex-row items-center gap-2 rounded-xl px-3 py-3"><LucideIcon name="ShieldCheck" className="h-4 w-4 text-destructive" /><Text className="font-semibold text-foreground">Controlled messaging test</Text></Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Sign out" disabled={isSigningOut} onPress={() => void handleSignOut()} className="flex-row items-center gap-2 rounded-xl px-3 py-3"><LucideIcon name="LogOut" className="h-4 w-4 text-destructive" /><Text className="font-semibold text-destructive">{isSigningOut ? 'Signing out…' : 'Sign out'}</Text></Pressable>
              </View>
            </View>
          ) : null}

          <View className="mt-6 gap-7">
            {memberGroups.map((group) => (
              <View key={group.key}>
                {memberGroups.length > 1 ? <View className="flex-row items-center justify-between gap-3"><AcademyIdentity name={group.gym?.gym_name} logoUrl={group.gym?.logo_url} label="Training at" /><Text className="text-sm font-medium text-muted-foreground">{group.members.length} {group.members.length === 1 ? 'athlete' : 'athletes'}</Text></View> : null}
                <View className={`${memberGroups.length > 1 ? 'mt-4' : ''} flex-row flex-wrap justify-between gap-y-4`}>
                  {group.members.map((member) => (
                    <Pressable
                      key={member.student_id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${[member.first_name, member.last_name].filter(Boolean).join(' ') || 'member'}`}
                      accessibilityHint="Opens membership details and attendance"
                      onPress={() => openMember(member)}
                      style={({ pressed }) => [useTwoColumnGrid ? styles.tabletCard : styles.fullCard, pressed ? styles.cardPressed : undefined]}
                    >
                      <MemberCard member={member} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
          <RecentAnnouncements announcements={announcements} readAnnouncementIds={readAnnouncementIds} isLoading={isLoadingAnnouncements} error={announcementError} onOpenAnnouncements={() => router.push('/announcements')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  initials: { alignItems: 'center', borderRadius: 24, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  initialsText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  fullCard: { width: '100%' },
  tabletCard: { width: '48.8%' },
});
