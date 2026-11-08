import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  bulkApproveStaffCheckInRequests,
  listStaffCheckInRequests,
  resolveStaffCheckInRequest,
  type StaffCheckInRequest,
} from '@/lib/family-self-check-in';
import { clearFamilySelfCheckInRetryKey, getFamilySelfCheckInRetryKey } from '@/lib/family-self-check-in-retries';
import { isSelfCheckInEnabled, selfCheckInCapability } from '@/lib/self-check-in-feature';
import { database, resolveActiveGymMembership } from '@/lib/database';

type PendingResolution =
  | { kind: 'single'; request: StaffCheckInRequest; decision: 'approve' | 'decline' }
  | { kind: 'bulk'; requestIds: number[] };

function parseClassId(value: string | undefined) {
  const classId = Number(value);
  return Number.isSafeInteger(classId) && classId > 0 ? classId : null;
}

function requestName(request: StaffCheckInRequest) {
  return [request.firstName, request.lastName].filter(Boolean).join(' ');
}

export default function FamilyCheckInRequestsScreen() {
  const router = useRouter();
  const { classId: routeClassId } = useLocalSearchParams<{ classId?: string }>();
  const classId = parseClassId(routeClassId);
  const [requests, setRequests] = React.useState<StaffCheckInRequest[]>([]);
  const [selectedRequestIds, setSelectedRequestIds] = React.useState<Set<number>>(() => new Set());
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [pendingResolution, setPendingResolution] = React.useState<PendingResolution | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!isSelfCheckInEnabled() || classId === null) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const membership = await resolveActiveGymMembership();
      if (membership.role !== 'admin' && membership.role !== 'coach') throw new Error('Active administrator or coach access is required.');
      setRequests(await listStaffCheckInRequests(classId));
      setSelectedRequestIds(new Set());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Family check-in requests could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [classId]);

  useFocusEffect(React.useCallback(() => { void load(); }, [load]));

  const refreshAfterApproval = React.useCallback(async () => {
    if (classId === null) return;
    await Promise.all([load(), database.listAttendanceForClass(classId)]);
  }, [classId, load]);

  const pendingRequests = requests.filter((request) => request.state === 'pending');
  const resolvedRequests = requests.filter((request) => request.state !== 'pending');
  const toggle = (requestId: number) => setSelectedRequestIds((current) => {
    const next = new Set(current);
    if (next.has(requestId)) next.delete(requestId);
    else next.add(requestId);
    return next;
  });

  const confirmResolution = async () => {
    if (!pendingResolution || classId === null || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const membership = await resolveActiveGymMembership();
      if (membership.role !== 'admin' && membership.role !== 'coach') throw new Error('Active administrator or coach access is required.');
      if (pendingResolution.kind === 'single') {
        const { request, decision } = pendingResolution;
        const retryIntent = { operation: 'staff-resolution' as const, gymId: membership.gymId, classId, subjectIds: [request.requestId], decision };
        const outcome = await resolveStaffCheckInRequest(request.requestId, decision, await getFamilySelfCheckInRetryKey(retryIntent));
        await clearFamilySelfCheckInRetryKey(retryIntent);
        setNotice(`${requestName(request)}: ${outcome.state.replaceAll('_', ' ')}.`);
        if (decision === 'approve' && outcome.state === 'approved') await refreshAfterApproval();
        else await load();
      } else {
        const requestIds = [...pendingResolution.requestIds].sort((first, second) => first - second);
        const retryIntent = { operation: 'staff-bulk-approval' as const, gymId: membership.gymId, classId, subjectIds: requestIds };
        const outcomes = await bulkApproveStaffCheckInRequests(classId, requestIds, await getFamilySelfCheckInRetryKey(retryIntent));
        await clearFamilySelfCheckInRetryKey(retryIntent);
        const approved = outcomes.filter((outcome) => outcome.state === 'approved').length;
        setNotice(`${approved} request${approved === 1 ? '' : 's'} approved.`);
        await refreshAfterApproval();
      }
      setPendingResolution(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The selected requests could not be resolved.';
      setErrorMessage(`${detail} If the result was interrupted or unclear, retry the same confirmation. Bulk approval is all-or-nothing.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isSelfCheckInEnabled() || classId === null) return <Unavailable />;

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" showsVerticalScrollIndicator={false}>
    <View className="flex-row items-center justify-between pt-4">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to class" onPress={() => { if (router.canGoBack()) router.back(); else router.replace(`/classes/${classId}`); }} className="h-11 w-11 items-center justify-center rounded-full bg-secondary"><LucideIcon name="ChevronLeft" className="h-6 w-6 text-secondary-foreground" /></Pressable>
      <Text className="text-lg font-bold text-foreground">Family requests</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh family requests" disabled={isLoading || isSubmitting} onPress={() => void load()} className="h-11 w-11 items-center justify-center rounded-full bg-secondary"><LucideIcon name="RefreshCw" className="h-5 w-5 text-secondary-foreground" /></Pressable>
    </View>
    <View className="mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-card"><View className="h-1 bg-primary" /><View className="p-5"><Text className="text-2xl font-bold text-card-foreground">Approve arrivals</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Only approval records attendance. The server rechecks lifecycle, authorization, eligibility, and duplicate attendance before saving.</Text><Text className="mt-3 text-sm font-semibold leading-5 text-foreground">Bulk approvals are all-or-nothing: if one selected request cannot be approved, none are approved.</Text></View></View>
    {isLoading ? <View className="mt-6 items-center rounded-3xl border border-border bg-card py-12"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading requests…</Text></View> : null}
    {!isLoading && pendingRequests.length === 0 ? <View className="mt-6 rounded-3xl border border-dashed border-border bg-card px-6 py-10"><Text className="text-center text-lg font-bold text-foreground">No pending requests</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Approved, declined, unavailable, and already-checked-in requests remain in their recorded state.</Text></View> : null}
    {pendingRequests.length > 0 ? <View className="mt-6 gap-3">{pendingRequests.map((request) => <RequestRow key={request.requestId} request={request} selected={selectedRequestIds.has(request.requestId)} disabled={isSubmitting || pendingResolution !== null} onToggle={() => toggle(request.requestId)} onApprove={() => setPendingResolution({ kind: 'single', request, decision: 'approve' })} onDecline={() => setPendingResolution({ kind: 'single', request, decision: 'decline' })} />)}</View> : null}
    {resolvedRequests.length > 0 ? <View className="mt-6 rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">Recorded request states</Text><View className="mt-3 gap-2">{resolvedRequests.map((request) => <View key={request.requestId} className="flex-row items-center justify-between gap-3"><Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>{requestName(request)}</Text><Text className="text-xs font-bold capitalize text-foreground">{request.state.replaceAll('_', ' ')}</Text></View>)}</View></View> : null}
    {pendingRequests.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Approve selected requests" disabled={selectedRequestIds.size === 0 || isSubmitting || pendingResolution !== null} onPress={() => setPendingResolution({ kind: 'bulk', requestIds: [...selectedRequestIds] })} className={`mt-6 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary px-5 ${selectedRequestIds.size === 0 || isSubmitting || pendingResolution !== null ? 'opacity-60' : 'active:opacity-85'}`}><LucideIcon name="CheckCheck" className="h-5 w-5 text-primary-foreground" /><Text className="font-bold text-primary-foreground">Approve selected ({selectedRequestIds.size})</Text></Pressable> : null}
    {pendingResolution ? <ConfirmationCard pendingResolution={pendingResolution} busy={isSubmitting} onCancel={() => setPendingResolution(null)} onConfirm={() => void confirmResolution()} /> : null}
    {notice ? <Text className="mt-5 rounded-2xl bg-success/10 px-4 py-3 text-sm leading-5 text-foreground">{notice}</Text> : null}
    {errorMessage ? <Text className="mt-5 text-sm leading-5 text-destructive">{errorMessage}</Text> : null}
  </ScrollView></SafeAreaView>;
}

function Unavailable() {
  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-xl font-bold text-foreground">Family check-in unavailable</Text><Text className="mt-2 text-center text-sm text-muted-foreground">{selfCheckInCapability.reason}</Text></View></SafeAreaView>;
}

function ConfirmationCard({ pendingResolution, busy, onCancel, onConfirm }: { pendingResolution: PendingResolution; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const isBulk = pendingResolution.kind === 'bulk';
  const isApproval = isBulk || pendingResolution.decision === 'approve';
  const subject = isBulk ? `${pendingResolution.requestIds.length} selected request${pendingResolution.requestIds.length === 1 ? '' : 's'}` : requestName(pendingResolution.request);
  const title = isApproval ? `Approve ${subject}?` : `Decline ${subject}?`;
  const detail = isBulk ? 'If any selected request cannot be approved, the server rolls back the entire batch. No partial approval is created.' : isApproval ? 'Approval may create attendance only if the server still accepts the class and request.' : 'A declined request is final for this student and class.';
  return <View className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-5"><Text className="text-lg font-bold text-foreground">{title}</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</Text><View className="mt-5 flex-row gap-3"><Pressable accessibilityRole="button" accessibilityLabel="Cancel request resolution" disabled={busy} onPress={onCancel} className="min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card px-3"><Text className="font-bold text-foreground">Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Confirm request resolution" disabled={busy} onPress={onConfirm} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-3 ${busy ? 'opacity-60' : 'active:opacity-85'}`}>{busy ? <LoadingIndicator tone="on-primary" /> : <Text className="font-bold text-primary-foreground">Confirm</Text>}</Pressable></View></View>;
}

function RequestRow({ request, selected, disabled, onToggle, onApprove, onDecline }: { request: StaffCheckInRequest; selected: boolean; disabled: boolean; onToggle: () => void; onApprove: () => void; onDecline: () => void }) {
  return <View className={`rounded-2xl border p-4 ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}><View className="flex-row items-start gap-3"><Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${requestName(request)}`} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onToggle} className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}>{selected ? <LucideIcon name="Check" className="h-4 w-4 text-primary-foreground" strokeWidth={3} /> : null}</Pressable><View className="min-w-0 flex-1"><Text className="font-bold text-card-foreground">{requestName(request)}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{request.membershipStatus ?? 'Membership status unavailable'} · Requested {new Date(request.requestedAt).toLocaleString()}</Text>{request.reason ? <Text className="mt-1 text-xs text-muted-foreground">{request.reason}</Text> : null}</View></View><View className="mt-4 flex-row gap-3"><Pressable accessibilityRole="button" accessibilityLabel={`Decline ${requestName(request)}`} disabled={disabled} onPress={onDecline} className={`min-h-11 flex-1 items-center justify-center rounded-xl border border-destructive/30 bg-card px-3 ${disabled ? 'opacity-60' : 'active:bg-destructive/10'}`}><Text className="text-sm font-bold text-destructive">Decline</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Approve ${requestName(request)}`} disabled={disabled} onPress={onApprove} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-3 ${disabled ? 'opacity-60' : 'active:opacity-85'}`}><Text className="text-sm font-bold text-primary-foreground">Approve</Text></Pressable></View></View>;
}
