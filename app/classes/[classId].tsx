import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { MemberAvatar } from '@/components/gym/MemberAvatar';
import { database, resolveActiveGymMembership } from '@/lib/database';
import { confirmExistingClassCheckIn, isPostgresUniqueViolation } from '@/lib/attendance-conflicts';
import { filterCompletedClassRoster, filterInProgressClassRoster, normalizeClassAudience, studentHasSavedCheckIn } from '@/lib/class-roster';
import { fullName, studentInitials, type Student } from '@/lib/students';
import { isSelfCheckInEnabled, isSelfCheckInPreviewEnabled, selfCheckInCapability, selfCheckInPreviewCapability } from '@/lib/self-check-in-feature';

type GymClass = {
  id: number;
  class_name: string;
  coach_name: string | null;
  class_date: string;
  start_time: string;
  end_time: string;
  max_students: number | null;
  class_type: string | null;
  class_audience: string | null;
  notes: string | null;
  is_active: boolean | null;
  status: string | null;
  gym_id: number | null;
  stripe_progress_classification?: 'qualifying' | 'open_mat' | 'non_qualifying' | null;
};

function isValidGymId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function normalizeId(value: unknown): number | null {
  const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function formatTime(value: string) {
  const [hour = '0', minute = '00'] = value.split(':');
  return new Date(2000, 0, 1, Number(hour), Number(minute)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatClassDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return 'Date unavailable';
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function classAudienceLabel(value: unknown) {
  const audience = normalizeClassAudience(value);
  return audience ? `${audience[0].toUpperCase()}${audience.slice(1)}` : null;
}

function logAttendanceDiagnostic(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info('[attendance-diagnostic]', event, details);
  }
}

export default function ActiveClassScreen() {
  const router = useRouter();
  const { classId } = useLocalSearchParams<{ classId?: string }>();
  const [gymClass, setGymClass] = React.useState<GymClass | null>(null);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isStarting, setIsStarting] = React.useState(false);
  const [isEnding, setIsEnding] = React.useState(false);
  const [checkingStudentId, setCheckingStudentId] = React.useState<number | null>(null);
  const [checkedIn, setCheckedIn] = React.useState<Set<number>>(() => new Set());
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [attendanceLoadError, setAttendanceLoadError] = React.useState<string | null>(null);
  const [isAttendanceLoading, setIsAttendanceLoading] = React.useState(false);
  const [isAttendanceReady, setIsAttendanceReady] = React.useState(false);
  const [checkInNotice, setCheckInNotice] = React.useState<string | null>(null);
  const [canEditCompletedClass, setCanEditCompletedClass] = React.useState(false);
  const [canEditCompletedAttendance, setCanEditCompletedAttendance] = React.useState(false);
  const [canManageFamilySelfCheckIn, setCanManageFamilySelfCheckIn] = React.useState(false);
  const [isEditingCompletedAttendance, setIsEditingCompletedAttendance] = React.useState(false);
  const [pendingRemoval, setPendingRemoval] = React.useState<Student | null>(null);
  const attendanceRequestId = React.useRef(0);
  const loadedClassIdRef = React.useRef<string | undefined>(undefined);
  const checkedInRef = React.useRef<Set<number>>(new Set());

  React.useEffect(() => {
    checkedInRef.current = checkedIn;
  }, [checkedIn]);

  const loadSavedAttendance = React.useCallback(async (numericClassId: number, roster: Student[]) => {
    const requestId = ++attendanceRequestId.current;
    setIsAttendanceLoading(true);
    setAttendanceLoadError(null);
    setIsAttendanceReady(false);
    try {
      const attendanceResponse = await database.listAttendanceForClass(numericClassId);
      const rosterStudentIds = new Set(
        roster
          .map((student) => normalizeId(student.studentId))
          .filter((studentId): studentId is number => studentId !== null),
      );
      const savedCheckIns = new Set<number>();

      if (Array.isArray(attendanceResponse)) {
        for (const record of attendanceResponse) {
          if (!record || typeof record !== 'object') continue;
          const attendance = record as { class_id?: unknown; student_id?: unknown };
          const recordClassId = normalizeId(attendance.class_id);
          const recordStudentId = normalizeId(attendance.student_id);
          if (recordClassId === numericClassId && recordStudentId !== null && rosterStudentIds.has(recordStudentId)) {
            savedCheckIns.add(recordStudentId);
          }
        }
      }

      if (attendanceRequestId.current === requestId) {
        logAttendanceDiagnostic('reload-result', {
          classId: numericClassId,
          returnedRecordCount: Array.isArray(attendanceResponse) ? attendanceResponse.length : 0,
          selectedStudentIds: [...savedCheckIns],
          requestId,
        });
        setCheckedIn(savedCheckIns);
        setIsAttendanceReady(true);
      }
    } catch {
      if (attendanceRequestId.current === requestId) {
        logAttendanceDiagnostic('reload-failed', {
          classId: numericClassId,
          retainedStudentIds: [...checkedInRef.current],
          requestId,
        });
        setAttendanceLoadError('Unable to load saved attendance. Check-ins are paused to protect existing records.');
        setIsAttendanceReady(false);
      }
    } finally {
      if (attendanceRequestId.current === requestId) setIsAttendanceLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let isFocused = true;
      async function loadClassSession() {
        if (isFocused) {
          logAttendanceDiagnostic('route-focused', {
            classId: classId ?? null,
            previouslyLoadedClassId: loadedClassIdRef.current ?? null,
            selectedStudentIds: [...checkedInRef.current],
          });
          if (loadedClassIdRef.current !== classId) setCheckedIn(new Set());
          setAttendanceLoadError(null);
          setIsAttendanceReady(false);
          setCheckInNotice(null);
          setIsEditingCompletedAttendance(false);
          setPendingRemoval(null);
          setErrorMessage(null);
        }
        try {
          const [classesResponse, studentsResponse, membership] = await Promise.all([
            database.listClasses<GymClass>(),
            database.listStudents<Student>(),
            resolveActiveGymMembership(),
          ]);
          if (!isFocused) return;
          const foundClass = (classesResponse as GymClass[]).find((item) => String(item.id) === classId);
          const roster = (studentsResponse as Student[]).sort((first, second) => fullName(first).localeCompare(fullName(second)));
          setGymClass(foundClass ?? null);
          setStudents(roster);
          setCanEditCompletedClass(membership.role === 'admin');
          setCanEditCompletedAttendance(membership.role === 'admin' || membership.role === 'coach');
          setCanManageFamilySelfCheckIn(membership.role === 'admin' || membership.role === 'coach');

          const numericClassId = normalizeId(foundClass?.id);
          if (!foundClass || numericClassId === null) return;
          loadedClassIdRef.current = classId;
          await loadSavedAttendance(numericClassId, roster);
        } catch {
          if (isFocused) setErrorMessage('The live class roster could not be loaded. Try again later.');
        } finally {
          if (isFocused) setIsLoading(false);
        }
      }
      void loadClassSession();
      return () => {
        isFocused = false;
        attendanceRequestId.current += 1;
      };
    }, [classId, loadSavedAttendance]),
  );

  const normalizedStatus = gymClass?.status?.trim().toLowerCase();
  const isInProgress = gymClass?.is_active === true && normalizedStatus === 'in progress';
  const isCompleted = normalizedStatus === 'completed';
  const isCancelled = normalizedStatus === 'cancelled';
  const isEditingAttendance = isCompleted && isEditingCompletedAttendance && canEditCompletedAttendance;
  const visibleStudents = isInProgress || isEditingAttendance
    ? filterInProgressClassRoster(students, gymClass?.class_audience, checkedIn)
    : isCompleted
      ? filterCompletedClassRoster(students, checkedIn)
      : [];

  const retrySavedAttendance = () => {
    const numericClassId = normalizeId(gymClass?.id);
    if ((!isCompleted && !isInProgress) || numericClassId === null || isAttendanceLoading) return;
    void loadSavedAttendance(numericClassId, students);
  };

  const startClass = async () => {
    if (!gymClass || isStarting || isEnding || isInProgress || isCompleted || isCancelled) return;
    setIsStarting(true);
    setErrorMessage(null);
    try {
      await database.updateClass(gymClass.id, { is_active: 'true', status: 'In Progress' });
      setGymClass({ ...gymClass, is_active: true, status: 'In Progress' });
    } catch {
      setErrorMessage('Class could not be started. Try again.');
    } finally {
      setIsStarting(false);
    }
  };

  const checkInStudent = async (student: Student) => {
    if (!gymClass || (!isInProgress && !isEditingAttendance) || !isAttendanceReady || checkingStudentId !== null || checkedIn.has(student.studentId)) return;
    if (!isValidGymId(gymClass.gym_id)) {
      setErrorMessage('This class is not assigned to a valid gym. Check-in cannot be recorded.');
      return;
    }
    if (!isValidGymId(student.gym_id)) {
      setErrorMessage(`${fullName(student)} is not assigned to a valid gym. Check-in cannot be recorded.`);
      return;
    }
    if (student.gym_id !== gymClass.gym_id) {
      setErrorMessage(`${fullName(student)} belongs to a different gym and cannot be checked in to this class.`);
      return;
    }
    const classification = gymClass.stripe_progress_classification;
    if (isEditingAttendance && classification !== 'qualifying' && classification !== 'open_mat' && classification !== 'non_qualifying') {
      setErrorMessage('This class does not have a valid stripe-progress classification. Attendance correction is unavailable until the class details are corrected.');
      return;
    }
    setCheckingStudentId(student.studentId);
    setErrorMessage(null);
    setCheckInNotice(null);
    try {
      logAttendanceDiagnostic('save-started', {
        classId: gymClass.id,
        studentId: student.studentId,
        gymId: gymClass.gym_id,
        stripeProgressClassification: classification ?? null,
      });
      const saveResult = await database.createAttendance({
          student_id: String(student.studentId),
          class_id: gymClass.id,
          check_in_date: new Date().toISOString(),
          class_type: gymClass.class_name,
          notes: '',
          gym_id: gymClass.gym_id,
          ...(classification === 'qualifying' || classification === 'open_mat' || classification === 'non_qualifying'
            ? { stripe_progress_classification: classification }
            : {}),
      });
      logAttendanceDiagnostic('save-result', {
        classId: gymClass.id,
        studentId: student.studentId,
        gymId: gymClass.gym_id,
        returnedRecordCount: Array.isArray(saveResult) ? saveResult.length : 0,
      });
      setCheckedIn((current) => new Set(current).add(student.studentId));
      logAttendanceDiagnostic('selection-confirmed', {
        classId: gymClass.id,
        selectedStudentIds: [...new Set([...checkedInRef.current, student.studentId])],
      });
      await loadSavedAttendance(gymClass.id, students);
    } catch (error) {
      logAttendanceDiagnostic('save-failed', {
        classId: gymClass.id,
        studentId: student.studentId,
        gymId: gymClass.gym_id,
        errorCode: isPostgresUniqueViolation(error) ? '23505' : 'unknown',
      });
      if (isPostgresUniqueViolation(error)) {
        const existingCheckIn = await confirmExistingClassCheckIn(
          () => database.listAttendanceForClassStudent(gymClass.id, student.studentId),
          gymClass.id,
          student.studentId,
        );
        if (existingCheckIn) {
          setCheckedIn((current) => new Set(current).add(student.studentId));
          setCheckInNotice('Already checked in.');
          return;
        }
      }
      setErrorMessage(`Could not check in ${fullName(student)}. Try again.`);
    } finally {
      setCheckingStudentId(null);
    }
  };

  const removeCheckIn = async (student: Student) => {
    if (!gymClass || !isEditingAttendance || !isAttendanceReady || checkingStudentId !== null || !checkedIn.has(student.studentId)) return;
    setCheckingStudentId(student.studentId);
    setErrorMessage(null);
    setCheckInNotice(null);
    try {
      await database.removeAttendanceForClassStudent(gymClass.id, student.studentId);
      setCheckedIn((current) => {
        const next = new Set(current);
        next.delete(student.studentId);
        return next;
      });
      setPendingRemoval(null);
      await loadSavedAttendance(gymClass.id, students);
    } catch {
      setErrorMessage(`Could not remove ${fullName(student)}'s saved attendance. Your gym's attendance permissions may not allow corrections.`);
    } finally {
      setCheckingStudentId(null);
    }
  };

  const endClass = async () => {
    if (!gymClass || !isInProgress || isEnding || isStarting) return;
    setIsEnding(true);
    setErrorMessage(null);
    try {
      await database.updateClass(gymClass.id, { is_active: 'false', status: 'Completed' });
      router.replace('/schedule');
    } catch {
      setErrorMessage('Class could not be ended. Try again.');
      setIsEnding(false);
    }
  };

  if (isLoading) return <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-background"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading live class roster…</Text></SafeAreaView>;

  if (!gymClass || errorMessage && !students.length) return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="px-5 pt-4"><BackButton router={router} /></View><View className="flex-1 items-center justify-center px-8 pb-20"><LucideIcon name="CircleAlert" className="mb-3 h-8 w-8 text-destructive" /><Text className="text-center text-lg font-bold text-foreground">Class unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage ?? 'This scheduled class is no longer available.'}</Text></View></SafeAreaView>;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <FlatList
        data={visibleStudents}
        keyExtractor={(student) => String(student.studentId)}
        contentContainerClassName="px-5 pb-8"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <View className="flex-row items-center justify-between pt-4">
              <BackButton router={router} />
              <Text className="text-lg font-bold text-foreground">{isCompleted ? 'Attendance' : isCancelled ? 'Class cancelled' : 'Class roster'}</Text>
              <View className="h-10 w-10" />
            </View>
            <ClassSummary
              gymClass={gymClass}
              checkedIn={checkedIn.size}
              readOnly={isCompleted || isCancelled}
              isCancelled={isCancelled}
              canEditCompletedClass={canEditCompletedClass}
              canEditCompletedAttendance={canEditCompletedAttendance}
              isEditingAttendance={isEditingAttendance}
            />
            <ClassControls
              isInProgress={isInProgress}
              isCompleted={isCompleted}
              isCancelled={isCancelled}
              isStarting={isStarting}
              isEnding={isEnding}
              canEditCompletedClass={canEditCompletedClass}
              canEditCompletedAttendance={canEditCompletedAttendance}
              isEditingAttendance={isEditingAttendance}
              onEdit={() => router.push(`/classes/${gymClass.id}/edit`)}
              onEditAttendance={() => {
                setErrorMessage(null);
                setCheckInNotice(null);
                setIsEditingCompletedAttendance(true);
              }}
              onFinishAttendanceEditing={() => {
                setPendingRemoval(null);
                setIsEditingCompletedAttendance(false);
              }}
              onStart={startClass}
              onEnd={endClass}
            />
            {isSelfCheckInEnabled() && canManageFamilySelfCheckIn && gymClass.gym_id === 4 && !isCancelled ? <Pressable accessibilityRole="button" accessibilityLabel="Review family check-in requests" onPress={() => router.push(`/classes/${gymClass.id}/family-check-in-requests`)} className="mt-3 min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-card px-4 active:bg-accent"><LucideIcon name="ClipboardCheck" className="h-5 w-5 text-primary" /><Text className="font-bold text-foreground">Family check-in requests</Text></Pressable> : null}
            {isSelfCheckInPreviewEnabled() && canManageFamilySelfCheckIn && gymClass.gym_id === 4 ? <FamilySelfCheckInPreview isCompleted={isCompleted} isCancelled={isCancelled} isInProgress={isInProgress} /> : null}
            {isSelfCheckInPreviewEnabled() && canManageFamilySelfCheckIn && gymClass.gym_id === 4 ? <Pressable accessibilityRole="button" accessibilityLabel="View reusable academy family check-in QR code" onPress={() => router.push('/dev/family-check-in-qr')} className="mt-3 min-h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-card px-4 active:bg-accent"><LucideIcon name="QrCode" className="h-5 w-5 text-primary" /><Text className="font-bold text-foreground">View reusable academy QR</Text></Pressable> : null}
            {errorMessage ? <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/15 px-4 py-3"><LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" /><Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text></View> : null}
            {(isInProgress || isEditingAttendance) && checkInNotice ? <View className="mt-5 flex-row gap-2 rounded-2xl bg-success/15 px-4 py-3"><LucideIcon name="Check" className="mt-0.5 h-5 w-5 text-success" strokeWidth={3} /><Text className="flex-1 text-sm font-medium leading-5 text-foreground">{checkInNotice}</Text></View> : null}
            {pendingRemoval ? <RemovalConfirmation student={pendingRemoval} isPending={checkingStudentId === pendingRemoval.studentId} onCancel={() => setPendingRemoval(null)} onConfirm={() => void removeCheckIn(pendingRemoval)} /> : null}
            {isInProgress ? (
              <><View className="mb-3 mt-7 flex-row items-center justify-between"><Text className="text-xl font-bold text-foreground">Coach roster</Text><Text className="text-sm font-bold text-success">{checkedIn.size} checked in</Text></View>{isAttendanceLoading ? <View className="mb-3 flex-row items-center gap-2 rounded-2xl bg-muted px-4 py-3"><LoadingIndicator /><Text className="flex-1 text-sm text-muted-foreground">Loading saved attendance. Check-ins are paused.</Text></View> : attendanceLoadError ? <AttendanceLoadError onRetry={retrySavedAttendance} /> : null}</>
            ) : isCompleted ? (
              <><View className="mb-3 mt-7 flex-row items-center justify-between"><View><Text className="text-xl font-bold text-foreground">{isEditingAttendance ? 'Edit attendance' : 'Saved attendance'}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{isEditingAttendance ? 'Completed · changes save individually' : 'Completed · Read only'}</Text></View><Text className="text-sm font-bold text-success">{checkedIn.size} checked in</Text></View>{isEditingAttendance ? <Text className="mb-3 text-sm leading-5 text-muted-foreground">Add missed attendees or remove an incorrect saved check-in. The class remains completed, and existing attendance details are not rewritten.</Text> : null}{isAttendanceLoading ? <View className="mb-3 flex-row items-center gap-2 rounded-2xl bg-muted px-4 py-3"><LoadingIndicator /><Text className="text-sm text-muted-foreground">Loading saved attendance…</Text></View> : attendanceLoadError ? <AttendanceLoadError onRetry={retrySavedAttendance} /> : null}</>
            ) : (
              <View className="mt-7 rounded-2xl border border-dashed border-border px-5 py-8"><Text className="text-center font-bold text-foreground">{isCancelled ? 'Cancelled' : 'Ready when you are'}</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{isCancelled ? 'This class is cancelled and remains read only.' : 'Starting this class opens the live student roster for check-in.'}</Text></View>
            )}
          </>
        }
        renderItem={({ item }) => <RosterRow student={item} checkedIn={studentHasSavedCheckIn(item, checkedIn)} readOnly={isCancelled || (isCompleted && !isEditingAttendance)} allowRemoval={isEditingAttendance} disabled={checkingStudentId !== null || !isAttendanceReady || isAttendanceLoading} isChecking={checkingStudentId === item.studentId} onCheckIn={() => checkInStudent(item)} onRemove={() => setPendingRemoval(item)} />}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={isCompleted && !isAttendanceLoading && !attendanceLoadError ? <View className="rounded-2xl border border-dashed border-border px-5 py-8"><Text className="text-center font-bold text-foreground">No saved attendance</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{isEditingAttendance ? 'No students are available for attendance correction.' : 'No students were checked in for this completed class.'}</Text></View> : null}
      />
    </SafeAreaView>
  );
}

