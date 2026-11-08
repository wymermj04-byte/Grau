import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  acknowledgeControlledUnreadPage,
  attachVerifiedEmptyControlledConversation,
  canCompleteHaltedPostAcknowledgementVerification,
  canRecoverHaltedFamilyAcknowledgement,
  canRecoverVerifiedEmptyControlledConversation,
  canRetryHaltedControlledRoleDenial,
  checkControlledFamilyInbox,
  checkControlledRoleDenial,
  checkControlledStaffInbox,
  completeHaltedPostAcknowledgementVerification,
  createControlledFamilyConversation,
  createControlledMessagingTestRun,
  getHaltedControlledRoleDenialRecoveryEligibility,
  openControlledUnreadPage,
  recoverHaltedFamilyAcknowledgement,
  restoreControlledMessagingTestRun,
  saveControlledMessagingTestRun,
  sendControlledFamilyMessage,
  sendControlledStaffMessage,
  type ControlledMessagingTestRun,
  type ControlledTestResult,
  verifyControlledInboxUnread,
  verifyControlledHistory,
} from '@/lib/messaging-controlled-test';
import { isMessagingControlledAcknowledgementRecoveryEnabled, isMessagingControlledCompletionEnabled, isMessagingControlledTestEnabled, messagingControlledAcknowledgementRecoveryCapability, messagingControlledCompletionCapability, messagingControlledTestCapability } from '@/lib/messaging-controlled-test-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

type RunningStep = 'local' | 'attach' | 'acknowledgement-recovery' | 'post-acknowledgement-completion' | 'family-inbox' | 'conversation' | 'family-send' | 'family-retry' | 'staff-inbox' | 'staff-send' | 'staff-retry' | 'history' | 'unread' | 'acknowledge' | 'role-denial' | null;

type PendingConfirmation =
  | { kind: 'attach'; candidateConversationId: number }
  | { kind: 'acknowledgement-recovery' }
  | { kind: 'post-acknowledgement-completion' }
  | { kind: 'role-denial-retry' }
  | { kind: 'message'; role: 'family' | 'staff'; retry: boolean }
  | { kind: 'acknowledge' };

function statusClass(status: ControlledTestResult['status']) {
  if (status === 'passed') return 'bg-success/15';
  if (status === 'inconclusive') return 'bg-warning/15';
  return status === 'failed' || status === 'stopped' ? 'bg-destructive/15' : 'bg-secondary';
}

function actionLabel(run: ControlledMessagingTestRun | null, role: 'family' | 'staff', retry: boolean) {
  const message = role === 'family' ? run?.familyMessage : run?.staffMessage;
  if (retry) return `Retry the exact ${role} test message`;
  return message?.pending ? 'Retry pending message with saved UUID' : `Send ${role} test message`;
}

