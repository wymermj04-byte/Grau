import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { database } from '@/lib/database';
import {
  calculateStripeProgress,
  type ClassContractException,
  type HistoricalPromotionBoundary,
  type ProgressAttendance,
  type ProgressBaseline,
  type ProgressClass,
  type ProgressPromotion,
} from '@/lib/stripe-progress';
import { supabase } from '@/lib/supabase';
import { selfCheckInCapability, isSelfCheckInPreviewEnabled } from '@/lib/self-check-in-feature';
import { useGymAccess } from '@/providers/GymAccessProvider';

type ClassRecord = { id?: unknown; class_name?: unknown; class_date?: unknown; start_time?: unknown; class_audience?: unknown; status?: unknown; is_active?: unknown };
type StudentRecord = { studentId?: unknown; membership_status?: unknown; programs?: unknown; belt_rank?: unknown; stripes?: unknown; promotion_track?: unknown };
type Check = { label: string; ready: boolean; detail: string };
type PilotProgressContext = { classes: ProgressClass[]; class_contract_exceptions: ClassContractException[]; historical_boundaries: HistoricalPromotionBoundary[] };
type PilotAttendance = ProgressAttendance & { student_id?: unknown };

function positive(value: string) { const number = Number(value.trim()); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

export default function FamilySelfCheckInPilotReadinessScreen() {
  const router = useRouter();
  const { gymId, staffRole, accessStatus, linkedGyms } = useGymAccess();
  const [classInput, setClassInput] = React.useState('574');
  const [studentInput, setStudentInput] = React.useState('1');
  const [checks, setChecks] = React.useState<Check[]>([]);
  const [advancementSnapshot, setAdvancementSnapshot] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const staffAuthorized = isSelfCheckInPreviewEnabled() && accessStatus === 'staff' && gymId === 4 && (staffRole === 'admin' || staffRole === 'coach');
  const familyAuthorized = isSelfCheckInPreviewEnabled() && accessStatus === 'family' && linkedGyms.some((gym) => gym.gym_id === 4);
  const authorized = staffAuthorized || familyAuthorized;

  const runFamilyReadiness = React.useCallback(async () => {
    if (loading) return;
    setLoading(true); setError(null); setChecks([]);
    try {
      const [{ data: members, error: membersError }, { error: rolloutError }] = await Promise.all([
        supabase.rpc('my_linked_members'),
        supabase.rpc('family_self_check_in_available_classes', { p_gym_id: 4 }),
      ]);
      if (membersError) throw membersError;
      const hasArloLink = Array.isArray(members) && members.some((member) => member && typeof member === 'object' && Number((member as { student_id?: unknown }).student_id) === 1 && Number((member as { gym_id?: unknown }).gym_id) === 4);
      const rolloutDisabled = rolloutError?.code === '42501' && rolloutError.message === 'Family self-check-in is not enabled for this academy.';
      setChecks([
        { label: 'Operational capability', ready: !selfCheckInCapability.enabled, detail: !selfCheckInCapability.enabled ? 'Disabled locally.' : 'Must be disabled before the pilot.' },
        { label: 'Approved family link', ready: hasArloLink, detail: hasArloLink ? 'The signed-in family account has authorized access to the selected Gym 4 member.' : 'This account does not have the required approved Gym 4 family link.' },
        { label: 'Gym 4 server rollout', ready: rolloutDisabled, detail: rolloutDisabled ? 'The server rejected the read-only availability check because rollout remains disabled.' : 'The expected rollout-disabled response was not received.' },
      ]);
    } catch {
      setError('The authorized family verification could not be completed. No pilot action was taken.');
    } finally { setLoading(false); }
  }, [loading]);

  const runReadiness = React.useCallback(async () => {
    const classId = positive(classInput); const studentId = positive(studentInput);
    if (!classId || !studentId || loading) return;
    setLoading(true); setError(null); setChecks([]); setAdvancementSnapshot(null);
    try {
      const [classes, students, attendance] = await Promise.all([
        database.listClasses<ClassRecord>(), database.listStudents<StudentRecord>(), database.listAttendanceForClassStudent(classId, studentId),
      ]);
      const selectedClass = classes.find((item) => Number(item.id) === classId);
      const selectedStudent = students.find((item) => Number(item.studentId) === studentId);
      const audience = text(selectedClass?.class_audience);
      const programs = Array.isArray(selectedStudent?.programs) ? selectedStudent.programs.filter((item): item is string => typeof item === 'string') : [];
      const lifecycle = text(selectedClass?.status);
      const lifecycleReady = (lifecycle === 'Scheduled' && selectedClass?.is_active === false) || (lifecycle === 'In Progress' && selectedClass?.is_active === true);
      const audienceReady = audience === 'kids' || audience === 'adults' || audience === 'mixed';
      const programReady = audience === 'mixed' ? programs.includes('kids') || programs.includes('adults') : programs.includes(audience);
      const expectedPilotClass = text(selectedClass?.class_name) === 'Kids Gi' && text(selectedClass?.class_date).startsWith('2026-11-05');
      setChecks([
        { label: 'Operational capability', ready: !selfCheckInCapability.enabled, detail: !selfCheckInCapability.enabled ? 'Disabled locally.' : 'Must be disabled before the pilot.' },
        { label: 'Gym 4 staff access', ready: true, detail: 'Active Gym 4 administrator or coach session confirmed.' },
        { label: 'Class scheduling and lifecycle', ready: Boolean(selectedClass && expectedPilotClass && text(selectedClass.class_date) && text(selectedClass.start_time) && audienceReady && lifecycleReady), detail: selectedClass ? expectedPilotClass ? 'Class matches the planned session and has the required time, audience, and accepting lifecycle.' : 'Selected class does not match the planned pilot session.' : 'Class was not found in the active Gym 4 schedule.' },
        { label: 'Student membership and audience', ready: Boolean(selectedStudent && ['active', 'trial'].includes(text(selectedStudent.membership_status).toLowerCase()) && programReady), detail: selectedStudent ? 'Student is Active or Trial and assigned to the selected audience.' : 'Student was not found in the active Gym 4 roster.' },
        { label: 'Existing attendance', ready: attendance.length === 0, detail: attendance.length === 0 ? 'No saved attendance exists for this class and student.' : 'Attendance already exists; choose a different real pilot participant.' },
        { label: 'Stripe-progress baseline', ready: Boolean(selectedStudent && text(selectedStudent.belt_rank) && Number.isInteger(selectedStudent.stripes)), detail: selectedStudent ? 'Current belt and stripe values are available to record before the pilot.' : 'Student baseline is unavailable.' },
        { label: 'Gym 4 server rollout', ready: false, detail: 'Manual confirmation required: this staff-only checklist does not bypass rollout authorization.' },
        { label: 'Attendance classification trigger', ready: false, detail: 'Manual confirmation required: trigger catalog state is not available through this authorized app access.' },
        { label: 'Class/student duplicate protection', ready: false, detail: 'Manual confirmation required: index catalog state is not available through this authorized app access.' },
        { label: 'Promotion boundary', ready: false, detail: 'Record the current promotion boundary manually before creating any pilot attendance.' },
      ]);
    } catch {
      setError('Read-only Gym 4 readiness data could not be loaded. No pilot action was taken.');
    } finally { setLoading(false); }
  }, [classInput, loading, studentInput]);

  const captureAdvancementSnapshot = React.useCallback(async () => {
    const studentId = positive(studentInput);
    if (!studentId || loading) return;
    setLoading(true); setError(null); setAdvancementSnapshot(null);
    try {
      const [students, attendance, promotions, baselines, context] = await Promise.all([
        database.listStudents<StudentRecord>(),
        database.listAttendanceForStudent<PilotAttendance>(studentId),
        database.listPromotions<ProgressPromotion>(),
        database.listStripeProgressBaselines<ProgressBaseline>(),
        database.getGymStripeProgressContext<PilotProgressContext>(),
      ]);
      const student = students.find((item) => Number(item.studentId) === studentId);
      const stripes = Number(student?.stripes);
      const programs = Array.isArray(student?.programs) ? student.programs.filter((item): item is string => typeof item === 'string') : [];
      if (!student || !text(student.belt_rank) || !Number.isInteger(stripes)) throw new Error('The selected student’s saved advancement details are unavailable.');
      if (context.class_contract_exceptions.length > 0) throw new Error('Stripe progress is paused until scheduled-class contract exceptions are reviewed.');
      const result = calculateStripeProgress(
        { belt_rank: text(student.belt_rank), stripes, programs, promotion_track: text(student.promotion_track) || null },
        attendance.filter((item) => Number(item.student_id) === studentId),
        promotions.filter((item) => item.student_id === studentId),
        baselines.filter((item) => item.student_id === studentId),
        { classes: context.classes, historicalBoundaries: context.historical_boundaries.filter((item) => item.student_id === studentId) },
      );
      const julyBoundary = context.historical_boundaries.some((item) => item.student_id === studentId && item.last_promotion_date === '2026-07-23');
      const progress = result.state === 'ready' ? `${result.counted} of ${result.required} qualifying classes recorded` : result.reason;
      setAdvancementSnapshot(`${progress}. July 23, 2026 historical promotion boundary: ${julyBoundary ? 'recorded' : 'not recorded—manual review required'}.`);
    } catch (snapshotError) {
      setError(snapshotError instanceof Error ? snapshotError.message : 'The read-only advancement snapshot could not be captured.');
    } finally { setLoading(false); }
  }, [loading, studentInput]);

  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace(familyAuthorized ? '/my-members' : '/settings'); };
  if (!authorized) return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">Pilot checklist unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Development-only access requires an approved Gym 4 family account or active Gym 4 staff access.</Text></View></SafeAreaView>;
  if (familyAuthorized) return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Pilot readiness</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-warning/30 bg-warning/15 p-5"><Text className="text-sm font-bold text-foreground">DEVELOPMENT ONLY · READ ONLY</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This check verifies only the signed-in family account’s authorized Gym 4 access and the disabled rollout response. It does not reveal family, student, or request data.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Verify authorized family pilot readiness" disabled={loading} onPress={() => void runFamilyReadiness()} className={`mt-5 min-h-12 items-center justify-center rounded-xl bg-primary ${loading ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-primary-foreground">{loading ? 'Checking authorized access…' : 'Verify family readiness'}</Text></Pressable>{error ? <Text className="mt-4 text-sm text-destructive">{error}</Text> : null}<View className="mt-6 gap-3">{checks.map((check) => <View key={check.label} className="rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">{check.label}: {check.ready ? 'Ready' : 'Needs review'}</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{check.detail}</Text></View>)}</View><View className="mt-6 rounded-2xl border border-dashed border-border p-4"><Text className="font-bold text-foreground">Staff confirmation still required</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Staff must separately record class and student readiness, no existing attendance, the current stripe-progress baseline and promotion boundary, plus trigger and duplicate-index integrity.</Text></View></View></ScrollView></SafeAreaView>;
  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}><View className="w-full max-w-xl self-center pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Pilot readiness</Text><View className="h-11 w-11" /></View><View className="mt-6 rounded-3xl border border-warning/30 bg-warning/15 p-5"><Text className="text-sm font-bold text-foreground">DEVELOPMENT ONLY · READ ONLY</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This checklist reads existing Gym 4 data only. It cannot create a request, attendance record, audit event, or rollout row.</Text></View><View className="mt-5 gap-3 rounded-2xl border border-border bg-card p-4"><TextInput accessibilityLabel="Pilot class ID" value={classInput} onChangeText={setClassInput} keyboardType="number-pad" placeholder="Gym 4 class ID" placeholderTextColor="hsl(150 8% 46%)" className="min-h-12 rounded-xl border border-border bg-background px-4 text-foreground" /><TextInput accessibilityLabel="Pilot student ID" value={studentInput} onChangeText={setStudentInput} keyboardType="number-pad" placeholder="Gym 4 student ID" placeholderTextColor="hsl(150 8% 46%)" className="min-h-12 rounded-xl border border-border bg-background px-4 text-foreground" /><Pressable accessibilityRole="button" accessibilityLabel="Run read-only pilot readiness checks" disabled={loading || !positive(classInput) || !positive(studentInput)} onPress={() => void runReadiness()} className={`min-h-12 items-center justify-center rounded-xl bg-primary ${loading || !positive(classInput) || !positive(studentInput) ? 'opacity-50' : 'active:opacity-90'}`}><Text className="font-bold text-primary-foreground">{loading ? 'Checking readiness…' : 'Run read-only readiness check'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Capture read-only advancement snapshot" disabled={loading || !positive(studentInput)} onPress={() => void captureAdvancementSnapshot()} className={`min-h-12 items-center justify-center rounded-xl border border-primary/30 bg-card ${loading || !positive(studentInput) ? 'opacity-50' : 'active:bg-accent'}`}><Text className="font-bold text-foreground">Capture advancement snapshot</Text></Pressable></View>{error ? <Text className="mt-4 text-sm text-destructive">{error}</Text> : null}{advancementSnapshot ? <View className="mt-5 rounded-2xl border border-primary/25 bg-primary/5 p-4"><Text className="font-bold text-foreground">Read-only advancement snapshot</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{advancementSnapshot}</Text></View> : null}<View className="mt-6 gap-3">{checks.map((check) => <View key={check.label} className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-center gap-2"><LucideIcon name={check.ready ? 'CircleCheck' : 'CircleAlert'} className={`h-5 w-5 ${check.ready ? 'text-success' : 'text-warning'}`} /><Text className="font-bold text-foreground">{check.label}</Text></View><Text className="mt-2 text-sm leading-5 text-muted-foreground">{check.detail}</Text></View>)}</View><View className="mt-6 rounded-2xl border border-dashed border-border p-4"><Text className="font-bold text-foreground">Manual confirmations still required</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Before activation, separately confirm the corrected bulk-approval function is deployed, Gym 4 rollout remains disabled, the family’s approved non-revoked link, and the attendance classification trigger plus class/student duplicate index. Record the captured stripe-progress count and promotion boundary before creating real pilot attendance.</Text></View></View></ScrollView></SafeAreaView>;
}