function BackButton({ router }: { router: ReturnType<typeof useRouter> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Back to schedule" onPress={() => { if (router.canGoBack()) router.back(); }} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable>;
}

function ClassSummary({ gymClass, checkedIn, readOnly, isCancelled, canEditCompletedClass, canEditCompletedAttendance, isEditingAttendance }: { gymClass: GymClass; checkedIn: number; readOnly: boolean; isCancelled: boolean; canEditCompletedClass: boolean; canEditCompletedAttendance: boolean; isEditingAttendance: boolean }) {
  const classificationAvailable = gymClass.stripe_progress_classification !== undefined;
  const audienceLabel = classAudienceLabel(gymClass.class_audience);
  const completedSummary = isEditingAttendance
    ? 'Attendance correction is active. Each add or removal saves separately; the class stays completed.'
    : canEditCompletedAttendance
      ? 'Staff can correct attendance without reopening the class. Existing attendance remains unchanged unless a check-in is explicitly removed.'
      : canEditCompletedClass
        ? 'Attendance is read only. Administrators may correct class details without reopening the class.'
        : 'This completed class is available for review only. Attendance and class settings cannot be changed here.';

  return <View className="mt-7 overflow-hidden rounded-3xl bg-primary"><View className="h-1 bg-primary-foreground/35" /><View className="p-5"><View className="flex-row items-start justify-between gap-4"><View className="min-w-0 flex-1"><View className="flex-row items-center gap-2"><View className="h-2 w-2 rounded-full bg-primary-foreground" /><Text className="text-xs font-bold uppercase tracking-wide text-primary-foreground/75">{isCancelled ? 'Cancelled class' : readOnly ? 'Completed class' : 'Live class session'}</Text></View><Text numberOfLines={2} className="mt-2 text-2xl font-bold tracking-tight text-primary-foreground">{gymClass.class_name}</Text><Text className="mt-2 text-sm text-primary-foreground/75">{formatClassDate(gymClass.class_date)} · {formatTime(gymClass.start_time)} – {formatTime(gymClass.end_time)}</Text><Text className="mt-1 text-sm text-primary-foreground/75">{gymClass.coach_name ?? 'Coach not assigned'}</Text>{audienceLabel ? <View className="mt-3 self-start rounded-full bg-primary-foreground/15 px-3 py-1"><Text className="text-xs font-bold text-primary-foreground">{audienceLabel}</Text></View> : null}</View><View className="items-center rounded-2xl bg-primary-foreground/15 px-3 py-2"><Text className="text-xl font-bold text-primary-foreground">{checkedIn}</Text><Text className="text-[10px] font-bold uppercase tracking-wide text-primary-foreground/75">checked in</Text></View></View><View className="mt-5 flex-row items-center justify-between border-t border-primary-foreground/20 pt-4"><Text className="text-sm font-semibold text-primary-foreground">{isCancelled ? 'Cancelled · Read only' : readOnly ? 'Completed · Read only' : gymClass.status ?? 'Scheduled'}</Text><Text className="text-sm font-semibold text-primary-foreground">{readOnly ? 'Saved attendance' : 'Attendance is saved per student'}</Text></View>{readOnly ? <Text className="mt-5 border-t border-primary-foreground/20 pt-4 text-sm leading-5 text-primary-foreground/75">{isCancelled ? 'This class is cancelled and cannot be started, checked into, or changed.' : completedSummary}</Text> : classificationAvailable ? <View className="mt-5 border-t border-primary-foreground/20 pt-4"><Text className="text-xs font-bold text-primary-foreground/70">STRIPE PROGRESS CLASSIFICATION</Text><Text className="mt-2 text-sm font-bold capitalize text-primary-foreground">{gymClass.stripe_progress_classification?.replace('_', ' ')}</Text><Text className="mt-2 text-xs leading-4 text-primary-foreground/70">Use Edit class to change this setting. Saved attendance keeps its own classification snapshot.</Text></View> : <Text className="mt-5 border-t border-primary-foreground/20 pt-4 text-sm text-primary-foreground/75">Stripe progress is not enabled yet.</Text>}</View></View>;
}

function AttendanceLoadError({ onRetry }: { onRetry: () => void }) {
  return <View className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3"><View className="flex-row items-center gap-2"><LucideIcon name="CircleAlert" className="h-5 w-5 text-destructive" /><Text className="flex-1 text-sm font-semibold leading-5 text-foreground">Unable to load saved attendance. Check-ins are paused to protect existing records.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Retry loading attendance" onPress={onRetry} className="mt-3 self-start rounded-xl bg-destructive px-4 py-2 active:opacity-80"><Text className="text-sm font-bold text-destructive-foreground">Retry</Text></Pressable></View>;
}

function ClassControls({ isInProgress, isCompleted, isCancelled, isStarting, isEnding, canEditCompletedClass, canEditCompletedAttendance, isEditingAttendance, onEdit, onEditAttendance, onFinishAttendanceEditing, onStart, onEnd }: { isInProgress: boolean; isCompleted: boolean; isCancelled: boolean; isStarting: boolean; isEnding: boolean; canEditCompletedClass: boolean; canEditCompletedAttendance: boolean; isEditingAttendance: boolean; onEdit: () => void; onEditAttendance: () => void; onFinishAttendanceEditing: () => void; onStart: () => void; onEnd: () => void }) {
  if (isCancelled) return null;
  if (isCompleted) return canEditCompletedClass || canEditCompletedAttendance ? <View className="mt-5 gap-3">{canEditCompletedAttendance ? <Pressable accessibilityRole="button" accessibilityLabel={isEditingAttendance ? 'Finish editing attendance' : 'Edit attendance'} onPress={isEditingAttendance ? onFinishAttendanceEditing : onEditAttendance} className="flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 active:opacity-85"><LucideIcon name={isEditingAttendance ? 'Check' : 'Users'} className="h-5 w-5 text-primary-foreground" /><Text className="font-bold text-primary-foreground">{isEditingAttendance ? 'Done editing attendance' : 'Edit attendance'}</Text></Pressable> : null}{canEditCompletedClass ? <Pressable accessibilityRole="button" accessibilityLabel="Edit completed class" onPress={onEdit} className="flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card py-4 active:bg-accent"><LucideIcon name="Pencil" className="h-5 w-5 text-foreground" /><Text className="font-bold text-foreground">Edit class</Text></Pressable> : null}</View> : null;
  if (isInProgress) return <Pressable accessibilityRole="button" accessibilityLabel="End class" disabled={isEnding} onPress={onEnd} className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl bg-destructive py-4 ${isEnding ? 'opacity-60' : ''}`}>{isEnding ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="Square" className="h-5 w-5 text-destructive-foreground" fill="currentColor" />}<Text className="font-bold text-destructive-foreground">{isEnding ? 'Ending class…' : 'End class'}</Text></Pressable>;
  return <View className="mt-5 gap-3"><Pressable accessibilityRole="button" accessibilityLabel="Edit class" onPress={onEdit} className="flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card py-4 active:bg-accent"><LucideIcon name="Pencil" className="h-5 w-5 text-foreground" /><Text className="font-bold text-foreground">Edit class</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Start class" disabled={isStarting} onPress={onStart} className={`flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${isStarting ? 'opacity-60' : ''}`}>{isStarting ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="Play" className="h-5 w-5 text-primary-foreground" fill="currentColor" />}<Text className="font-bold text-primary-foreground">{isStarting ? 'Starting class…' : 'Start class'}</Text></Pressable></View>;
}

function FamilySelfCheckInPreview({ isCompleted, isCancelled, isInProgress }: { isCompleted: boolean; isCancelled: boolean; isInProgress: boolean }) {
  const classCannotAcceptCheckIn = isCompleted || isCancelled;
  const lifecycleLabel = isCancelled
    ? 'Unavailable · Cancelled'
    : isCompleted
      ? 'Unavailable · Completed'
      : isInProgress
        ? 'Preview · In Progress'
        : 'Preview · Scheduled';

  return <View className="mt-5 overflow-hidden rounded-3xl border border-dashed border-primary/40 bg-primary/5">
    <View className="flex-row items-center justify-between border-b border-primary/15 px-5 py-4"><View className="flex-row items-center gap-2"><LucideIcon name="ScanLine" className="h-5 w-5 text-primary" /><Text className="text-base font-bold text-foreground">Family Self-Check-In</Text></View><View className="rounded-full bg-muted px-2.5 py-1"><Text className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Preview only</Text></View></View>
    <View className="p-5"><View className="flex-row items-center gap-2"><View className={`h-2 w-2 rounded-full ${classCannotAcceptCheckIn ? 'bg-muted-foreground' : 'bg-warning'}`} /><Text className="text-sm font-bold text-foreground">{lifecycleLabel}</Text></View><Text className="mt-3 text-sm leading-5 text-muted-foreground">Gym 4 · America/New_York. Families may check in beginning 15 minutes before the scheduled start and while this class is In Progress, only after staff enable the session.</Text>{classCannotAcceptCheckIn ? <Text className="mt-3 text-sm font-semibold leading-5 text-destructive">Completed and Cancelled classes cannot accept family self-check-ins.</Text> : <Text className="mt-3 text-sm leading-5 text-muted-foreground">The server rollout and attendance authorization are not active in this preview.</Text>}<View accessibilityState={{ disabled: true }} className="mt-5 min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-muted px-4 opacity-70"><LucideIcon name="Lock" className="h-5 w-5 text-muted-foreground" /><Text className="font-bold text-muted-foreground">Enable self-check-in unavailable</Text></View><Text className="mt-3 text-center text-xs leading-4 text-muted-foreground">{selfCheckInCapability.reason} {selfCheckInPreviewCapability.reason}</Text></View>
  </View>;
}

function RemovalConfirmation({ student, isPending, onCancel, onConfirm }: { student: Student; isPending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <View className="mt-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4"><Text className="text-base font-bold text-foreground">Remove saved attendance?</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This removes only {fullName(student)}’s check-in from this completed class. It does not reopen the class or change any other attendance record.</Text><View className="mt-4 flex-row gap-3"><Pressable accessibilityRole="button" accessibilityLabel="Cancel attendance removal" disabled={isPending} onPress={onCancel} className={`min-h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card px-3 ${isPending ? 'opacity-60' : 'active:bg-accent'}`}><Text className="text-sm font-bold text-foreground">Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Confirm removal of ${fullName(student)}`} disabled={isPending} onPress={onConfirm} className={`min-h-11 flex-1 items-center justify-center rounded-xl bg-destructive px-3 ${isPending ? 'opacity-60' : 'active:opacity-85'}`}>{isPending ? <LoadingIndicator tone="on-primary" size="small" /> : <Text className="text-sm font-bold text-destructive-foreground">Remove check-in</Text>}</Pressable></View></View>;
}

