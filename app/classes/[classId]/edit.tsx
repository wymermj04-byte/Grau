import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { ThemedTextInput } from '@/components/ui/themed-text-input';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import LucideIcon from '@/lib/icons/LucideIcon';
import { database, resolveActiveGymMembership } from '@/lib/database';
import { parseCalendarDateInput } from '@/lib/date';

type Classification = 'qualifying' | 'open_mat' | 'non_qualifying';
type Audience = 'kids' | 'adults' | 'mixed';

type GymClass = {
  id: number;
  gym_id: number | null;
  class_name: string | null;
  class_date: string | null;
  start_time: string | null;
  end_time: string | null;
  coach_name: string | null;
  status: string | null;
  class_type: string | null;
  class_audience: string | null;
  is_active: boolean | null;
  stripe_progress_classification?: Classification | null;
};

type AttendanceRecord = { class_id: number | string | null };

type EditableStatus = 'Scheduled' | 'Cancelled' | 'Completed';

type SavePayload = {
  class_name: string;
  class_date: string;
  start_time: string;
  end_time: string;
  coach_name: string;
  status: EditableStatus;
  class_type: string;
  class_audience: Audience;
  stripe_progress_classification: Classification;
};

const audiences: ReadonlyArray<{ label: string; value: Audience }> = [
  { label: 'Kids', value: 'kids' },
  { label: 'Adults', value: 'adults' },
  { label: 'Mixed', value: 'mixed' },
];

const classifications: readonly Classification[] = ['qualifying', 'open_mat', 'non_qualifying'];

