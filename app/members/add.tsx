import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { DraftbitRestApiError } from "@/draftbit-api";
import { database } from "@/lib/database";
import LucideIcon from "@/lib/icons/LucideIcon";

const beltRanks = ["White", "Grey", "Grey/White", "Blue", "White Belt"] as const;
const membershipStatuses = ["Active", "Trial", "Paused", "Inactive"] as const;
const stripeOptions = [0, 1, 2, 3, 4] as const;
const memberPrograms = ["kids", "adults"] as const;

type GymResolution = "loading" | "resolved" | "none" | "multiple" | "error";

type GymSettingsRecord = {
  id: number;
  gym_name?: string | null;
};

export default function AddStudentScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [beltRank, setBeltRank] = React.useState<(typeof beltRanks)[number]>("White");
  const [stripes, setStripes] = React.useState<(typeof stripeOptions)[number]>(0);
  const [membershipStatus, setMembershipStatus] =
    React.useState<(typeof membershipStatuses)[number]>("Active");
  const [programs, setPrograms] = React.useState<(typeof memberPrograms)[number][]>([]);
  const [waiverSigned, setWaiverSigned] = React.useState(false);
  const [photoUrl, setPhotoUrl] = React.useState("");
  const [activeGymId, setActiveGymId] = React.useState<number | null>(null);
  const [activeGymName, setActiveGymName] = React.useState<string | null>(null);
  const [gymResolution, setGymResolution] = React.useState<GymResolution>("loading");
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const returnTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = React.useRef(false);

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

  const firstNameValue = firstName.trim();
  const canSave =
    gymResolution === "resolved" &&
    activeGymId !== null &&
    firstNameValue.length > 0 &&
    !isSaving &&
    !successMessage;

  const saveStudent = async () => {
    if (!canSave || activeGymId === null || isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await database.createStudent({
          first_name: firstNameValue,
          last_name: lastName.trim(),
          belt_rank: beltRank,
          stripes,
          membership_status: membershipStatus,
          programs,
          waiver_signed: waiverSigned,
          photo_url: photoUrl.trim(),
          gym_id: activeGymId,
      });
      setSuccessMessage("Student saved. Returning to Members…");
      returnTimerRef.current = setTimeout(() => router.replace("/members"), 900);
    } catch (error) {
      setErrorMessage(createStudentError(error));
    } finally {
      isSavingRef.current = false;
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
            accessibilityLabel="Back to members"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/members");
            }}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Add student</Text>
          <View className="h-10 w-10" />
        </View>
        <View className="mt-7 overflow-hidden rounded-3xl bg-primary p-5">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-2xl font-bold text-primary-foreground">
                Build the student profile
              </Text>
              <Text className="mt-2 text-sm leading-5 text-primary-foreground/75">
                Start with the details a coach needs on the mat.
              </Text>
            </View>
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-foreground/15">
              <LucideIcon name="UserRoundPlus" className="h-5 w-5 text-primary-foreground" />
            </View>
          </View>
        </View>
        <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">
          Student details
        </Text>
        <View className="rounded-2xl border border-border bg-card p-4">
          <FormField
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Required"
            autoCapitalize="words"
            required
          />
          <FormField
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Optional"
            autoCapitalize="words"
          />
          <FormField
            label="Profile photo"
            value={photoUrl}
            onChangeText={setPhotoUrl}
            placeholder="Optional photo URL"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">
          Training details
        </Text>
        <View className="rounded-2xl border border-border bg-card p-4">
          <ChoiceField
            label="Belt rank"
            value={beltRank}
            options={beltRanks}
            onChange={setBeltRank}
          />
          <Text className="mb-2 mt-6 font-bold text-foreground">Stripes</Text>
          <View className="flex-row gap-2">
            {stripeOptions.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: stripes === option }}
                accessibilityLabel={`${option} stripes`}
                onPress={() => setStripes(option)}
                className={`h-11 w-11 items-center justify-center rounded-xl ${stripes === option ? "bg-primary" : "bg-secondary active:bg-accent"}`}
              >
                <Text
                  className={`font-bold ${stripes === option ? "text-primary-foreground" : "text-secondary-foreground"}`}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
          <ChoiceField
            label="Membership status"
            value={membershipStatus}
            options={membershipStatuses}
            onChange={setMembershipStatus}
          />
          <ProgramSelector programs={programs} onChange={setPrograms} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: waiverSigned }}
            accessibilityLabel="Waiver signed"
            onPress={() => setWaiverSigned((current) => !current)}
            className={`mt-6 flex-row items-center rounded-2xl border px-4 py-3.5 ${waiverSigned ? "border-success/40 bg-success/10" : "border-border bg-background active:bg-accent"}`}
          >
            <View
              className={`h-6 w-6 items-center justify-center rounded-lg border ${waiverSigned ? "border-success bg-success" : "border-border bg-card"}`}
            >
              {waiverSigned ? (
                <LucideIcon
                  name="Check"
                  className="h-4 w-4 text-primary-foreground"
                  strokeWidth={3}
                />
              ) : null}
            </View>
            <View className="ml-3 flex-1">
              <Text className="font-bold text-foreground">Waiver signed</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Mark when the student’s waiver is complete.
              </Text>
            </View>
          </Pressable>
        </View>
        <View className="mt-7 rounded-2xl border border-dashed border-tertiary/40 bg-tertiary/10 p-4">
          <View className="flex-row gap-3">
            <LucideIcon name="Info" className="mt-0.5 h-5 w-5 text-tertiary" />
            <View className="flex-1">
              <Text className="font-bold text-foreground">Student creation</Text>
              <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                Saving creates one live student record using the resolved gym and the details above.
              </Text>
            </View>
          </View>
        </View>
        <GymResolutionNotice
          resolution={gymResolution}
          gymId={activeGymId}
          gymName={activeGymName}
        />
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
        {!firstNameValue ? (
          <Text className="mt-4 text-sm text-muted-foreground">
            First name is required to save.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save Student"
          accessibilityState={{ disabled: !canSave, busy: isSaving }}
          disabled={!canSave}
          onPress={saveStudent}
          className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${canSave ? "" : "opacity-60"}`}
        >
          {isSaving ? (
            <LoadingIndicator tone="on-primary" />
          ) : (
            <LucideIcon name="Save" className="h-5 w-5 text-primary-foreground" />
          )}
          <Text className="font-bold text-primary-foreground">
            {isSaving ? "Saving student…" : "Save Student"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProgramSelector({
  programs,
  onChange,
}: {
  programs: (typeof memberPrograms)[number][];
  onChange: React.Dispatch<React.SetStateAction<(typeof memberPrograms)[number][]>>;
}) {
  const toggleProgram = (program: (typeof memberPrograms)[number]) => {
    onChange((current) => current.includes(program) ? current.filter((value) => value !== program) : [...current, program]);
  };

  return (
    <View className="mt-6">
      <Text className="mb-2 font-bold text-foreground">Programs</Text>
      <Text className="mb-3 text-sm leading-5 text-muted-foreground">Choose every program this member attends.</Text>
      <View className="flex-row flex-wrap gap-2">
        {memberPrograms.map((program) => {
          const selected = programs.includes(program);
          const label = program === "kids" ? "Kids" : "Adults";
          return <Pressable key={program} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${label} program`} onPress={() => toggleProgram(program)} className={`min-h-11 flex-row items-center gap-2 rounded-xl border px-4 py-2.5 ${selected ? "border-primary bg-primary" : "border-border bg-secondary active:bg-accent"}`}><View className={`h-5 w-5 items-center justify-center rounded-md border ${selected ? "border-primary-foreground bg-primary-foreground/15" : "border-border bg-card"}`}>{selected ? <LucideIcon name="Check" className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} /> : null}</View><Text className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>{label}</Text></Pressable>;
        })}
      </View>
    </View>
  );
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
            Checking the live gym settings before a future save can be enabled.
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
            {gymName ? `${gymName} ` : "Gym "}(ID {gymId}) is selected for this student.
          </Text>
        </View>
      </View>
    );
  }

  const message =
    resolution === "none"
      ? "No gym settings record was returned. A gym must be selected before students can be saved."
      : resolution === "multiple"
        ? "More than one gym was returned. Authenticated gym selection is required before students can be saved."
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

