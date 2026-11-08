import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { checkReadOnlyFamilyInbox, checkReadOnlyStaffInbox, type ReadOnlyInboxCheck } from '@/lib/messaging-readonly-test';
import { isMessagingReadOnlyTestEnabled, messagingReadOnlyTestCapability } from '@/lib/messaging-readonly-test-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

function statusStyles(status: ReadOnlyInboxCheck['status']) {
  if (status === 'success') return 'bg-success/15 text-foreground';
  if (status === 'denied') return 'bg-warning/15 text-foreground';
  if (status === 'inconclusive') return 'bg-secondary text-secondary-foreground';
  return 'bg-destructive/15 text-foreground';
}

function formatStatus(status: ReadOnlyInboxCheck['status']) {
  return status === 'success' ? 'Passed' : status === 'denied' ? 'Denied by server' : status === 'inconclusive' ? 'Inconclusive' : 'Failed';
}

export default function MessagingRpcTestScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, gymId, linkedGyms, isResolvingAccess, accessError } = useGymAccess();
  const enabled = isMessagingReadOnlyTestEnabled();
  const approvedGymIds = React.useMemo(() => linkedGyms.map((gym) => gym.gym_id), [linkedGyms]);
  const defaultGymId = gymId ?? approvedGymIds[0] ?? null;
  const [gymIdInput, setGymIdInput] = React.useState(defaultGymId ? String(defaultGymId) : '');
  const [results, setResults] = React.useState<ReadOnlyInboxCheck[]>([]);
  const [isRunning, setIsRunning] = React.useState<'family' | 'staff' | null>(null);
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${gymId ?? 'none'}:${approvedGymIds.join(',')}:${isResolvingAccess}:${accessError ?? ''}`;

  React.useEffect(() => {
    setResults([]);
    setIsRunning(null);
    setGymIdInput(defaultGymId ? String(defaultGymId) : '');
  }, [defaultGymId, scope]);

  const addResult = React.useCallback((next: ReadOnlyInboxCheck) => {
    setResults((current) => [next, ...current]);
  }, []);

  const runFamilyCheck = React.useCallback(async () => {
    if (!enabled || isRunning) return;
    setIsRunning('family');
    try {
      addResult(await checkReadOnlyFamilyInbox(approvedGymIds));
    } catch {
      addResult({ kind: 'family-inbox', status: 'error', rowCount: 0, scopeMatches: null, errorCode: null, summary: 'The family inbox check could not start.' });
    } finally {
      setIsRunning(null);
    }
  }, [addResult, approvedGymIds, enabled, isRunning]);

  const runStaffCheck = React.useCallback(async () => {
    if (!enabled || isRunning) return;
    const targetGymId = Number(gymIdInput.trim());
    setIsRunning('staff');
    try {
      addResult(await checkReadOnlyStaffInbox(targetGymId));
    } catch {
      addResult({ kind: 'staff-inbox', status: 'error', rowCount: 0, scopeMatches: null, errorCode: null, summary: 'Enter a valid gym ID before running the staff inbox check.' });
    } finally {
      setIsRunning(null);
    }
  }, [addResult, enabled, gymIdInput, isRunning]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(accessStatus === 'staff' ? '/settings' : '/my-members');
  };

  if (!enabled) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><Text className="text-center text-lg font-bold text-foreground">Read-only diagnostics unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{messagingReadOnlyTestCapability.reason}</Text></View></SafeAreaView>;
  }

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Messaging diagnostics</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-warning/30 bg-warning/15 p-5"><Text className="text-sm font-bold tracking-wide text-foreground">DEVELOPMENT ONLY — READ ONLY</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Each button makes one inbox RPC call using the signed-in session. This screen cannot create conversations, send messages, acknowledge reads, or reveal message content.</Text></View><View className="mt-6 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Current test scope</Text><Text className="mt-2 text-sm text-muted-foreground">Resolved access: {accessStatus}</Text><Text className="mt-1 text-sm text-muted-foreground">Approved family gyms: {approvedGymIds.length}</Text><Text className="mt-1 text-sm text-muted-foreground">Active staff gym: {gymId ?? 'None'}</Text>{accessError ? <Text className="mt-2 text-sm text-destructive">Gym access must resolve before testing.</Text> : null}</View><View className="mt-6 gap-3"><Pressable accessibilityRole="button" accessibilityLabel="Run family inbox check" disabled={isRunning !== null || approvedGymIds.length === 0 || Boolean(accessError)} onPress={() => void runFamilyCheck()} className={`min-h-12 items-center justify-center rounded-2xl bg-primary px-5 ${isRunning !== null || approvedGymIds.length === 0 || accessError ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-primary-foreground">{isRunning === 'family' ? 'Checking family inbox…' : 'Run family inbox check'}</Text></Pressable><View className="rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Staff inbox scope check</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">Use your active gym for an authorized check. A different known gym can only be evaluated as denied when the server explicitly rejects it; an empty list is inconclusive.</Text><TextInput accessibilityLabel="Gym ID for staff inbox check" value={gymIdInput} onChangeText={setGymIdInput} keyboardType="number-pad" placeholder="Gym ID" placeholderTextColor="hsl(150 8% 46%)" editable={isRunning === null} className="mt-3 min-h-12 rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground" /><Pressable accessibilityRole="button" accessibilityLabel="Run staff inbox check" disabled={isRunning !== null || !gymIdInput.trim() || Boolean(accessError)} onPress={() => void runStaffCheck()} className={`mt-3 min-h-12 items-center justify-center rounded-xl bg-secondary px-5 ${isRunning !== null || !gymIdInput.trim() || accessError ? 'opacity-50' : 'active:bg-accent'}`}><Text className="font-bold text-secondary-foreground">{isRunning === 'staff' ? 'Checking staff inbox…' : 'Run staff inbox check'}</Text></Pressable></View></View><View className="mt-7"><Text className="text-lg font-bold text-foreground">Local results</Text><Text className="mt-1 text-sm text-muted-foreground">Results clear whenever the account or resolved gym access changes.</Text>{results.length === 0 ? <View className="mt-3 rounded-2xl border border-dashed border-border px-4 py-5"><Text className="text-sm text-muted-foreground">No RPC calls have been made in this session.</Text></View> : <View className="mt-3 gap-3">{results.map((result, index) => <View key={`${result.kind}-${index}`} className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-center justify-between gap-3"><Text className="font-bold text-foreground">{result.kind === 'family-inbox' ? 'Family inbox' : 'Staff inbox'}</Text><View className={`rounded-full px-2.5 py-1 ${statusStyles(result.status).split(' ')[0]}`}><Text className="text-xs font-bold text-foreground">{formatStatus(result.status)}</Text></View></View><Text className="mt-2 text-sm leading-5 text-muted-foreground">{result.summary}</Text><Text className="mt-2 text-xs text-muted-foreground">Rows returned: {result.rowCount}{result.scopeMatches === null ? '' : ` · Scope match: ${result.scopeMatches ? 'yes' : 'no'}`}{result.errorCode ? ` · Server code: ${result.errorCode}` : ''}</Text></View>)}</View>}</View></View></ScrollView></SafeAreaView>;
}