export default function EditClassScreen() {
  const router = useRouter();
  const { classId } = useLocalSearchParams<{ classId?: string }>();
  const [original, setOriginal] = React.useState<GymClass | null>(null);
  const [className, setClassName] = React.useState('');
  const [classDate, setClassDate] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [coachName, setCoachName] = React.useState('');
  const [status, setStatus] = React.useState<EditableStatus>('Scheduled');
  const [classType, setClassType] = React.useState('');
  const [audience, setAudience] = React.useState<Audience | null>(null);
  const [classification, setClassification] = React.useState<Classification | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [pendingSave, setPendingSave] = React.useState<{ payload: SavePayload; hasAttendance: boolean } | null>(null);
  const returnTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [classes, membership] = await Promise.all([
          database.listClasses<GymClass>(),
          resolveActiveGymMembership(),
        ]);
        const found = classes.find((item) => String(item.id) === classId) ?? null;
        if (!mounted) return;
        if (!found) {
          setErrorMessage('This class is not available in your active gym.');
          return;
        }
        if (!canEditClass(found, membership.role)) {
          setOriginal(found);
          setErrorMessage(
            isCompletedClass(found)
              ? 'Only active gym administrators may edit completed classes. Attendance remains read only.'
              : 'Only scheduled classes can be edited. In Progress and Cancelled classes remain read only.',
          );
          return;
        }
        if (!hasUsableClassDetails(found)) {
          setOriginal(found);
          setErrorMessage('This class has incomplete historical scheduling details and cannot be edited safely.');
          return;
        }
        setOriginal(found);
        setClassName(found.class_name ?? '');
        setClassDate(toCalendarInput(found.class_date));
        setStartTime(normalizeDatabaseTime(found.start_time));
        setEndTime(normalizeDatabaseTime(found.end_time));
        setCoachName(found.coach_name?.trim() ?? '');
        setStatus(isCompletedClass(found) ? 'Completed' : 'Scheduled');
        setClassType(found.class_type ?? '');
        setAudience(normalizeAudience(found.class_audience));
        setClassification(found.stripe_progress_classification ?? null);
      } catch {
        if (mounted) setErrorMessage('Class details could not be loaded. Try again later.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [classId]);

  const payload = buildPayload({ className, classDate, startTime, endTime, coachName, status, classType, audience, classification });
  const canSave = original !== null && payload !== null && !isSaving && !successMessage;

  const requestSave = async () => {
    if (!original || !payload || isSaving) return;
    setErrorMessage(null);

    const requiresPromotionWarning = promotionSensitiveChange(original, payload);
    if (!requiresPromotionWarning) {
      await save(payload);
      return;
    }

    try {
      const attendance = await database.listAttendance<AttendanceRecord>();
      const hasAttendance = attendance.some((record) => String(record.class_id) === String(original.id));
      setPendingSave({ payload, hasAttendance });
    } catch {
      setErrorMessage('Saved attendance could not be checked. This class was not changed. Try again before saving schedule or stripe-progress changes.');
    }
  };

  const save = async (nextPayload: SavePayload) => {
    if (!original || isSaving) return;
    setPendingSave(null);
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await database.updateClass(original.id, nextPayload);
      setSuccessMessage('Class updated. Returning to the refreshed class details…');
      returnTimerRef.current = setTimeout(() => router.replace(`/classes/${original.id}`), 700);
    } catch {
      setErrorMessage('The class could not be updated. No attendance or student records were changed.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-background"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading class details…</Text></SafeAreaView>;
  }

  if (!original || errorMessage?.includes('cannot be edited safely') || errorMessage?.includes('Only scheduled') || errorMessage?.includes('Only active gym administrators') || errorMessage?.includes('not available')) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="px-5 pt-4"><BackButton router={router} /></View><View className="flex-1 items-center justify-center px-8 pb-20"><LucideIcon name="CircleAlert" className="mb-3 h-8 w-8 text-destructive" /><Text className="text-center text-lg font-bold text-foreground">Class cannot be edited</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage ?? 'This class is unavailable.'}</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between pt-4"><BackButton router={router} /><Text className="text-lg font-bold text-foreground">Edit class</Text><View className="h-10 w-10" /></View>

        <View className="mt-7 rounded-3xl bg-primary p-5"><Text className="text-2xl font-bold text-primary-foreground">Update this session</Text><Text className="mt-2 text-sm leading-5 text-primary-foreground/75">This updates class #{original.id}; it never creates a replacement class or changes attendance.</Text>{status === 'Completed' ? <Text className="mt-3 text-sm font-semibold leading-5 text-primary-foreground">Completed status is preserved. This editor cannot reopen the class or restart attendance.</Text> : null}</View>

        <View className="mt-7 rounded-2xl border border-border bg-card p-4">
          <FormField label="Class name" value={className} onChangeText={setClassName} placeholder="Class name" autoCapitalize="words" />
          <FormField label="Coach name" value={coachName} onChangeText={setCoachName} placeholder="Coach name" autoCapitalize="words" />
          <FormField label="Date" value={classDate} onChangeText={setClassDate} placeholder="MM-DD-YY" autoCapitalize="none" />
          <View className="mb-5"><Text className="mb-2 font-bold text-foreground">Start time</Text><ThemedTextInput value={startTime} onChangeText={setStartTime} placeholder="HH:MM, 24-hour" autoCapitalize="none" autoCorrect={false} className="rounded-xl border border-border bg-background px-3.5 py-3 text-base text-foreground" /><Text className="mt-2 text-xs text-muted-foreground">Required for ordinary scheduled and completed classes. Saves as local gym time.</Text></View>
          <View className="mb-5"><Text className="mb-2 font-bold text-foreground">End time</Text><ThemedTextInput value={endTime} onChangeText={setEndTime} placeholder="HH:MM, 24-hour" autoCapitalize="none" autoCorrect={false} className="rounded-xl border border-border bg-background px-3.5 py-3 text-base text-foreground" /></View>
          <FormField label="Class type" value={classType} onChangeText={setClassType} placeholder="e.g. Fundamentals" autoCapitalize="words" />
          <ChoiceField label="Audience" value={audience} options={audiences} onChange={setAudience} />
          <ChoiceField label="Stripe progress classification" value={classification} options={classifications.map((value) => ({ label: value.replace('_', ' '), value }))} onChange={setClassification} />
          <Text className="-mt-2 mb-5 text-xs leading-4 text-muted-foreground">Changing this class setting does not rewrite saved attendance classifications.</Text>
          {status === 'Completed' ? <ReadOnlyStatus /> : <ChoiceField label="Status" value={status} options={[{ label: 'Scheduled', value: 'Scheduled' }, { label: 'Cancelled', value: 'Cancelled' }]} onChange={setStatus} />}
        </View>

        {errorMessage ? <Notice tone="error" message={errorMessage} /> : null}
        {successMessage ? <Notice tone="success" message={successMessage} /> : null}
        {!canSave && !successMessage ? <Text className="mt-4 text-sm text-muted-foreground">Enter a valid date, complete 24-hour start and end times, a class name, coach, type, audience, and stripe-progress classification. End time must be later than start time.</Text> : null}

        {pendingSave ? <ConfirmationCard hasAttendance={pendingSave.hasAttendance} onCancel={() => setPendingSave(null)} onConfirm={() => void save(pendingSave.payload)} disabled={isSaving} /> : <Pressable accessibilityRole="button" accessibilityLabel="Review class changes" accessibilityState={{ disabled: !canSave, busy: isSaving }} disabled={!canSave} onPress={() => void requestSave()} className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${canSave ? '' : 'opacity-60'}`}>{isSaving ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="Save" className="h-5 w-5 text-primary-foreground" />}<Text className="font-bold text-primary-foreground">Save class changes</Text></Pressable>}
      </ScrollView>
    </SafeAreaView>
  );
}

function hasUsableClassDetails(gymClass: GymClass) {
  return typeof gymClass.class_name === 'string'
    && typeof gymClass.class_date === 'string'
    && typeof gymClass.start_time === 'string'
    && typeof gymClass.end_time === 'string'
    && typeof gymClass.class_type === 'string'
    && normalizeAudience(gymClass.class_audience) !== null
    && gymClass.stripe_progress_classification !== undefined
    && gymClass.stripe_progress_classification !== null;
}

function isCompletedClass(gymClass: GymClass) {
  return gymClass.status?.trim().toLowerCase() === 'completed';
}

function canEditClass(gymClass: GymClass, role: unknown) {
  if (gymClass.is_active === true) return false;
  if (gymClass.status?.trim().toLowerCase() === 'scheduled') return role === 'admin' || role === 'coach';
  return isCompletedClass(gymClass) && role === 'admin';
}

function buildPayload(input: { className: string; classDate: string; startTime: string; endTime: string; coachName: string; status: EditableStatus; classType: string; audience: Audience | null; classification: Classification | null }): SavePayload | null {
  const date = parseCalendarDateInput(input.classDate.trim());
  const start = normalizeDatabaseTime(input.startTime);
  const end = normalizeDatabaseTime(input.endTime);
  if (!date || !start || !end || timeToMinutes(end) <= timeToMinutes(start) || !input.className.trim() || !input.coachName.trim() || !input.classType.trim() || !input.audience || !input.classification) return null;
  return { class_name: input.className.trim(), class_date: `${date}T00:00:00+00:00`, start_time: start, end_time: end, coach_name: input.coachName.trim(), status: input.status, class_type: input.classType.trim(), class_audience: input.audience, stripe_progress_classification: input.classification };
}

function promotionSensitiveChange(original: GymClass, payload: SavePayload) {
  return original.class_date !== payload.class_date || normalizeDatabaseTime(original.start_time) !== payload.start_time || original.stripe_progress_classification !== payload.stripe_progress_classification;
}

function normalizeDatabaseTime(value: string | null | undefined) {
  const match = typeof value === 'string' ? /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.exec(value.trim()) : null;
  return match ? match[0] : '';
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeAudience(value: string | null | undefined): Audience | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'kids' || normalized === 'adults' || normalized === 'mixed' ? normalized : null;
}

function toCalendarInput(value: string | null) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[2]}-${match[3]}-${match[1].slice(-2)}` : '';
}

function BackButton({ router }: { router: ReturnType<typeof useRouter> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Back to class" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/schedule'); }} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable>;
}

function FormField({ label, value, onChangeText, placeholder, autoCapitalize = 'sentences' }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; autoCapitalize?: 'none' | 'sentences' | 'words' }) {
  return <View className="mb-5"><Text className="mb-2 font-bold text-foreground">{label}</Text><ThemedTextInput value={value} onChangeText={onChangeText} placeholder={placeholder} autoCapitalize={autoCapitalize} className="rounded-xl border border-border bg-background px-3.5 py-3 text-base text-foreground" /></View>;
}

function ChoiceField<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: ReadonlyArray<{ label: string; value: T }>; onChange: (value: T) => void }) {
  return <View className="mb-5"><Text className="mb-2 font-bold text-foreground">{label}</Text><View className="flex-row flex-wrap gap-2">{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} className={`rounded-xl px-4 py-3 ${value === option.value ? 'bg-primary' : 'bg-secondary active:bg-accent'}`}><Text className={`font-bold ${value === option.value ? 'text-primary-foreground' : 'text-secondary-foreground'}`}>{option.label}</Text></Pressable>)}</View></View>;
}

