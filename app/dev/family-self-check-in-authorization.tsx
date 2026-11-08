import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  runFamilySelfCheckInAuthorizationProbe,
  type FamilySelfCheckInAuthorizationProbe,
  type FamilySelfCheckInAuthorizationResult,
} from '@/lib/family-self-check-in-authorization-test';
import {
  familySelfCheckInAuthorizationTestCapability,
  isFamilySelfCheckInAuthorizationTestEnabled,
} from '@/lib/family-self-check-in-authorization-test-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

type ProbeDefinition = {
  id: FamilySelfCheckInAuthorizationProbe;
  label: string;
  role: 'family' | 'staff';
  requiresClass: boolean;
};

const probes: ProbeDefinition[] = [
  { id: 'family-available-classes', label: 'Family available classes', role: 'family', requiresClass: false },
  { id: 'family-eligible-students', label: 'Family eligible students', role: 'family', requiresClass: true },
  { id: 'family-request', label: 'Family request boundary', role: 'family', requiresClass: true },
  { id: 'staff-list-requests', label: 'Staff request list', role: 'staff', requiresClass: true },
  { id: 'staff-resolve-request', label: 'Staff single-resolution boundary', role: 'staff', requiresClass: false },
  { id: 'staff-bulk-approve', label: 'Staff bulk-approval boundary', role: 'staff', requiresClass: true },
];

function probeTitle(probe: FamilySelfCheckInAuthorizationProbe) {
  return probes.find((item) => item.id === probe)?.label ?? 'Authorization probe';
}

export default function FamilySelfCheckInAuthorizationScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, gymId, staffRole, linkedGyms, isResolvingAccess, accessError } = useGymAccess();
  const enabled = isFamilySelfCheckInAuthorizationTestEnabled();
  const familyGym4 = accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === 4);
  const staffGym4 = accessStatus === 'staff' && gymId === 4 && (staffRole === 'admin' || staffRole === 'coach');
  const authorized = familyGym4 || staffGym4;
  const [classIdInput, setClassIdInput] = React.useState('');
  const [results, setResults] = React.useState<FamilySelfCheckInAuthorizationResult[]>([]);
  const [runningProbe, setRunningProbe] = React.useState<FamilySelfCheckInAuthorizationProbe | null>(null);
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${gymId ?? 'none'}:${staffRole ?? 'none'}:${linkedGyms.map((gym) => gym.gym_id).join(',')}:${isResolvingAccess}:${accessError ?? ''}`;

  React.useEffect(() => {
    setResults([]);
    setRunningProbe(null);
    setClassIdInput('');
  }, [scope]);

  const runProbe = React.useCallback(async (probe: ProbeDefinition) => {
    if (!enabled || !authorized || runningProbe) return;
    const classId = Number(classIdInput.trim());
    if (probe.requiresClass && (!Number.isSafeInteger(classId) || classId <= 0)) return;
    setRunningProbe(probe.id);
    try {
      const next = await runFamilySelfCheckInAuthorizationProbe(probe.id, probe.requiresClass ? classId : undefined);
      setResults((current) => [next, ...current]);
    } catch {
      setResults((current) => [{
        probe: probe.id,
        status: 'failed',
        summary: 'The diagnostic could not start. No result data was retained.',
        errorCode: null,
        completedAt: new Date().toISOString(),
      }, ...current]);
    } finally {
      setRunningProbe(null);
    }
  }, [authorized, classIdInput, enabled, runningProbe]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(accessStatus === 'staff' ? '/settings' : '/my-members');
  };

  if (!enabled) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><Text className="text-center text-lg font-bold text-foreground">Authorization diagnostics unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{familySelfCheckInAuthorizationTestCapability.reason}</Text></View></SafeAreaView>;
  }

  if (!authorized || isResolvingAccess || accessError) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Gym 4 authorization required</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">This development-only diagnostic is available only to an approved Gym 4 family account or an active Gym 4 administrator or coach.</Text></View></SafeAreaView>;
  }

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Self-check-in diagnostics</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-warning/30 bg-warning/15 p-5"><Text className="text-sm font-bold tracking-wide text-foreground">DEVELOPMENT ONLY — AUTHORIZATION TEST</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Each button makes exactly one controlled RPC call. The operational feature remains disabled. This screen does not show or create family, student, request, attendance, or audit data.</Text></View><View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Test scope</Text><Text className="mt-2 text-sm text-muted-foreground">Signed-in role: {familyGym4 ? 'Approved Gym 4 family' : 'Active Gym 4 staff'}</Text><Text className="mt-1 text-sm text-muted-foreground">Expected result: rollout-disabled server rejection</Text><Text className="mt-1 text-sm text-muted-foreground">Operational self-check-in: disabled</Text></View><View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="text-sm font-bold text-foreground">Gym 4 class scope</Text><Text className="mt-1 text-xs leading-5 text-muted-foreground">Enter a valid Gym 4 class ID only for probes that require class scope. The value is used for the request and is not retained or displayed in diagnostics.</Text><TextInput accessibilityLabel="Gym 4 class ID for authorization probes" value={classIdInput} onChangeText={setClassIdInput} keyboardType="number-pad" placeholder="Gym 4 class ID" placeholderTextColor="hsl(150 8% 46%)" editable={runningProbe === null} className="mt-3 min-h-12 rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground" /></View><View className="mt-6 gap-3">{probes.filter((probe) => probe.role === (familyGym4 ? 'family' : 'staff')).map((probe) => {
    const blocked = runningProbe !== null || (probe.requiresClass && (!Number.isSafeInteger(Number(classIdInput.trim())) || Number(classIdInput.trim()) <= 0));
    return <Pressable key={probe.id} accessibilityRole="button" accessibilityLabel={`Run ${probe.label} authorization probe`} disabled={blocked} onPress={() => void runProbe(probe)} className={`min-h-12 items-center justify-center rounded-2xl bg-primary px-5 ${blocked ? 'opacity-50' : 'active:opacity-90'}`}><Text className="text-center font-bold text-primary-foreground">{runningProbe === probe.id ? 'Running controlled probe…' : `Run ${probe.label}`}</Text></Pressable>;
  })}</View><View className="mt-7"><Text className="text-lg font-bold text-foreground">Local diagnostic results</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Results clear whenever the signed-in account or Gym 4 authorization changes.</Text>{results.length === 0 ? <View className="mt-3 rounded-2xl border border-dashed border-border px-4 py-5"><Text className="text-sm text-muted-foreground">No RPC calls have been made in this session.</Text></View> : <View className="mt-3 gap-3">{results.map((item, index) => <View key={`${item.probe}-${item.completedAt}-${index}`} className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-center justify-between gap-3"><Text className="min-w-0 flex-1 font-bold text-foreground">{probeTitle(item.probe)}</Text><View className={`rounded-full px-2.5 py-1 ${item.status === 'passed' ? 'bg-success/15' : 'bg-destructive/15'}`}><Text className="text-xs font-bold text-foreground">{item.status === 'passed' ? 'Passed' : 'Failed'}</Text></View></View><Text className="mt-2 text-sm leading-5 text-muted-foreground">{item.summary}</Text><Text className="mt-2 text-xs text-muted-foreground">Server code: {item.errorCode ?? 'Unavailable'} · No record data retained</Text></View>)}</View>}</View></View></ScrollView></SafeAreaView>;
}
