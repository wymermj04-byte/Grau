import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  checkFamilyPromotionNotificationInbox,
  type FamilyNotificationInboxTestResult,
} from '@/lib/promotion-notification-family-readonly-test';
import {
  isPromotionNotificationFamilyReadOnlyTestEnabled,
  promotionNotificationFamilyReadOnlyTestCapability,
} from '@/lib/promotion-notification-family-readonly-test-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

function resultLabel(status: FamilyNotificationInboxTestResult['status']) {
  if (status === 'success') return 'Response received';
  if (status === 'rollout-disabled') return 'Rollout disabled';
  if (status === 'authorization-denied') return 'Denied by server';
  return 'Request failed';
}

function resultTone(status: FamilyNotificationInboxTestResult['status']) {
  if (status === 'success') return 'bg-success/15';
  if (status === 'rollout-disabled' || status === 'authorization-denied') return 'bg-warning/15';
  return 'bg-destructive/15';
}

export default function FamilyPromotionNotificationInboxScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, linkedGyms, isResolvingAccess, accessError } = useGymAccess();
  const enabled = isPromotionNotificationFamilyReadOnlyTestEnabled();
  const gymId = promotionNotificationFamilyReadOnlyTestCapability.gymId;
  const approvedForGym = accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === gymId);
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${linkedGyms.map((gym) => gym.gym_id).join(',')}:${isResolvingAccess}:${accessError ?? ''}`;
  const [result, setResult] = React.useState<FamilyNotificationInboxTestResult | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const requestLockRef = React.useRef(false);

  React.useEffect(() => {
    requestLockRef.current = false;
    setResult(null);
    setIsChecking(false);
  }, [scope]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/my-members');
  };

  const checkInbox = async () => {
    if (!enabled || !session?.user.id || !approvedForGym || isChecking || requestLockRef.current) return;
    requestLockRef.current = true;
    setIsChecking(true);
    setResult(null);
    try {
      setResult(await checkFamilyPromotionNotificationInbox({ userId: session.user.id, gymId }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').trim() : '';
      setResult({
        status: 'error',
        items: [],
        errorCode: null,
        summary: message ? message.slice(0, 280) : 'The family notification inbox request could not start.',
      });
    } finally {
      requestLockRef.current = false;
      setIsChecking(false);
    }
  };

  if (!enabled) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Diagnostic unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{promotionNotificationFamilyReadOnlyTestCapability.reason}</Text></View></SafeAreaView>;
  }

  if (!session || isResolvingAccess || accessError || !approvedForGym) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Approved Gym 4 family access required</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">This development-only diagnostic is available only to an authenticated family account with an approved Gym 4 link.</Text></View></SafeAreaView>;
  }

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-center text-lg font-bold text-foreground">Family notification diagnostic</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-warning/30 bg-warning/15 p-5"><Text className="text-sm font-bold tracking-wide text-foreground">DEVELOPMENT ONLY — READ ONLY</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This makes one deliberate call to your authorized family notification inbox. It cannot enable rollout, alter a notification, or read private notification tables.</Text></View><View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Expected server safeguard</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Gym 4 notifications remain disabled. The expected result is a rollout-disabled server response, not an inbox record.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Check my promotion notification inbox" disabled={isChecking} onPress={() => void checkInbox()} className={`mt-5 min-h-12 items-center justify-center rounded-2xl bg-primary px-5 py-3 ${isChecking ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-primary-foreground">{isChecking ? 'Checking authorized inbox…' : 'Check my notification inbox'}</Text></Pressable><View className="mt-7"><Text className="text-lg font-bold text-foreground">RPC result</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Results clear whenever the signed-in account or approved Gym 4 access changes.</Text>{result ? <View className="mt-3 gap-3"><View className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-center justify-between gap-3"><Text className="font-bold text-foreground">Family inbox</Text><View className={`rounded-full px-2.5 py-1 ${resultTone(result.status)}`}><Text className="text-xs font-bold text-foreground">{resultLabel(result.status)}</Text></View></View><Text className="mt-2 text-sm leading-5 text-muted-foreground">{result.summary}</Text>{result.errorCode ? <Text className="mt-2 text-xs text-muted-foreground">Server code: {result.errorCode}</Text> : null}</View>{result.status === 'success' ? <View className="gap-3">{result.items.length === 0 ? <View className="rounded-2xl border border-dashed border-border px-4 py-5"><Text className="text-sm text-muted-foreground">The RPC returned no notification records.</Text></View> : result.items.map((item) => <View key={item.notificationId} className="rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">Notification {item.notificationId}</Text><Text className="mt-2 text-sm text-muted-foreground">Student ID: {item.studentId}</Text><Text className="mt-1 text-sm text-muted-foreground">Type: {item.eventKind}</Text><Text className="mt-1 text-sm text-muted-foreground">Created: {item.createdAt}</Text><Text className="mt-1 text-sm text-muted-foreground">Read: {item.readAt ?? 'Not read'}</Text></View>)}</View> : null}</View> : <View className="mt-3 rounded-2xl border border-dashed border-border px-4 py-5"><Text className="text-sm text-muted-foreground">No notification inbox RPC has been called in this session.</Text></View>}</View></View></ScrollView></SafeAreaView>;
}