function ReadOnlyStatus() {
  return <View className="mb-5"><Text className="mb-2 font-bold text-foreground">Status</Text><View className="self-start rounded-xl bg-success/15 px-4 py-3"><Text className="font-bold text-success">Completed</Text></View><Text className="mt-2 text-xs leading-4 text-muted-foreground">Completed status is retained; class lifecycle controls are unavailable here.</Text></View>;
}

function ConfirmationCard({ hasAttendance, onCancel, onConfirm, disabled }: { hasAttendance: boolean; onCancel: () => void; onConfirm: () => void; disabled: boolean }) {
  return <View className={`mt-5 rounded-2xl border p-4 ${hasAttendance ? 'border-destructive/30 bg-destructive/10' : 'border-warning/30 bg-warning/10'}`}><View className="flex-row gap-3"><LucideIcon name="TriangleAlert" className={`mt-0.5 h-5 w-5 ${hasAttendance ? 'text-destructive' : 'text-warning'}`} /><View className="flex-1"><Text className="font-bold text-foreground">{hasAttendance ? 'Existing attendance and promotion context may be affected' : 'Review promotion-sensitive changes'}</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">{hasAttendance ? 'This class already has saved attendance. Changing its date or start time can change timestamp-based promotion-boundary calculations; changing its classification can affect future progress reads. Attendance snapshots, promotion records, and historical boundaries will not be changed automatically.' : 'Changing the date, start time, or stripe-progress classification can affect promotion calculations. No attendance was found for this class.'}</Text></View></View><View className="mt-4 flex-row gap-3"><Pressable accessibilityRole="button" disabled={disabled} onPress={onCancel} className="flex-1 items-center rounded-xl border border-border bg-card py-3"><Text className="font-bold text-foreground">Cancel</Text></Pressable><Pressable accessibilityRole="button" disabled={disabled} onPress={onConfirm} className={`flex-1 items-center rounded-xl bg-primary py-3 ${disabled ? 'opacity-60' : ''}`}><Text className="font-bold text-primary-foreground">Confirm changes</Text></Pressable></View></View>;
}

function Notice({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return <View className={`mt-4 flex-row gap-3 rounded-2xl p-4 ${isError ? 'bg-destructive/10' : 'bg-success/10'}`}><LucideIcon name={isError ? 'CircleAlert' : 'CircleCheck'} className={`mt-0.5 h-5 w-5 ${isError ? 'text-destructive' : 'text-success'}`} /><Text className="flex-1 text-sm leading-5 text-foreground">{message}</Text></View>;
}