export default function ControlledMessagingTestScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, gymId, linkedGyms, accessError, isResolvingAccess } = useGymAccess();
  const enabled = isMessagingControlledTestEnabled();
  const [run, setRun] = React.useState<ControlledMessagingTestRun | null>(null);
  const [restoreId, setRestoreId] = React.useState('');
  const [candidateConversationId, setCandidateConversationId] = React.useState('');
  const [results, setResults] = React.useState<ControlledTestResult[]>([]);
  const [running, setRunning] = React.useState<RunningStep>(null);
  const [pendingConfirmation, setPendingConfirmation] = React.useState<PendingConfirmation | null>(null);
  const confirmationInFlightRef = React.useRef(false);
  const familyGymIds = React.useMemo(() => linkedGyms.map((gym) => gym.gym_id), [linkedGyms]);
  const availableGymId = accessStatus === 'staff' ? gymId : familyGymIds[0] ?? null;
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${gymId ?? 'none'}:${familyGymIds.join(',')}:${accessError ?? ''}:${isResolvingAccess}`;

  React.useEffect(() => {
    setResults([]);
    setRunning(null);
    setPendingConfirmation(null);
    confirmationInFlightRef.current = false;
  }, [scope]);

  const record = React.useCallback((result: ControlledTestResult) => {
    setResults((current) => [result, ...current].slice(0, 8));
  }, []);

  const runStep = React.useCallback(async (step: Exclude<RunningStep, null>, operation: () => Promise<ControlledTestResult>) => {
    if (!enabled || running || run?.halted || (run?.postAcknowledgementCompletion !== null && step !== 'role-denial')) return;
    setRunning(step);
    try {
      const result = await operation();
      record(result);
      if (run && result.status !== 'passed' && result.status !== 'denied') {
        run.halted = true;
        await saveControlledMessagingTestRun(run);
      }
    } catch {
      record({ step: step === 'conversation' ? 'create-conversation' : step === 'unread' ? 'unread-page' : step === 'family-retry' ? 'family-retry' : step === 'staff-retry' ? 'staff-retry' : step === 'family-send' ? 'family-send' : step === 'staff-send' ? 'staff-send' : step === 'role-denial' ? 'role-denial' : step === 'staff-inbox' ? 'staff-inbox' : step === 'family-inbox' ? 'family-inbox' : step === 'acknowledge' ? 'acknowledge' : 'history', status: 'failed', summary: 'The action could not start. Stop and review before continuing.', conversationId: run?.conversationId ?? null, messageId: null, cursorId: null, errorCode: null });
    } finally {
      setRunning(null);
    }
  }, [enabled, record, run, running]);

  const createLocalRun = async () => {
    if (!enabled || running || !availableGymId) return;
    setRunning('local');
    try {
      const next = createControlledMessagingTestRun(availableGymId);
      await saveControlledMessagingTestRun(next);
      setRun(next);
      setRestoreId(next.runId);
      setResults([]);
    } catch {
      record({ step: 'family-inbox', status: 'failed', summary: 'A local test run could not be prepared. No RPC was called.', conversationId: null, messageId: null, cursorId: null, errorCode: null });
    } finally {
      setRunning(null);
    }
  };

  const restoreLocalRun = async () => {
    if (!enabled || running || !restoreId.trim()) return;
    setRunning('local');
    try {
      const restored = await restoreControlledMessagingTestRun(restoreId.trim());
      if (!restored) {
        record({ step: 'family-inbox', status: 'inconclusive', summary: 'No saved controlled run matches that identifier. No RPC was called.', conversationId: null, messageId: null, cursorId: null, errorCode: null });
      } else {
        setRun(restored);
        setResults([]);
      }
    } catch {
      record({ step: 'family-inbox', status: 'failed', summary: 'The saved run could not be restored. No RPC was called.', conversationId: null, messageId: null, cursorId: null, errorCode: null });
    } finally {
      setRunning(null);
    }
  };

  const confirmPermanentMessage = (role: 'family' | 'staff', retry: boolean) => {
    if (!run || running) return;
    setPendingConfirmation({ kind: 'message', role, retry });
  };

  const confirmAcknowledgement = () => {
    if (!run || running) return;
    setPendingConfirmation({ kind: 'acknowledge' });
  };

  const confirmAcknowledgementRecovery = () => {
    if (!run || running || !canUseFamily || !acknowledgementRecoveryEnabled || !canRecoverHaltedFamilyAcknowledgement(run)) return;
    setPendingConfirmation({ kind: 'acknowledgement-recovery' });
  };

  const confirmPostAcknowledgementCompletion = () => {
    if (!run || running || !canUseFamily || !completionEnabled || !canCompleteHaltedPostAcknowledgementVerification(run)) return;
    setPendingConfirmation({ kind: 'post-acknowledgement-completion' });
  };

  const confirmHaltedRoleDenialRetry = () => {
    if (!run || running || !canUseFamily || !canRetryHaltedControlledRoleDenial(run)) return;
    setPendingConfirmation({ kind: 'role-denial-retry' });
  };

  const confirmVerifiedEmptyAttachment = () => {
    if (!run || !canRecoverVerifiedEmptyControlledConversation(run) || !canUseFamily || running) return;
    const candidateId = Number(candidateConversationId.trim());
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
      record({ step: 'attach-verified-empty-conversation', status: 'inconclusive', summary: 'Enter the verified conversation ID before requesting attachment. No RPC was called.', conversationId: null, messageId: null, cursorId: null, errorCode: null });
      return;
    }
    setPendingConfirmation({ kind: 'attach', candidateConversationId: candidateId });
  };

  const executeConfirmation = () => {
    const confirmation = pendingConfirmation;
    if (!confirmation || !run || running || confirmationInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    setPendingConfirmation(null);

    if (confirmation.kind === 'attach') {
      setRunning('attach');
      void attachVerifiedEmptyControlledConversation(run, confirmation.candidateConversationId)
        .then((result) => {
          record(result);
          if (result.status === 'passed') setRun({ ...run });
        })
        .catch(() => record({ step: 'attach-verified-empty-conversation', status: 'failed', summary: 'Attachment verification could not start. The halted run remains unchanged.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null }))
        .finally(() => {
          confirmationInFlightRef.current = false;
          setRunning(null);
        });
      return;
    }

    if (confirmation.kind === 'acknowledgement-recovery') {
      setRunning('acknowledgement-recovery');
      void recoverHaltedFamilyAcknowledgement(run)
        .then((result) => {
          record(result);
          if (result.status === 'passed') setRun({ ...run });
        })
        .catch(() => record({ step: 'acknowledgement-recovery', status: 'failed', summary: 'Acknowledgement recovery could not start. The halted run remains unchanged.', conversationId: run.conversationId, messageId: null, cursorId: run.lastReadCursor?.cursorId ?? null, errorCode: null, accessRole: run.lastReadCursor?.role ?? null, throughMessageId: run.lastReadCursor?.throughMessageId ?? null }))
        .finally(() => {
          confirmationInFlightRef.current = false;
          setRunning(null);
        });
      return;
    }

    if (confirmation.kind === 'post-acknowledgement-completion') {
      setRunning('post-acknowledgement-completion');
      void completeHaltedPostAcknowledgementVerification(run)
        .then((result) => {
          record(result);
          if (result.status === 'passed') setRun({ ...run });
        })
        .catch(() => record({ step: 'post-acknowledgement-completion', status: 'failed', summary: 'Post-acknowledgement completion could not start. The halted run remains unchanged.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null }))
        .finally(() => {
          confirmationInFlightRef.current = false;
          setRunning(null);
        });
      return;
    }

    if (confirmation.kind === 'role-denial-retry') {
      setRunning('role-denial');
      void checkControlledRoleDenial(run, 'staff')
        .then(async (result) => {
          record(result);
          if (result.status === 'denied') {
            const resumedRun = { ...run, halted: false };
            await saveControlledMessagingTestRun(resumedRun);
            setRun(resumedRun);
          }
        })
        .catch(() => record({ step: 'role-denial', status: 'failed', summary: 'The final read-only security check could not start. The run remains halted.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null, gymId: run.gymId, accessRole: 'staff' }))
        .finally(() => {
          confirmationInFlightRef.current = false;
          setRunning(null);
        });
      return;
    }

    if (confirmation.kind === 'acknowledge') {
      void runStep('acknowledge', () => acknowledgeControlledUnreadPage(run))
        .finally(() => { confirmationInFlightRef.current = false; });
      return;
    }

    const step = confirmation.retry
      ? (confirmation.role === 'family' ? 'family-retry' : 'staff-retry')
      : (confirmation.role === 'family' ? 'family-send' : 'staff-send');
    void runStep(step, () => (
      confirmation.role === 'family'
        ? sendControlledFamilyMessage(run, confirmation.retry)
        : sendControlledStaffMessage(run, confirmation.retry)
    )).finally(() => { confirmationInFlightRef.current = false; });
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(accessStatus === 'staff' ? '/settings' : '/my-members');
  };

  if (!enabled) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><Text className="text-center text-lg font-bold text-foreground">Controlled messaging testing is unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{messagingControlledTestCapability.reason}</Text></View></SafeAreaView>;
  }

  const canUseFamily = accessStatus === 'family' && familyGymIds.includes(run?.gymId ?? -1);
  const canUseStaff = accessStatus === 'staff' && gymId === run?.gymId;
  const canOperate = Boolean(run && !run.halted && !accessError && !isResolvingAccess && (canUseFamily || canUseStaff));
  const postAcknowledgementCompletionOnly = run?.postAcknowledgementCompletion !== null;
  const canStandardOperate = canOperate && !postAcknowledgementCompletionOnly;
  const canRunOppositeRoleDenial = canOperate && run?.conversationId !== null;
  const canRecoverVerifiedEmptyConversation = Boolean(run && canRecoverVerifiedEmptyControlledConversation(run));
  const acknowledgementRecoveryEnabled = isMessagingControlledAcknowledgementRecoveryEnabled();
  const canRecoverHaltedAcknowledgement = Boolean(run && canRecoverHaltedFamilyAcknowledgement(run));
  const completionEnabled = isMessagingControlledCompletionEnabled();
  const canCompleteHaltedPostAcknowledgement = Boolean(run && canCompleteHaltedPostAcknowledgementVerification(run));
  const canResumeHaltedRoleDenial = Boolean(run && canRetryHaltedControlledRoleDenial(run));
  const roleDenialRecoveryEligibility = run ? getHaltedControlledRoleDenialRecoveryEligibility(run) : null;
  const activeReadCursor = run?.recoveryReadCursor ?? run?.lastReadCursor ?? null;
  const confirmationTitle = pendingConfirmation?.kind === 'attach'
    ? 'Attach verified empty conversation?'
    : pendingConfirmation?.kind === 'acknowledgement-recovery'
      ? 'Request a fresh unread cursor?'
    : pendingConfirmation?.kind === 'post-acknowledgement-completion'
      ? 'Verify family inbox before completion?'
    : pendingConfirmation?.kind === 'role-denial-retry'
      ? 'Repeat the final security check?'
    : pendingConfirmation?.kind === 'acknowledge'
      ? 'Acknowledge this unread page?'
      : pendingConfirmation?.kind === 'message'
        ? pendingConfirmation.retry ? `Retry the saved ${pendingConfirmation.role} test message?` : `Send ${pendingConfirmation.role} test message?`
        : '';
  const confirmationDescription = pendingConfirmation?.kind === 'attach'
    ? 'This makes read-only family inbox and history checks. It retains the existing run ID and retry UUIDs. It does not create a conversation or send a message.'
    : pendingConfirmation?.kind === 'acknowledgement-recovery'
      ? 'This rechecks family authorization for the existing Gym 4 conversation, then requests one fresh server-issued unread cursor. It creates a cursor record but does not acknowledge any message. The original cursor remains saved for diagnostics.'
    : pendingConfirmation?.kind === 'post-acknowledgement-completion'
      ? 'This makes one fresh, family-authorized inbox read for Conversation 1. It must return unread count 0 before it unlocks only the opposite-role denial check. It does not send a message, create a cursor, or change a read marker.'
    : pendingConfirmation?.kind === 'role-denial-retry'
      ? 'This repeats one read-only history RPC for Conversation 1 with the forbidden staff role. It cannot send a message, create or acknowledge a cursor, or change a read marker. Only SQLSTATE 42501 counts as a successful denial.'
    : pendingConfirmation?.kind === 'acknowledge'
      ? 'This changes only the selected role’s read marker, using the exact server-issued cursor and endpoint already saved for this test run.'
      : pendingConfirmation?.kind === 'message'
        ? `${pendingConfirmation.retry ? 'This resubmits' : 'This permanently sends'} the exact saved test text and UUID. It contains no personal information.`
        : '';
  const confirmationActionLabel = pendingConfirmation?.kind === 'attach'
    ? 'Verify and attach'
    : pendingConfirmation?.kind === 'acknowledgement-recovery'
      ? 'Request fresh cursor'
    : pendingConfirmation?.kind === 'post-acknowledgement-completion'
      ? 'Verify zero unread'
    : pendingConfirmation?.kind === 'role-denial-retry'
      ? 'Repeat read-only check'
    : pendingConfirmation?.kind === 'acknowledge'
      ? 'Acknowledge exact page'
      : pendingConfirmation?.kind === 'message' && pendingConfirmation.retry
        ? 'Retry exact message'
        : 'Send test message';

  const buttonClass = (disabled: boolean, primary = false) => `mt-3 min-h-11 items-center justify-center rounded-xl px-4 ${primary ? 'bg-primary' : 'bg-secondary'} ${disabled ? 'opacity-50' : primary ? 'active:opacity-90' : 'active:bg-accent'}`;
  const disabled = (allowed: boolean) => !allowed || running !== null || run?.halted === true;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-xl self-center pt-4">
          <View className="flex-row items-center justify-between">
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable>
            <Text className="text-lg font-bold text-foreground">Controlled messaging test</Text><View className="h-11 w-11" />
          </View>
          <View className="mt-6 rounded-3xl border border-destructive/30 bg-destructive/10 p-5">
            <Text className="text-sm font-bold tracking-wide text-foreground">DEVELOPMENT ONLY — CONTROLLED WRITES</Text>
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">Every server action needs its own button press. Normal Messages remain disabled and this screen is excluded from production builds.</Text>
          </View>
          <View className="mt-5 rounded-2xl border border-border bg-card p-4">
            <Text className="text-sm font-bold text-foreground">Current authenticated scope</Text>
            <Text className="mt-2 text-sm text-muted-foreground">Resolved role: {accessStatus}</Text>
            <Text className="mt-1 text-sm text-muted-foreground">Resolved staff gym: {gymId ?? 'None'} · Approved family gyms: {familyGymIds.join(', ') || 'None'}</Text>
            {accessError ? <Text className="mt-2 text-sm text-destructive">Gym access must resolve before testing.</Text> : null}
          </View>
          <View className="mt-5 rounded-2xl border border-border bg-card p-4">
            <Text className="text-sm font-bold text-foreground">Local test-run record</Text>
            <Text className="mt-1 text-xs leading-5 text-muted-foreground">The run ID, IDs, fixed test text, retry UUIDs, and read cursor are stored locally. After switching accounts, enter the same run ID and restore it. No account details or unrelated messages are shown.</Text>
            <TextInput accessibilityLabel="Saved controlled test-run identifier" value={restoreId} onChangeText={setRestoreId} autoCapitalize="none" autoCorrect={false} placeholder="Test-run UUID" placeholderTextColor="hsl(150 8% 46%)" editable={running === null} className="mt-3 min-h-12 rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground" />
            <View className="mt-3 flex-row gap-3">
              <Pressable accessibilityRole="button" disabled={running !== null || !availableGymId} onPress={() => void createLocalRun()} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-3 ${running || !availableGymId ? 'opacity-50' : 'active:opacity-90'}`}><Text className="text-center text-sm font-bold text-primary-foreground">{running === 'local' ? 'Working…' : 'Create local run'}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={running !== null || !restoreId.trim()} onPress={() => void restoreLocalRun()} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-secondary px-3 ${running || !restoreId.trim() ? 'opacity-50' : 'active:bg-accent'}`}><Text className="text-center text-sm font-bold text-secondary-foreground">Restore saved run</Text></Pressable>
            </View>
            {run ? <View className={`mt-4 rounded-xl px-3 py-3 ${run.halted ? 'bg-destructive/15' : 'bg-muted'}`}><Text className="text-xs font-bold text-foreground">Run: {run.runId}</Text><Text className="mt-1 text-xs text-muted-foreground">Gym {run.gymId} · conversation {run.conversationId ?? 'not created'} · family message {run.familyMessage.messageId ?? 'not sent'} · staff reply {run.staffMessage.messageId ?? 'not sent'}</Text><Text className="mt-1 text-xs text-muted-foreground">Stored state: {run.halted ? 'stopped' : postAcknowledgementCompletionOnly ? 'completion verified — opposite-role denial only' : canRecoverVerifiedEmptyConversation ? 'preflight checkpoint available for manual recovery' : 'active'}</Text>{run.familyInboxDiagnostics[0] ? <Text className="mt-2 text-xs leading-5 text-muted-foreground">Latest family inbox diagnostic: role {run.familyInboxDiagnostics[0].resolvedAccessRole} · conversation {run.familyInboxDiagnostics[0].conversationFound ? 'found' : 'not found'} · unread {run.familyInboxDiagnostics[0].unreadCount ?? 'invalid'} · zero assertion {run.familyInboxDiagnostics[0].expectedZeroUnreadPassed === null ? 'not requested' : run.familyInboxDiagnostics[0].expectedZeroUnreadPassed ? 'passed' : 'failed'}</Text> : null}{run.halted ? <Text className="mt-2 text-xs font-bold text-destructive">Stopped locally after an unexpected result. Do not continue this run except through an explicitly approved recovery or completion path.</Text> : null}</View> : null}
            {run?.halted && roleDenialRecoveryEligibility ? <View className="mt-3 rounded-xl border border-border bg-background px-3 py-3"><Text className="text-xs font-bold text-foreground">Final security-check recovery eligibility</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">Local-only diagnostic — no RPC was called.</Text><Text className="mt-2 text-xs leading-5 text-muted-foreground">Stopped: {roleDenialRecoveryEligibility.halted ? 'ready' : 'missing'} · Exact Gym 4 run: {roleDenialRecoveryEligibility.exactRun ? 'ready' : 'missing'} · Conversation 1: {roleDenialRecoveryEligibility.exactConversation ? 'ready' : 'missing'} · Messages 1 and 2: {roleDenialRecoveryEligibility.exactMessages ? 'ready' : 'missing'}</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">No pending sends: {roleDenialRecoveryEligibility.noPendingMessages ? 'ready' : 'missing'} · Original family cursor: {roleDenialRecoveryEligibility.originalFamilyCursor ? 'ready' : 'missing'} · Recovered family endpoint 2: {roleDenialRecoveryEligibility.recoveredFamilyEndpoint ? 'ready' : 'missing'} · Zero-unread completion: {roleDenialRecoveryEligibility.zeroUnreadCompletion ? 'ready' : 'missing'}</Text><Text className="mt-1 text-xs font-bold text-muted-foreground">Recovery control: {roleDenialRecoveryEligibility.eligible && canUseFamily ? 'available' : 'unavailable'}</Text></View> : null}
          </View>
          {canRecoverVerifiedEmptyConversation ? <View className="mt-5 rounded-2xl border border-warning/30 bg-warning/15 p-4">
            <Text className="text-sm font-bold text-foreground">Attach verified empty conversation</Text>
            <Text className="mt-1 text-xs leading-5 text-muted-foreground">Enter the conversation ID confirmed by the separate Main review. After your confirmation, this performs only family inbox and family history checks. It preserves this run’s original message bodies and retry UUIDs.</Text>
            {canUseFamily ? <><TextInput accessibilityLabel="Verified empty conversation ID" value={candidateConversationId} onChangeText={setCandidateConversationId} keyboardType="number-pad" placeholder="Conversation ID" placeholderTextColor="hsl(150 8% 46%)" editable={running === null} className="mt-3 min-h-12 rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground" />
              <Pressable accessibilityRole="button" accessibilityLabel="Attach verified empty conversation" disabled={running !== null || !candidateConversationId.trim()} onPress={confirmVerifiedEmptyAttachment} className={`mt-3 min-h-11 items-center justify-center rounded-xl bg-warning px-4 ${running || !candidateConversationId.trim() ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-warning-foreground">{running === 'attach' ? 'Verifying…' : 'Attach verified empty conversation'}</Text></Pressable></> : <Text className="mt-3 text-xs leading-5 text-warning-foreground">This recovery action is unavailable until this exact Gym 4 run is restored while signed in as its approved family account.</Text>}
          </View> : null}
          {canRecoverHaltedAcknowledgement && canUseFamily ? <View className="mt-5 rounded-2xl border border-warning/30 bg-warning/15 p-4">
            <Text className="text-sm font-bold text-foreground">Acknowledgement recovery</Text>
            <Text className="mt-1 text-xs leading-5 text-muted-foreground">This exact halted Gym 4 family run retains Conversation 1, Messages 1 and 2, its original cursor, endpoint, and retry UUIDs. Recovery never runs automatically and never replaces the original cursor.</Text>
            {acknowledgementRecoveryEnabled ? <><Text className="mt-3 text-xs leading-5 text-warning-foreground">A separately approved recovery can recheck family authorization and request one fresh cursor. It will not acknowledge messages.</Text><Pressable accessibilityRole="button" disabled={running !== null} onPress={confirmAcknowledgementRecovery} className={`mt-3 min-h-11 items-center justify-center rounded-xl bg-warning px-4 ${running ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-warning-foreground">Request fresh family cursor</Text></Pressable></> : <Text className="mt-3 text-xs leading-5 text-warning-foreground">{messagingControlledAcknowledgementRecoveryCapability.reason}</Text>}
          </View> : null}
          {canCompleteHaltedPostAcknowledgement && canUseFamily ? <View className="mt-5 rounded-2xl border border-warning/30 bg-warning/15 p-4">
            <Text className="text-sm font-bold text-foreground">Post-acknowledgement completion</Text>
            <Text className="mt-1 text-xs leading-5 text-muted-foreground">This exact halted Gym 4 run retains both cursors, Messages 1 and 2, and all retry UUIDs. Completion performs one fresh family-inbox read and requires Conversation 1 with aggregate unread count 0. It cannot send, acknowledge, or request a cursor.</Text>
            {completionEnabled ? <Pressable accessibilityRole="button" disabled={running !== null} onPress={confirmPostAcknowledgementCompletion} className={`mt-3 min-h-11 items-center justify-center rounded-xl bg-warning px-4 ${running ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-warning-foreground">Verify zero unread before completion</Text></Pressable> : <Text className="mt-3 text-xs leading-5 text-warning-foreground">{messagingControlledCompletionCapability.reason}</Text>}
          </View> : null}
          {canResumeHaltedRoleDenial && canUseFamily ? <View className="mt-5 rounded-2xl border border-warning/30 bg-warning/15 p-4">
            <Text className="text-sm font-bold text-foreground">Final security-check recovery</Text>
            <Text className="mt-1 text-xs leading-5 text-muted-foreground">The final opposite-role check stopped before a verified server denial was available. This exact Gym 4 run retains both cursors, Messages 1 and 2, and all retry UUIDs. A separately confirmed retry makes only the same read-only forbidden-role history check.</Text>
            <Pressable accessibilityRole="button" disabled={running !== null} onPress={confirmHaltedRoleDenialRetry} className={`mt-3 min-h-11 items-center justify-center rounded-xl bg-warning px-4 ${running ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-warning-foreground">Repeat final read-only security check</Text></Pressable>
          </View> : null}
          {run ? <View className="mt-5 gap-3">
            <View className="rounded-2xl border border-border bg-card p-4">
              <Text className="text-sm font-bold text-foreground">1. Family account sequence</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">Stop if an existing Gym 4 conversation is found. This screen never renders labels or message content.</Text>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseFamily)} onPress={() => void runStep('family-inbox', () => checkControlledFamilyInbox(run))} className={buttonClass(disabled(canStandardOperate && canUseFamily))}><Text className="font-bold text-secondary-foreground">Check family inbox first</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseFamily && run.familyInboxChecked && run.conversationId === null)} onPress={() => void runStep('conversation', () => createControlledFamilyConversation(run))} className={buttonClass(disabled(canStandardOperate && canUseFamily && run.familyInboxChecked && run.conversationId === null), true)}><Text className="font-bold text-primary-foreground">Create one family conversation</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseFamily && run.conversationId !== null)} onPress={() => confirmPermanentMessage('family', false)} className={buttonClass(disabled(canStandardOperate && canUseFamily && run.conversationId !== null), true)}><Text className="font-bold text-primary-foreground">{actionLabel(run, 'family', false)}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseFamily && (run.familyMessage.messageId !== null || run.familyMessage.pending))} onPress={() => confirmPermanentMessage('family', true)} className={buttonClass(disabled(canStandardOperate && canUseFamily && (run.familyMessage.messageId !== null || run.familyMessage.pending)))}><Text className="font-bold text-secondary-foreground">{actionLabel(run, 'family', true)}</Text></Pressable>
            </View>
            <View className="rounded-2xl border border-border bg-card p-4">
              <Text className="text-sm font-bold text-foreground">2. Admin account sequence</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">Sign in as the active Gym 4 admin, then restore this exact run ID.</Text>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseStaff && run.conversationId !== null)} onPress={() => void runStep('staff-inbox', () => checkControlledStaffInbox(run))} className={buttonClass(disabled(canStandardOperate && canUseStaff && run.conversationId !== null))}><Text className="font-bold text-secondary-foreground">Check staff inbox and unread count</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseStaff && run.staffInboxChecked && run.conversationId !== null)} onPress={() => confirmPermanentMessage('staff', false)} className={buttonClass(disabled(canStandardOperate && canUseStaff && run.staffInboxChecked && run.conversationId !== null), true)}><Text className="font-bold text-primary-foreground">{actionLabel(run, 'staff', false)}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && canUseStaff && (run.staffMessage.messageId !== null || run.staffMessage.pending))} onPress={() => confirmPermanentMessage('staff', true)} className={buttonClass(disabled(canStandardOperate && canUseStaff && (run.staffMessage.messageId !== null || run.staffMessage.pending)))}><Text className="font-bold text-secondary-foreground">{actionLabel(run, 'staff', true)}</Text></Pressable>
            </View>
            <View className="rounded-2xl border border-border bg-card p-4">
              <Text className="text-sm font-bold text-foreground">3. Role-scoped history and read state</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">Aggregate-only checks. No message text or sender labels are rendered.</Text>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && run.conversationId !== null)} onPress={() => void runStep('history', () => verifyControlledHistory(run, accessStatus === 'staff' ? 'staff' : 'family'))} className={buttonClass(disabled(canStandardOperate && run.conversationId !== null))}><Text className="font-bold text-secondary-foreground">Verify chronological paged history</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && run.conversationId !== null)} onPress={() => void runStep(accessStatus === 'staff' ? 'staff-inbox' : 'family-inbox', () => verifyControlledInboxUnread(run, accessStatus === 'staff' ? 'staff' : 'family', 'positive'))} className={buttonClass(disabled(canStandardOperate && run.conversationId !== null))}><Text className="font-bold text-secondary-foreground">Verify inbox shows unread</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && run.conversationId !== null && activeReadCursor === null)} onPress={() => void runStep('unread', () => openControlledUnreadPage(run, accessStatus === 'staff' ? 'staff' : 'family'))} className={buttonClass(disabled(canStandardOperate && run.conversationId !== null && activeReadCursor === null))}><Text className="font-bold text-secondary-foreground">Open unread page</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && activeReadCursor !== null)} onPress={confirmAcknowledgement} className={buttonClass(disabled(canStandardOperate && activeReadCursor !== null))}><Text className="font-bold text-secondary-foreground">{run.recoveryReadCursor ? 'Acknowledge recovered unread page' : 'Acknowledge saved unread page'}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canStandardOperate && run.conversationId !== null)} onPress={() => void runStep(accessStatus === 'staff' ? 'staff-inbox' : 'family-inbox', () => verifyControlledInboxUnread(run, accessStatus === 'staff' ? 'staff' : 'family', 'zero'))} className={buttonClass(disabled(canStandardOperate && run.conversationId !== null))}><Text className="font-bold text-secondary-foreground">Verify inbox shows read</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled(canRunOppositeRoleDenial)} onPress={() => void runStep('role-denial', () => checkControlledRoleDenial(run, accessStatus === 'staff' ? 'family' : 'staff'))} className={`mt-3 min-h-11 items-center justify-center rounded-xl bg-destructive px-4 ${disabled(canRunOppositeRoleDenial) ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-destructive-foreground">Confirm opposite role is denied</Text></Pressable>
            </View>
          </View> : null}
          <View className="mt-7"><Text className="text-lg font-bold text-foreground">Safe local results</Text>{results.length === 0 ? <View className="mt-3 rounded-2xl border border-dashed border-border px-4 py-5"><Text className="text-sm text-muted-foreground">No controlled RPC calls have been made from this screen.</Text></View> : <View className="mt-3 gap-3">{results.map((result, index) => <View key={`${result.step}-${index}`} className={`rounded-2xl border border-border p-4 ${statusClass(result.status)}`}><Text className="font-bold text-foreground">{result.step.replaceAll('-', ' ')}</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{result.summary}</Text><Text className="mt-2 text-xs text-muted-foreground">{result.conversationId ? `Conversation: ${result.conversationId}` : 'No conversation ID'}{result.gymId ? ` · Gym: ${result.gymId}` : ''}{result.messageId ? ` · Message: ${result.messageId}` : ''}{result.cursorId ? ' · Server cursor retained' : ''}{result.accessRole ? ` · Role: ${result.accessRole}` : ''}{result.throughMessageId ? ` · Endpoint: ${result.throughMessageId}` : ''}{result.errorCode ? ` · Server code: ${result.errorCode}` : ''}{result.errorType ? ` · Error type: ${result.errorType}` : ''}</Text>{result.errorDetail ? <Text className="mt-2 text-xs leading-5 text-muted-foreground">Detail: {result.errorDetail}</Text> : null}</View>)}</View>}</View>
        </View>
      </ScrollView>
      <AlertDialog
        open={pendingConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !confirmationInFlightRef.current) {
            setPendingConfirmation(null);
          }
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmationTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmationDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onPress={() => setPendingConfirmation(null)}><Text>Cancel</Text></AlertDialogCancel>
            <AlertDialogAction onPress={executeConfirmation}><Text>{confirmationActionLabel}</Text></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SafeAreaView>
  );
}
