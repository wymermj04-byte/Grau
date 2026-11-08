import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { AcademyIdentity } from '@/components/gym/AcademyIdentity';
import { PageContent } from '@/components/layout/PageContent';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  listFamilyCheckInClasses,
  listFamilyCheckInStudents,
  submitFamilyCheckInRequest,
  type FamilyCheckInClass,
  type FamilyCheckInRequestOutcome,
  type FamilyCheckInStudent,
} from '@/lib/family-self-check-in';
import { clearFamilySelfCheckInRetryKey, getFamilySelfCheckInRetryKey } from '@/lib/family-self-check-in-retries';
import { isSelfCheckInEnabledForGym, selfCheckInCapability } from '@/lib/self-check-in-feature';
import { useGymAccess } from '@/providers/GymAccessProvider';

function parseGymId(value: string | undefined) {
  const gymId = Number(value);
  return Number.isSafeInteger(gymId) && gymId > 0 ? gymId : null;
}

function classTime(value: string) {
  const [hour = '0', minute = '00'] = value.split(':');
  return new Date(2000, 0, 1, Number(hour), Number(minute)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function classDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return 'Date unavailable';
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function memberName(member: FamilyCheckInStudent) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ');
}

export default function FamilyCheckInScreen() {
  const router = useRouter();
  const { gymId: routeGymId } = useLocalSearchParams<{ gymId?: string }>();
  const { accessStatus, linkedGyms } = useGymAccess();
  const gymId = parseGymId(routeGymId);
  const gym = linkedGyms.find((item) => item.gym_id === gymId);
  const hasApprovedFamilyAccess = accessStatus === 'family' || (accessStatus === 'staff' && linkedGyms.length > 0);
  const [classes, setClasses] = React.useState<FamilyCheckInClass[]>([]);
  const [selectedClassId, setSelectedClassId] = React.useState<number | null>(null);
  const [students, setStudents] = React.useState<FamilyCheckInStudent[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = React.useState<Set<number>>(() => new Set());
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [resultMessage, setResultMessage] = React.useState<string | null>(null);
  const [requestOutcomes, setRequestOutcomes] = React.useState<FamilyCheckInRequestOutcome[]>([]);

  const loadStudents = React.useCallback(async (classId: number, activeGymId: number) => {
    const nextStudents = await listFamilyCheckInStudents(activeGymId, classId);
    setStudents(nextStudents);
    setSelectedStudentIds(new Set());
  }, []);

  useFocusEffect(React.useCallback(() => {
    let current = true;
    if (!isSelfCheckInEnabledForGym(gymId) || !hasApprovedFamilyAccess || gymId === null || !gym) {
      setIsLoading(false);
      return () => { current = false; };
    }
    setIsLoading(true);
    setErrorMessage(null);
    setResultMessage(null);
    setRequestOutcomes([]);
    void listFamilyCheckInClasses(gymId).then(async (nextClasses) => {
      if (!current) return;
      setClasses(nextClasses);
      const nextClassId = nextClasses[0]?.classId ?? null;
      setSelectedClassId(nextClassId);
      if (nextClassId !== null) await loadStudents(nextClassId, gymId);
      else setStudents([]);
    }).catch(() => {
      if (current) setErrorMessage('Check-in availability could not be loaded. Please try again later.');
    }).finally(() => {
      if (current) setIsLoading(false);
    });
    return () => { current = false; };
  }, [gym, gymId, hasApprovedFamilyAccess, loadStudents]));

  const selectClass = async (classId: number) => {
    if (gymId === null || isSubmitting || selectedClassId === classId) return;
    setSelectedClassId(classId);
    setErrorMessage(null);
    setResultMessage(null);
    setRequestOutcomes([]);
    try {
      await loadStudents(classId, gymId);
    } catch {
      setStudents([]);
      setErrorMessage('Eligible family members could not be loaded.');
    }
  };

  const toggleStudent = (student: FamilyCheckInStudent) => {
    if (student.eligibility !== 'eligible' || isSubmitting) return;
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (next.has(student.studentId)) next.delete(student.studentId);
      else next.add(student.studentId);
      return next;
    });
  };

  const submit = async () => {
    if (gymId === null || selectedClassId === null || selectedStudentIds.size === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setResultMessage(null);
    try {
      const selectedIds = [...selectedStudentIds].sort((first, second) => first - second);
      const retryIntent = { operation: 'family-request' as const, gymId, classId: selectedClassId, subjectIds: selectedIds };
      const outcomes = await submitFamilyCheckInRequest(gymId, selectedClassId, selectedIds, await getFamilySelfCheckInRetryKey(retryIntent));
      await clearFamilySelfCheckInRetryKey(retryIntent);
      setRequestOutcomes(outcomes);
      const requested = outcomes.filter((outcome) => outcome.state === 'pending').length;
      const unavailable = outcomes.length - requested;
      setResultMessage(requested > 0
        ? `${requested} request${requested === 1 ? '' : 's'} sent to academy staff.${unavailable ? ` ${unavailable} could not be requested.` : ''}`
        : 'No new requests were created. Review each family member’s current status.');
      await loadStudents(selectedClassId, gymId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Check-in requests could not be sent.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const unavailable = !isSelfCheckInEnabledForGym(gymId) || !hasApprovedFamilyAccess || gymId === null || !gym;
  if (unavailable) return <SafeAreaView edges={['top']} className="flex-1 bg-background"><PageContent className="flex-1 items-center justify-center px-6"><View className="items-center rounded-3xl border border-border bg-card px-6 py-9"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-xl font-bold text-foreground">Check-in unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{selfCheckInCapability.reason}</Text></View></PageContent></SafeAreaView>;

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView className="flex-1" contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}><PageContent className="px-5 pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/my-members'); }} className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-80"><LucideIcon name="ChevronLeft" className="h-6 w-6 text-secondary-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Check In</Text><View className="h-11 w-11" /></View></PageContent><PageContent className="px-5"><View className="mt-5 overflow-hidden rounded-3xl border border-primary/25 bg-card"><View className="h-1 bg-primary" /><View className="p-5"><AcademyIdentity name={gym.gym_name} logoUrl={gym.logo_url} label="Academy" /><Text className="mt-4 text-2xl font-bold text-card-foreground">Request check-in</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Choose a class and eligible family members. Your request never records attendance by itself; academy staff must approve each arrival.</Text></View></View>{isLoading ? <View className="mt-6 items-center rounded-3xl border border-border bg-card py-12"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading available classes…</Text></View> : null}{!isLoading && !errorMessage && classes.length === 0 ? <View className="mt-6 rounded-3xl border border-dashed border-border bg-card px-6 py-10"><Text className="text-center text-lg font-bold text-foreground">No classes are accepting requests</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Requests open 15 minutes before class start and remain available until staff completes or cancels the class.</Text></View> : null}{classes.length > 0 ? <View className="mt-7"><Text className="text-xl font-bold text-foreground">Available classes</Text><View className="mt-3 gap-3">{classes.map((gymClass) => <Pressable key={gymClass.classId} accessibilityRole="radio" accessibilityState={{ checked: selectedClassId === gymClass.classId }} onPress={() => void selectClass(gymClass.classId)} className={`rounded-2xl border p-4 ${selectedClassId === gymClass.classId ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}><Text className="font-bold text-card-foreground">{gymClass.className}</Text><Text className="mt-1 text-sm text-muted-foreground">{classDate(gymClass.classDate)} · {classTime(gymClass.startTime)}</Text><Text className="mt-2 text-xs font-bold uppercase tracking-wide text-primary">{gymClass.audience} · {gymClass.lifecycle.replace('_', ' ')}</Text></Pressable>)}</View></View> : null}{selectedClassId !== null && !isLoading ? <View className="mt-7"><View className="flex-row items-end justify-between"><View><Text className="text-xl font-bold text-foreground">Eligible family members</Text><Text className="mt-1 text-sm text-muted-foreground">Only selected eligible members will be requested.</Text></View><Text className="text-sm font-bold text-primary">{selectedStudentIds.size} selected</Text></View><View className="mt-3 gap-3">{students.map((student) => <StudentRow key={student.studentId} student={student} selected={selectedStudentIds.has(student.studentId)} onPress={() => toggleStudent(student)} />)}</View></View> : null}{errorMessage ? <Text className="mt-5 text-sm leading-5 text-destructive">{errorMessage}</Text> : null}{resultMessage ? <Text className="mt-5 rounded-2xl bg-success/10 px-4 py-3 text-sm leading-5 text-foreground">{resultMessage}</Text> : null}{requestOutcomes.length > 0 ? <View className="mt-4 gap-2 rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">Request status</Text>{requestOutcomes.map((outcome) => <Text key={`${outcome.studentId}:${outcome.requestId ?? 'none'}`} className="text-sm text-muted-foreground">{outcome.state.replaceAll('_', ' ')}{outcome.reason ? ` · ${outcome.reason}` : ''}</Text>)}</View> : null}<Pressable accessibilityRole="button" accessibilityLabel="Request check-in" disabled={selectedStudentIds.size === 0 || isSubmitting} onPress={() => void submit()} className={`mt-7 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary px-5 ${selectedStudentIds.size === 0 || isSubmitting ? 'opacity-60' : 'active:opacity-85'}`}>{isSubmitting ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="Send" className="h-5 w-5 text-primary-foreground" />}<Text className="font-bold text-primary-foreground">{isSubmitting ? 'Sending request…' : 'Request Check In'}</Text></Pressable><Text className="mt-3 text-center text-xs leading-4 text-muted-foreground">A request is not attendance. Staff approval is required before any attendance record is created.</Text></PageContent></ScrollView></SafeAreaView>;
}

function StudentRow({ student, selected, onPress }: { student: FamilyCheckInStudent; selected: boolean; onPress: () => void }) {
  const selectable = student.eligibility === 'eligible';
  const status = student.eligibility === 'eligible' ? 'Eligible' : student.eligibility === 'already_requested' ? 'Requested' : student.eligibility === 'already_checked_in' ? 'Already checked in' : 'Unavailable';
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: !selectable }} disabled={!selectable} onPress={onPress} className={`flex-row items-center gap-3 rounded-2xl border p-4 ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'} ${selectable ? 'active:bg-accent' : 'opacity-70'}`}><View className={`h-6 w-6 items-center justify-center rounded-md border-2 ${selected ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-card'}`}>{selected ? <LucideIcon name="Check" className="h-4 w-4 text-primary-foreground" strokeWidth={3} /> : null}</View><View className="min-w-0 flex-1"><Text className="font-bold text-card-foreground">{memberName(student)}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{student.membershipStatus ?? 'Membership status unavailable'} membership</Text>{student.reason ? <Text className="mt-1 text-xs text-muted-foreground">{student.reason}</Text> : null}</View><Text className={`text-xs font-bold ${selectable ? 'text-primary' : 'text-muted-foreground'}`}>{status}</Text></Pressable>;
}