function createStudentError(error: unknown) {
  if (error instanceof DraftbitRestApiError) {
    try {
      const response = JSON.parse(error.responseText ?? "") as {
        message?: string;
        details?: string;
      };
      if (response.message) return `Student could not be saved: ${response.message}`;
      if (response.details) return `Student could not be saved: ${response.details}`;
    } catch {
      // The endpoint did not return a JSON error body.
    }
    return `Student could not be saved (HTTP ${error.status}). Try again.`;
  }
  return error instanceof Error && error.message
    ? `Student could not be saved: ${error.message}`
    : "Student could not be saved. Try again.";
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  required = false,
  ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  required?: boolean;
  autoCapitalize?: "none" | "words";
  autoCorrect?: boolean;
}) {
  return (
    <View className="mt-5">
      <Text className="mb-2 font-bold text-foreground">
        {label}
        {required ? <Text className="text-tertiary"> *</Text> : null}
      </Text>
      <View className="rounded-xl border border-border bg-background px-3 py-3">
        <ThemedTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          className="text-base text-foreground"
          {...inputProps}
        />
      </View>
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
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <View className="mt-6">
      <Text className="mb-2 font-bold text-foreground">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: value === option }}
            onPress={() => onChange(option)}
            className={`rounded-xl px-3.5 py-2.5 ${value === option ? "bg-primary" : "bg-secondary active:bg-accent"}`}
          >
            <Text
              className={`text-sm font-bold ${value === option ? "text-primary-foreground" : "text-secondary-foreground"}`}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
