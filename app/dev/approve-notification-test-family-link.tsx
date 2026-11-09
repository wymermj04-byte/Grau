import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  approveNotificationTestFamilyLink,
  getFamilyLinkTestApprovalRequestKey,
  type TestFamilyLinkApproval,
} from '@/lib/family-link-test-approval';
import {
  familyLinkTestApprovalCapability,
  isFamilyLinkTestApprovalUtilityEnabled,
} from '@/lib/family-link-test-approval-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

export default function ApproveNotificationTestFamilyLinkScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, gymId, staffRole, isResolvingAccess, accessError } = useGymAccess();
  const enabled = isFamilyLinkTestApprovalUtilityEnabled();
  const authorized = accessStatus === 'staff'
    && gymId === familyLinkTestApprovalCapability.gymId
    && staffRole === 'admin';
  const [requestKey, setRequestKey] = React.useState<string | null>(null);
  const [isLoadingKey, setIsLoadingKey] = React.useState(false);
  const [confirmationOpen, setConfirmationOpen] = React.useState(false);
  const [isApproving, setIsApproving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<TestFamilyLinkApproval | null>(null);
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${gymId ?? 'none'}:${staffRole ?? 'none'}:${isResolvingAccess}:${accessError ?? ''}`;

  React.useEffect(() => {
    setRequestKey(null);
    setIsLoadingKey(false);
    setConfirmationOpen(false);
    setIsApproving(false);
    setErrorMessage(null);
    setResult(null);
  }, [scope]);

  React.useEffect(() => {
    let isCurrent = true;
    if (!enabled || !authorized || !session?.user.id) return () => { isCurrent = false; };

    setIsLoadingKey(true);
    void getFamilyLinkTestApprovalRequestKey(session.user.id)
      .then((nextRequestKey) => {
        if (isCurrent) setRequestKey(nextRequestKey);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setErrorMessage(error instanceof Error ? error.message : 'A safe approval retry key could not be prepared.');
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoadingKey(false);
      });

    return () => { isCurrent = false; };
  }, [authorized, enabled, session?.user.id]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/settings');
  };

  const openConfirmation = () => {
    if (!enabled || !authorized || !requestKey || isApproving || result) return;
    setErrorMessage(null);
    setConfirmationOpen(true);
  };

  const approve = async () => {
    if (!enabled || !authorized || !session?.user.id || !requestKey || isApproving || result) return;
    setIsApproving(true);
    setErrorMessage(null);
    try {
      const nextResult = await approveNotificationTestFamilyLink(session.user.id, requestKey);
      setResult(nextResult);
      setConfirmationOpen(false);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'The approval was not completed. Retry will use the same request key.');
    } finally {
      setIsApproving(false);
    }
  };

  if (!enabled) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Approval utility unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{familyLinkTestApprovalCapability.reason}</Text></View></SafeAreaView>;
  }

  if (!authorized || isResolvingAccess || accessError) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Gym 4 administrator required</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">This development-only utility is restricted to an authenticated active administrator for Gym 4.</Text></View></SafeAreaView>;
  }

  const actionBlocked = !requestKey || isLoadingKey || isApproving || Boolean(result);

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-center text-lg font-bold text-foreground">Test family-link approval</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-destructive/30 bg-destructive/10 p-5"><Text className="text-sm font-bold tracking-wide text-foreground">DEVELOPMENT ONLY — LIVE ADMIN ACTION</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This utility is restricted to the reviewed Gym 4 notification-test account. It is not linked from normal navigation and must remain disabled until separately authorized.</Text></View><View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Approval scope</Text><Text className="mt-2 text-sm text-muted-foreground">Gym: 4</Text><Text className="mt-1 text-sm text-muted-foreground">Student: 64 — GrauZero NotificationTest</Text><Text className="mt-1 text-sm text-muted-foreground">Family account: d02baad7-7778-4411-9b67-e6008727d4be</Text><Text className="mt-1 text-sm text-muted-foreground">Relationship: parent_guardian</Text><Text className="mt-3 text-xs leading-5 text-muted-foreground">The server RPC, not this screen, authorizes the active administrator and performs the link approval. No direct table write is used.</Text></View><View className="mt-4 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Retry protection</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{isLoadingKey ? 'Preparing a secure approval request key…' : requestKey ? 'One secure request key is saved locally for this administrator and exact test target. Any retry will reuse it.' : 'A secure request key could not be prepared. The approval remains blocked.'}</Text></View>{errorMessage ? <View className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4"><Text className="text-sm font-semibold text-destructive">{errorMessage}</Text></View> : null}{result ? <View className="mt-4 rounded-2xl border border-success/30 bg-success/10 p-4"><View className="flex-row items-center gap-2"><LucideIcon name="CircleCheck" className="h-5 w-5 text-success" /><Text className="font-bold text-foreground">Approval confirmed by the server</Text></View><Text className="mt-3 text-sm text-muted-foreground">Link ID: {result.linkId}</Text><Text className="mt-1 text-sm text-muted-foreground">Student ID: {result.studentId}</Text><Text className="mt-1 text-sm text-muted-foreground">Gym ID: {result.gymId}</Text><Text className="mt-1 text-sm text-muted-foreground">Relationship: {result.relationship}</Text><Text className="mt-1 text-sm text-muted-foreground">Status: {result.status}</Text></View> : null}{confirmationOpen ? <View className="mt-5 rounded-2xl border border-warning/30 bg-warning/10 p-4"><Text className="font-bold text-foreground">Confirm approval</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Approve the reviewed parent_guardian link for Student 64 and the specified existing family account? This calls the server once with the preserved request key.</Text><View className="mt-4 flex-row gap-3"><Pressable accessibilityRole="button" accessibilityLabel="Cancel family-link approval" disabled={isApproving} onPress={() => setConfirmationOpen(false)} className="min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card px-4 py-3 active:bg-accent"><Text className="font-bold text-foreground">Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Confirm family-link approval" disabled={isApproving} onPress={() => void approve()} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-destructive px-4 py-3 ${isApproving ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-destructive-foreground">{isApproving ? 'Approving…' : 'Confirm approval'}</Text></Pressable></View></View> : <Pressable accessibilityRole="button" accessibilityLabel="Prepare family-link approval confirmation" disabled={actionBlocked} onPress={openConfirmation} className={`mt-5 min-h-12 items-center justify-center rounded-2xl bg-destructive px-5 py-3 ${actionBlocked ? 'opacity-50' : 'active:opacity-90'}`}><Text className="text-center font-bold text-destructive-foreground">{result ? 'Approval completed' : isLoadingKey ? 'Preparing secure retry key…' : 'Approve reviewed test family link'}</Text></Pressable>}</View></ScrollView></SafeAreaView>;
}
