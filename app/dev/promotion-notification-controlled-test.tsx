import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  executePreparedPromotionNotificationTest,
  loadPromotionNotificationTestContext,
  type PromotionNotificationTestContext,
} from '@/lib/promotion-notification-controlled-test';
import {
  isPromotionNotificationControlledTestEnabled,
  promotionNotificationControlledTestCapability,
} from '@/lib/promotion-notification-controlled-test-feature';
import { promotionNotificationsCapability } from '@/lib/promotion-notifications-feature';
import { useGymAccess } from '@/providers/GymAccessProvider';

type VerificationItem = {
  title: string;
  detail: string;
  state: 'ready' | 'blocked';
};

const verificationItems: VerificationItem[] = [
  {
    title: 'Server rollout state',
    detail: 'The private Gym 4 rollout controller is intentionally not browser-readable. Confirm its state with the reviewed Main Supabase read-only verification SQL before any activation.',
    state: 'blocked',
  },
  {
    title: 'Outbox and notification event',
    detail: 'These private records must be verified with aggregate-only Main Supabase SQL after the controlled worker run. This app never reads the private tables.',
    state: 'blocked',
  },
  {
    title: 'Family inbox',
    detail: 'Verify from the separate approved family login using its authorized family inbox after activation and worker completion. Do not use an administrator account to impersonate the family.',
    state: 'blocked',
  },
];

