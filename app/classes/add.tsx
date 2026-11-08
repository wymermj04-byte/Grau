import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { DraftbitRestApiError } from "@/draftbit-api";
import { DatabaseQueryError, database } from "@/lib/database";
import { parseCalendarDateInput } from '@/lib/date';
import { configuredSupabaseProjectReference } from '@/lib/supabase';

const classTypes = ["Fundamentals"] as const;
const classAudiences = ["Kids", "Adults", "Mixed"] as const;
const hours = Array.from({ length: 12 }, (_, index) => index + 1);
const minutes = Array.from({ length: 60 }, (_, index) => index);
const meridiems = ["AM", "PM"] as const;

type GymResolution = "loading" | "resolved" | "none" | "multiple" | "error";
type Meridiem = (typeof meridiems)[number];
type ClassAudience = "kids" | "adults" | "mixed";
type TimeSelection = {
  hour: number | null;
  minute: number | null;
  meridiem: Meridiem | null;
};

const blankTimeSelection: TimeSelection = { hour: null, minute: null, meridiem: null };

type GymSettingsRecord = {
  id: number;
  gym_name?: string | null;
};

export default function CreateClassScreen() {
  const router = useRouter();
  const [className, setClassName] = React.useState("");
  const [coachName, setCoachName] = React.useState("");
  const [classDate, setClassDate] = React.useState("");
  const [startTime, setStartTime] = React.useState<TimeSelection>(blankTimeSelection);
  const [endTime, setEndTime] = React.useState<TimeSelection>(blankTimeSelection);
  const [maxStudents, setMaxStudents] = React.useState("20");
  const [classType, setClassType] = React.useState<(typeof classTypes)[number]>("Fundamentals");
  const [classAudience, setClassAudience] = React.useState<(typeof classAudiences)[number] | null>(null);
  const [notes, setNotes] = React.useState("");
  const [stripeProgressClassification, setStripeProgressClassification] = React.useState<'qualifying' | 'open_mat' | 'non_qualifying'>('qualifying');
  const [activeGymId, setActiveGymId] = React.useState<number | null>(null);
  const [activeGymName, setActiveGymName] = React.useState<string | null>(null);
  const [gymResolution, setGymResolution] = React.useState<GymResolution>("loading");
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const saveLockRef = React.useRef(false);
  const returnTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    },
    [],
  );

  useFocusEffect(
    React.useCallback(() => {
      let isFocused = true;

      const resolveActiveGym = async () => {
        setGymResolution("loading");
        setActiveGymId(null);
        setActiveGymName(null);

        try {
          const gyms = await database.listGymSettings<GymSettingsRecord>();
          if (!isFocused) return;

          if (gyms.length === 1) {
            setActiveGymId(gyms[0].id);
            setActiveGymName(gyms[0].gym_name ?? null);
            setGymResolution("resolved");
          } else {
            setGymResolution(gyms.length === 0 ? "none" : "multiple");
          }
        } catch {
          if (isFocused) setGymResolution("error");
        }
      };

      void resolveActiveGym();

      return () => {
        isFocused = false;
      };
    }, []),
  );

  const normalizedClassName = className.trim();
  const normalizedCoachName = coachName.trim();
  const normalizedDate = classDate.trim();
  const normalizedStartTime = toDatabaseTime(startTime);
  const normalizedEndTime = toDatabaseTime(endTime);
  const normalizedCapacity = maxStudents.trim();
  const databaseClassDate = parseCalendarDateInput(normalizedDate);
  const validDate = databaseClassDate !== null;
  const startMinutes = timeToMinutes(normalizedStartTime);
  const endMinutes = timeToMinutes(normalizedEndTime);
  const validCapacity = isPositiveInteger(normalizedCapacity);
  const timesAreInOrder = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
  const canSave =
    gymResolution === "resolved" &&
    activeGymId !== null &&
    normalizedClassName.length > 0 &&
    normalizedCoachName.length > 0 &&
    classAudience !== null &&
    validDate &&
    timesAreInOrder &&
    validCapacity &&
    !isSaving &&
    !successMessage;

  const saveClass = async () => {
    if (!canSave || activeGymId === null || !normalizedStartTime || !normalizedEndTime || saveLockRef.current) return;

    saveLockRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const classPayload = {
          class_name: normalizedClassName,
          coach_name: normalizedCoachName,
          class_date: `${databaseClassDate}T00:00:00+00:00`,
          start_time: normalizedStartTime,
          end_time: normalizedEndTime,
          max_students: Number(normalizedCapacity),
          class_type: classType,
          class_audience: classAudience.toLowerCase() as ClassAudience,
          notes: notes.trim(),
          is_active: false,
          status: "Scheduled",
          stripe_progress_classification: stripeProgressClassification,
          gym_id: activeGymId,
      };
      let stripeProgressUnavailable = false;
      try {
        await database.createClass(classPayload);
      } catch (error) {
        if (!isStripeProgressUnavailable(error)) throw error;
        stripeProgressUnavailable = true;
        const { stripe_progress_classification: classification, ...legacyPayload } = classPayload;
        void classification;
        await database.createClass(legacyPayload);
      }
      setSuccessMessage(stripeProgressUnavailable ? "Class scheduled. Stripe progress is not enabled yet. Returning to Schedule…" : "Class scheduled. Returning to Schedule…");
      returnTimerRef.current = setTimeout(() => router.replace("/schedule"), 900);
    } catch (error) {
      setErrorMessage(createClassError(error));
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-8"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to schedule"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/schedule");
            }}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Create class</Text>
          <View className="h-10 w-10" />
        </View>

        <View className="mt-7 overflow-hidden rounded-3xl bg-primary p-5">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-2xl font-bold text-primary-foreground">Plan the next session</Text>
              <Text className="mt-2 text-sm leading-5 text-primary-foreground/75">
                Set the details coaches and members will see on the schedule.
              </Text>
            </View>
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-foreground/15">
              <LucideIcon name="CalendarPlus" className="h-5 w-5 text-primary-foreground" />
            </View>
          </View>
        </View>

        <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Class details</Text>
        <View className="rounded-2xl border border-border bg-card p-4">
          <FormField
            label="Class name"
            value={className}
            onChangeText={setClassName}
            placeholder="e.g. Fundamentals"
            autoCapitalize="words"
          />
          <FormField
            label="Coach name"
            value={coachName}
            onChangeText={setCoachName}
            placeholder="Coach name"
            autoCapitalize="words"
          />
          <FormField
            label="Date"
            value={classDate}
            onChangeText={setClassDate}
            placeholder="MM-DD-YY"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View className="mb-5 gap-4">
            <TimeSelector label="Start time" value={startTime} onChange={setStartTime} />
            <TimeSelector label="End time" value={endTime} onChange={setEndTime} />
          </View>
          <FormField
            label="Maximum students"
            value={maxStudents}
            onChangeText={setMaxStudents}
            placeholder="20"
            keyboardType="numeric"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ChoiceField label="Class type" value={classType} options={classTypes} onChange={setClassType} />
          <ChoiceField label="Class audience" value={classAudience} options={classAudiences} onChange={setClassAudience} />
          <ChoiceField
            label="Stripe progress classification"
            value={stripeProgressClassification}
            options={['qualifying', 'open_mat', 'non_qualifying'] as const}
            onChange={setStripeProgressClassification}
          />
          <Text className="-mt-2 mb-5 text-xs leading-4 text-muted-foreground">
            Only qualifying class attendance counts toward stripe progress. Open Mat and non-qualifying attendance remain in history.
          </Text>
          <FormField
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional class notes"
            autoCapitalize="sentences"
            multiline
          />
        </View>

        <View className="mt-7 rounded-2xl border border-tertiary/30 bg-tertiary/10 p-4">
          <View className="flex-row gap-3">
            <LucideIcon name="CalendarDays" className="mt-0.5 h-5 w-5 text-tertiary" />
            <View className="flex-1">
              <Text className="font-bold text-foreground">New classes start Scheduled</Text>
              <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                A class becomes In Progress only when the existing Start Class action is used.
              </Text>
            </View>
          </View>
        </View>

        <GymResolutionNotice resolution={gymResolution} gymId={activeGymId} gymName={activeGymName} />
        {isDevelopmentDiagnosticEnabled ? <ConnectionDiagnostic projectReference={configuredSupabaseProjectReference} /> : null}

        {errorMessage ? (
          <View className="mt-4 flex-row gap-3 rounded-2xl bg-destructive/10 p-4">
            <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" />
            <Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text>
          </View>
        ) : null}
        {successMessage ? (
          <View className="mt-4 flex-row gap-3 rounded-2xl bg-success/10 p-4">
            <LucideIcon name="CircleCheck" className="mt-0.5 h-5 w-5 text-success" />
            <Text className="flex-1 text-sm leading-5 text-foreground">{successMessage}</Text>
          </View>
        ) : null}
        {!canSave && !successMessage ? <ValidationNotice
          gymResolution={gymResolution}
          hasClassName={normalizedClassName.length > 0}
          hasCoachName={normalizedCoachName.length > 0}
          validDate={validDate}
          hasAudience={classAudience !== null}
          hasTimes={startMinutes !== null && endMinutes !== null}
          timesAreInOrder={timesAreInOrder}
          validCapacity={validCapacity}
        /> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save Class"
          accessibilityState={{ disabled: !canSave, busy: isSaving }}
          disabled={!canSave}
          onPress={saveClass}
          className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${canSave ? "" : "opacity-60"}`}
        >
          {isSaving ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="Save" className="h-5 w-5 text-primary-foreground" />}
          <Text className="font-bold text-primary-foreground">{isSaving ? "Scheduling class…" : "Save Class"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function isStripeProgressUnavailable(error: unknown) {
  if (!(error instanceof DatabaseQueryError)) return false;
  return error.code === '42703' || error.code === '42P01' || /stripe_progress_classification|does not exist|schema cache/i.test(error.message);
}

function ValidationNotice({
  gymResolution,
  hasClassName,
  hasCoachName,
  validDate,
  hasAudience,
  hasTimes,
  timesAreInOrder,
  validCapacity,
}: {
  gymResolution: GymResolution;
  hasClassName: boolean;
  hasCoachName: boolean;
  validDate: boolean;
  hasAudience: boolean;
  hasTimes: boolean;
  timesAreInOrder: boolean;
  validCapacity: boolean;
}) {
  const blockers = [
    ...(gymResolution !== "resolved" ? ["Resolve exactly one active gym before saving."] : []),
    ...(!hasClassName ? ["Enter a class name."] : []),
    ...(!hasCoachName ? ["Enter a coach name."] : []),
    ...(!validDate ? ["Enter a real date in MM-DD-YY format."] : []),
    ...(!hasAudience ? ["Choose the class audience."] : []),
    ...(!hasTimes ? ["Select a complete start and end time."] : []),
    ...(hasTimes && !timesAreInOrder ? ["Choose an end time later than the start time."] : []),
    ...(!validCapacity ? ["Enter a positive whole-number maximum-student count."] : []),
  ];

  if (blockers.length === 0) return null;

  return <View className="mt-4 rounded-2xl border border-border bg-muted/35 p-4"><Text className="font-bold text-foreground">Save Class is waiting for:</Text><View className="mt-2 gap-1">{blockers.map((blocker) => <Text key={blocker} className="text-sm leading-5 text-muted-foreground">• {blocker}</Text>)}</View></View>;
}

function GymResolutionNotice({
  resolution,
  gymId,
  gymName,
}: {
  resolution: GymResolution;
  gymId: number | null;
  gymName: string | null;
}) {
  if (resolution === "loading") {
    return (
      <View className="mt-4 flex-row items-center gap-3 rounded-2xl bg-secondary p-4">
        <LoadingIndicator />
        <View className="flex-1">
          <Text className="font-bold text-secondary-foreground">Resolving active gym…</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            Checking the live gym settings for this future class.
          </Text>
        </View>
      </View>
    );
  }

  if (resolution === "resolved" && gymId !== null) {
    return (
      <View className="mt-4 flex-row gap-3 rounded-2xl bg-success/10 p-4">
        <LucideIcon name="Building2" className="mt-0.5 h-5 w-5 text-success" />
        <View className="flex-1">
          <Text className="font-bold text-foreground">Active gym resolved</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            {gymName ? `${gymName} ` : "Gym "}(ID {gymId}) will be used when saving is connected.
          </Text>
          <Text className={`mt-2 text-sm leading-5 ${gymId === 4 ? 'text-success' : 'text-warning'}`}>
            {gymId === 4
              ? 'Staff scope verified: exactly one active gym — Gym 4.'
              : `Staff scope resolved to Gym ${gymId}, not Gym 4.`}
          </Text>
        </View>
      </View>
    );
  }

  const message =
    resolution === "none"
      ? "No gym settings record was returned. A gym must be selected before a class can be saved."
      : resolution === "multiple"
        ? "More than one gym was returned. Authenticated gym selection is required before a class can be saved."
        : "The active gym could not be confirmed. Try again when the gym settings service is available.";

  return (
    <View className="mt-4 flex-row gap-3 rounded-2xl bg-warning/15 p-4">
      <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-warning" />
      <View className="flex-1">
        <Text className="font-bold text-foreground">Gym selection required</Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">{message}</Text>
      </View>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = "sentences",
  autoCorrect = true,
  keyboardType = "default",
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  keyboardType?: "default" | "numeric";
  multiline?: boolean;
}) {
  return (
    <View className="mb-5 last:mb-0">
      <Text className="mb-2 font-bold text-foreground">{label}</Text>
      <ThemedTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        className={`rounded-xl border border-border bg-background px-3.5 py-3 text-base text-foreground ${multiline ? "min-h-[96px]" : ""}`}
      />
    </View>
  );
}

function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <View className="mb-5">
      <Text className="mb-2 font-bold text-foreground">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option}
              onPress={() => onChange(option)}
              className={`rounded-xl px-4 py-3 ${selected ? "bg-primary" : "bg-secondary active:bg-accent"}`}
            >
              <Text className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TimeSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TimeSelection;
  onChange: (value: TimeSelection) => void;
}) {
  const [openPart, setOpenPart] = React.useState<"hour" | "minute" | null>(null);
  const savedTime = toDatabaseTime(value);

  const selectHour = (hour: number) => {
    onChange({ ...value, hour });
    setOpenPart(null);
  };

  const selectMinute = (minute: number) => {
    onChange({ ...value, minute });
    setOpenPart(null);
  };

  return (
    <View>
      <Text className="mb-2 font-bold text-foreground">{label}</Text>
      <View className="rounded-xl border border-border bg-background p-3">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} hour, ${value.hour === null ? "not selected" : value.hour}`}
            accessibilityState={{ expanded: openPart === "hour" }}
            onPress={() => setOpenPart((current) => (current === "hour" ? null : "hour"))}
            className="min-w-[76px] flex-1 flex-row items-center justify-between rounded-lg border border-border bg-card px-3 py-3 active:bg-accent"
          >
            <Text className="font-bold text-foreground">{value.hour === null ? "Hour" : value.hour}</Text>
            <LucideIcon name="ChevronDown" className="h-4 w-4 text-muted-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-muted-foreground">:</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} minute, ${value.minute === null ? "not selected" : value.minute}`}
            accessibilityState={{ expanded: openPart === "minute" }}
            onPress={() => setOpenPart((current) => (current === "minute" ? null : "minute"))}
            className="min-w-[76px] flex-1 flex-row items-center justify-between rounded-lg border border-border bg-card px-3 py-3 active:bg-accent"
          >
            <Text className="font-bold text-foreground">
              {value.minute === null ? "Min" : String(value.minute).padStart(2, "0")}
            </Text>
            <LucideIcon name="ChevronDown" className="h-4 w-4 text-muted-foreground" />
          </Pressable>
          <View accessibilityRole="radiogroup" accessibilityLabel={`${label} AM or PM`} className="flex-row rounded-lg bg-secondary p-1">
            {meridiems.map((meridiem) => {
              const selected = value.meridiem === meridiem;
              return (
                <Pressable
                  key={meridiem}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label} ${meridiem}`}
                  accessibilityState={{ selected }}
                  onPress={() => onChange({ ...value, meridiem })}
                  className={`rounded-md px-2.5 py-2 ${selected ? "bg-primary" : "active:bg-accent"}`}
                >
                  <Text className={`text-xs font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>
                    {meridiem}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {openPart === "hour" ? (
          <View className="mt-3 border-t border-border pt-3">
            <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Select hour</Text>
            <View className="flex-row flex-wrap gap-2">
              {hours.map((hour) => {
                const selected = value.hour === hour;
                return (
                  <Pressable
                    key={hour}
                    accessibilityRole="radio"
                    accessibilityLabel={`Select ${label} hour ${hour}`}
                    accessibilityState={{ selected }}
                    onPress={() => selectHour(hour)}
                    className={`min-w-[44px] items-center rounded-lg px-3 py-2.5 ${selected ? "bg-primary" : "bg-secondary active:bg-accent"}`}
                  >
                    <Text className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>{hour}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {openPart === "minute" ? (
          <View className="mt-3 border-t border-border pt-3">
            <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Select minute</Text>
            <View className="flex-row flex-wrap gap-2">
              {minutes.map((minute) => {
                const selected = value.minute === minute;
                const labelValue = String(minute).padStart(2, "0");
                return (
                  <Pressable
                    key={minute}
                    accessibilityRole="radio"
                    accessibilityLabel={`Select ${label} minute ${labelValue}`}
                    accessibilityState={{ selected }}
                    onPress={() => selectMinute(minute)}
                    className={`min-w-[44px] items-center rounded-lg px-2.5 py-2.5 ${selected ? "bg-primary" : "bg-secondary active:bg-accent"}`}
                  >
                    <Text className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>{labelValue}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
      <Text className="mt-2 text-xs leading-4 text-muted-foreground">
        {savedTime ? `Saves as ${savedTime}.` : "Select an hour, minute, and AM or PM."}
      </Text>
    </View>
  );
}

function toDatabaseTime(value: TimeSelection): string | null {
  if (value.hour === null || value.minute === null || value.meridiem === null) return null;

  const hour =
    value.hour === 12
      ? value.meridiem === "AM"
        ? 0
        : 12
      : value.meridiem === "PM"
        ? value.hour + 12
        : value.hour;

  return `${String(hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}:00`;
}

function timeToMinutes(value: string | null) {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d:00$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isPositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function createClassError(error: unknown) {
  if (error instanceof DatabaseQueryError) {
    const message = error.message.replace(/\s+/g, " ").trim().slice(0, 280);
    const code = error.code?.trim();
    return `${message || "Class could not be scheduled."}${code ? ` (${code})` : ""}`;
  }
  if (error instanceof DraftbitRestApiError) {
    try {
      const response = JSON.parse(error.responseText ?? "") as {
        message?: string;
        details?: string;
      };
      return response.details ?? response.message ?? "Class could not be scheduled. Try again.";
    } catch {
      return `Class could not be scheduled (${error.status}). Try again.`;
    }
  }
  return "Class could not be scheduled. Try again.";
}

const isDevelopmentDiagnosticEnabled = process.env.NODE_ENV === 'development';

function ConnectionDiagnostic({ projectReference }: { projectReference: string }) {
  return <View className="mt-4 rounded-2xl border border-dashed border-border bg-muted/35 p-4"><View className="flex-row gap-3"><LucideIcon name="ShieldCheck" className="mt-0.5 h-5 w-5 text-primary" /><View className="flex-1"><Text className="font-bold text-foreground">Development connection diagnostic</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Configured Supabase project reference: {projectReference}</Text><Text className="mt-1 text-xs leading-4 text-muted-foreground">This shows no API key, access token, session, or account information.</Text></View></View></View>;
}