function RosterRow({ student, checkedIn, readOnly, allowRemoval, disabled, isChecking, onCheckIn, onRemove }: { student: Student; checkedIn: boolean; readOnly: boolean; allowRemoval: boolean; disabled: boolean; isChecking: boolean; onCheckIn: () => void; onRemove: () => void }) {
  return <View className={`min-h-[76px] flex-row items-center rounded-2xl border p-3 ${checkedIn ? 'border-success/30 bg-success/5' : 'border-border bg-card'}`}><MemberAvatar initials={studentInitials(student)} photoUrl={student.photo_url} size="sm" /><View className="ml-3 min-w-0 flex-1"><Text numberOfLines={1} className="text-base font-bold text-card-foreground">{fullName(student)}</Text><Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">{student.belt_rank} · {student.stripes} {student.stripes === 1 ? 'stripe' : 'stripes'}</Text></View>{checkedIn ? allowRemoval ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${fullName(student)} from attendance`} disabled={disabled} onPress={onRemove} className={`min-h-11 items-center justify-center rounded-xl border border-destructive/30 bg-card px-3 ${disabled ? 'opacity-60' : 'active:bg-destructive/10'}`}>{isChecking ? <LoadingIndicator size="small" /> : <Text className="text-xs font-bold text-destructive">Remove</Text>}</Pressable> : <View accessibilityLabel={`${fullName(student)} is checked in`} className="h-11 min-w-11 flex-row items-center justify-center gap-1 rounded-xl bg-success/15 px-3"><LucideIcon name="Check" className="h-4 w-4 text-success" strokeWidth={3} /><Text className="text-xs font-bold text-success">Checked in</Text></View> : readOnly ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Check in ${fullName(student)}`} disabled={disabled} onPress={onCheckIn} className={`min-h-11 min-w-11 items-center justify-center rounded-xl bg-primary px-3 ${disabled ? 'opacity-60' : 'active:opacity-85'}`}>{isChecking ? <LoadingIndicator tone="on-primary" size="small" /> : <Text className="text-xs font-bold text-primary-foreground">Check in</Text>}</Pressable>}</View>;
}