export default function PromotionNotificationControlledTestScreen() {
  const router = useRouter();
  const { accessStatus, gymId, staffRole, isResolvingAccess, accessError } = useGymAccess();
  const enabled = isPromotionNotificationControlledTestEnabled();
  const authorized = accessStatus === 'staff'
    && gymId === promotionNotificationControlledTestCapability.gymId
    && staffRole === 'admin';
  const [context, setContext] = React.useState<PromotionNotificationTestContext | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [promotionConfirmationOpen, setPromotionConfirmationOpen] = React.useState(false);
  const [isExecutingPromotion, setIsExecutingPromotion] = React.useState(false);
  const [promotionResult, setPromotionResult] = React.useState<'confirmed' | null>(null);
  const [promotionError, setPromotionError] = React.useState<string | null>(null);
  const promotionLockRef = React.useRef(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const scope = `${accessStatus}:${gymId ?? 'none'}:${staffRole ?? 'none'}:${isResolvingAccess}:${accessError ?? ''}`;

  React.useEffect(() => {
    setContext(null);
    setIsLoading(false);
    setPromotionConfirmationOpen(false);
    setIsExecutingPromotion(false);
    setPromotionResult(null);
    setPromotionError(null);
    promotionLockRef.current = false;
    setErrorMessage(null);
  }, [scope]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/settings');
  };

  const loadContext = async () => {
    if (!enabled || !authorized || isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setContext(await loadPromotionNotificationTestContext());
    } catch (error: unknown) {
      setContext(null);
      setErrorMessage(error instanceof Error ? error.message : 'The read-only test context could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  const openPromotionConfirmation = () => {
    if (!expectedPromotionReady || promotionResult || isExecutingPromotion || !promotionNotificationControlledTestCapability.promotionExecutionEnabled) return;
    setPromotionError(null);
    setPromotionConfirmationOpen(true);
  };

  const confirmPromotion = async () => {
    if (!expectedPromotionReady || promotionResult || promotionLockRef.current || !promotionNotificationControlledTestCapability.promotionExecutionEnabled) return;
    promotionLockRef.current = true;
    setIsExecutingPromotion(true);
    setPromotionError(null);
    try {
      await executePreparedPromotionNotificationTest();
      setPromotionResult('confirmed');
      setPromotionConfirmationOpen(false);
      setContext(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').trim() : '';
      setPromotionError(message ? message.slice(0, 320) : 'The promotion was not completed. Reload the test context before any further action.');
    } finally {
      promotionLockRef.current = false;
      setIsExecutingPromotion(false);
    }
  };

  if (!enabled) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Controlled test unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{promotionNotificationControlledTestCapability.reason}</Text></View></SafeAreaView>;
  }

  if (!authorized || isResolvingAccess || accessError) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Gym 4 administrator required</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">This development-only controlled test is available only to an authenticated active Gym 4 administrator.</Text></View></SafeAreaView>;
  }

  const expectedPromotionReady = context?.student.belt === 'White'
    && context.student.stripes === 0
    && context.student.promotionTrack === 'adults'
    && context.familyLink.approved;

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-center text-lg font-bold text-foreground">Promotion notification test</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-warning/30 bg-warning/15 p-5"><Text className="text-sm font-bold tracking-wide text-foreground">DEVELOPMENT ONLY — CONTROLLED TEST</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Only the reviewed White 0 to White 1 promotion is enabled. Gym 4 rollout activation and worker execution remain unavailable from this screen.</Text></View><View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Rollout state</Text><Text className="mt-2 text-sm text-muted-foreground">Client notification capability: {promotionNotificationsCapability.enabled ? 'Enabled — review required' : 'Disabled'}</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Main Gym 4 server rollout: not queried by the app. Private rollout state must be confirmed through the reviewed read-only Main SQL script.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Load read-only promotion notification test context" disabled={isLoading || isExecutingPromotion} onPress={() => void loadContext()} className={`mt-5 min-h-12 items-center justify-center rounded-2xl bg-primary px-5 py-3 ${isLoading || isExecutingPromotion ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-primary-foreground">{isLoading ? 'Loading test context…' : 'Load read-only test context'}</Text></Pressable>{errorMessage ? <View className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4"><Text className="text-sm font-semibold text-destructive">{errorMessage}</Text></View> : null}{context ? <><View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">Test student</Text><Text className="mt-2 text-sm text-muted-foreground">{context.student.name} · ID {context.student.id}</Text><Text className="mt-1 text-sm text-muted-foreground">{context.student.belt} belt · {context.student.stripes} {context.student.stripes === 1 ? 'stripe' : 'stripes'}</Text><Text className="mt-1 text-sm text-muted-foreground">Promotion track: {context.student.promotionTrack}</Text></View><View className="mt-3 rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">Approved family link</Text><Text className="mt-2 text-sm text-muted-foreground">Link ID: {context.familyLink.id}</Text><Text className="mt-1 text-sm text-muted-foreground">Relationship: {context.familyLink.relationship}</Text><Text className="mt-1 text-sm text-muted-foreground">Status: {context.familyLink.status}</Text><Text className={`mt-2 text-sm font-semibold ${context.familyLink.approved ? 'text-success' : 'text-destructive'}`}>{context.familyLink.approved ? 'Approved and not revoked' : 'Not eligible for the controlled notification test'}</Text></View><View className={`mt-3 rounded-2xl border p-4 ${expectedPromotionReady ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10'}`}><Text className="font-bold text-foreground">Promotion precondition</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{expectedPromotionReady ? 'Ready for White 0 → White 1 stripe on the adult track. Confirmation will reload this state immediately before the server RPC.' : 'The current saved student/link state does not match the approved White 0 → White 1 test precondition. Promotion execution remains blocked.'}</Text></View></> : null}{promotionError ? <View className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4"><Text className="font-bold text-destructive">Server result: not confirmed</Text><Text className="mt-2 text-sm leading-5 text-foreground">{promotionError}</Text></View> : null}{promotionResult === 'confirmed' ? <View className="mt-4 rounded-2xl border border-success/30 bg-success/10 p-4"><View className="flex-row items-center gap-2"><LucideIcon name="CircleCheck" className="h-5 w-5 text-success" /><Text className="font-bold text-foreground">Promotion confirmed by the server</Text></View><Text className="mt-2 text-sm leading-5 text-muted-foreground">The existing record_student_promotion RPC completed successfully. Further submissions are disabled. Reload the read-only context before any separate verification step.</Text></View> : null}<View className="mt-6"><Text className="text-lg font-bold text-foreground">Separate controlled actions</Text><View className="mt-3 gap-3"><ActionCard title="1. Activate Gym 4 notifications" detail="Requires the trusted server-side rollout controller and a separately approved request. The browser app cannot activate the rollout." />{promotionConfirmationOpen ? <View className="rounded-2xl border border-warning/30 bg-warning/10 p-4"><Text className="font-bold text-foreground">Confirm the test promotion</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This will call record_student_promotion once for Student 64: White belt, 0 stripes to White belt, 1 stripe. The server will reload and enforce its normal authorization and promotion validation.</Text><View className="mt-4 flex-row gap-3"><Pressable accessibilityRole="button" accessibilityLabel="Cancel test promotion" disabled={isExecutingPromotion} onPress={() => setPromotionConfirmationOpen(false)} className="min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card px-4 py-3 active:bg-accent"><Text className="font-bold text-foreground">Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Confirm test promotion" disabled={isExecutingPromotion} onPress={() => void confirmPromotion()} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-destructive px-4 py-3 ${isExecutingPromotion ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-destructive-foreground">{isExecutingPromotion ? 'Recording…' : 'Confirm promotion'}</Text></Pressable></View></View> : <Pressable accessibilityRole="button" accessibilityLabel="Prepare test promotion confirmation" disabled={!expectedPromotionReady || Boolean(promotionResult) || isExecutingPromotion || !promotionNotificationControlledTestCapability.promotionExecutionEnabled} onPress={openPromotionConfirmation} className={`min-h-12 items-center justify-center rounded-2xl bg-destructive px-5 py-3 ${!expectedPromotionReady || promotionResult || isExecutingPromotion || !promotionNotificationControlledTestCapability.promotionExecutionEnabled ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-destructive-foreground">{promotionResult ? 'Promotion completed' : 'Record White 0 → White 1 promotion'}</Text></Pressable>}<ActionCard title="3. Run the notification worker" detail="Requires the deployed secret-authenticated worker and separately approved scheduler or controlled worker invocation. The browser app cannot run it." /></View></View><View className="mt-7"><Text className="text-lg font-bold text-foreground">Read-only verification plan</Text><View className="mt-3 gap-3">{verificationItems.map((item) => <View key={item.title} className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-center gap-2"><LucideIcon name="CircleAlert" className="h-5 w-5 text-warning" /><Text className="font-bold text-foreground">{item.title}</Text></View><Text className="mt-2 text-sm leading-5 text-muted-foreground">{item.detail}</Text><Text className="mt-2 text-xs font-semibold text-warning">{item.state === 'blocked' ? 'Prepared — requires separate authorization' : 'Ready'}</Text></View>)}</View></View></View></ScrollView></SafeAreaView>;
}

function ActionCard({ title, detail }: { title: string; detail: string }) {
  return <View className="rounded-2xl border border-dashed border-border bg-card p-4"><Text className="font-bold text-foreground">{title}</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</Text><View className="mt-3 self-start rounded-full bg-muted px-3 py-1"><Text className="text-xs font-bold text-muted-foreground">Disabled pending authorization</Text></View></View>;
}
