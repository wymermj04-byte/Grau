import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { MemberAvatar } from "@/components/gym/MemberAvatar";
import { database } from "@/lib/database";
import {
  fullName,
  loadStudents,
  studentInitials,
  type MemberProgram,
  type Student,
} from "@/lib/students";
import { memberProfilePath } from "@/lib/member-navigation";
import { hasRequiredFirstName, normalizeMemberName } from "@/lib/member-name";
import type { PromotionTrack } from "@/lib/stripe-progress";

const stripeOptions = [0, 1, 2, 3, 4];
const membershipStatuses = ["Active", "Trial", "Paused", "Inactive"] as const;
type MembershipStatus = (typeof membershipStatuses)[number];
const memberPrograms: { value: MemberProgram; label: string }[] = [
  { value: "kids", label: "Kids" },
  { value: "adults", label: "Adults" },
];

export default function EditMemberScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [student, setStudent] = React.useState<Student | null>(null);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [beltRank, setBeltRank] = React.useState("");
  const [stripes, setStripes] = React.useState(0);
  const [membershipStatus, setMembershipStatus] = React.useState<MembershipStatus>("Active");
  const [programs, setPrograms] = React.useState<MemberProgram[]>([]);
  const [promotionTrack, setPromotionTrack] = React.useState<PromotionTrack | null | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isComplete, setIsComplete] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    async function loadStudent() {
      try {
        const result = await loadStudents();
        const foundStudent = result.find((item) => String(item.studentId) === studentId);
        if (isMounted) {
          setStudent(foundStudent ?? null);
          setFirstName(foundStudent?.first_name ?? "");
          setLastName(foundStudent?.last_name ?? "");
          setBeltRank(foundStudent?.belt_rank ?? "");
          setStripes(foundStudent?.stripes ?? 0);
          setMembershipStatus(toMembershipStatus(foundStudent?.membership_status));
          setPrograms(
            (foundStudent?.programs ?? []).filter(
              (program): program is MemberProgram => program === "kids" || program === "adults",
            ),
          );
          setPromotionTrack(foundStudent?.promotion_track);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadStudent();
    return () => {
      isMounted = false;
    };
  }, [studentId]);

  React.useEffect(() => {
    if (!isComplete || !studentId) return;
    const timeout = setTimeout(() => router.dismissTo(memberProfilePath(studentId)), 1400);
    return () => clearTimeout(timeout);
  }, [isComplete, router, studentId]);

  const saveMember = async () => {
    if (!student || !studentId || isSaving || isComplete) return;
    const normalizedFirstName = normalizeMemberName(firstName);
    const normalizedLastName = normalizeMemberName(lastName);
    if (!hasRequiredFirstName(normalizedFirstName)) {
      setErrorMessage("Enter a first name before saving this member.");
      return;
    }
    if (!beltRank.trim()) {
      setErrorMessage("Enter a belt rank before saving this member.");
      return;
    }
    if (promotionTrack !== undefined && !promotionTrack) {
      setErrorMessage("Choose a saved Kids or Adults promotion track.");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const changes: Record<string, string | MemberProgram[] | PromotionTrack | null> = {};
      if (student.first_name !== normalizedFirstName) changes.first_name = normalizedFirstName;
      if ((student.last_name ?? "") !== normalizedLastName) changes.last_name = normalizedLastName;
      if (student.belt_rank !== beltRank.trim()) changes.belt_rank = beltRank.trim();
      if (student.stripes !== stripes) changes.stripes = String(stripes);
      if (student.membership_status !== membershipStatus) changes.membership_status = membershipStatus;
      if (haveProgramsChanged(student, programs)) changes.programs = programs;
      if (promotionTrack !== undefined && student.promotion_track !== promotionTrack) {
        changes.promotion_track = promotionTrack;
      }

      await database.updateStudent(student.studentId, changes);
      setStudent((current) =>
        current
          ? { ...current, first_name: normalizedFirstName, last_name: normalizedLastName, membership_status: membershipStatus }
          : current,
      );
      setIsComplete(true);
    } catch {
      setErrorMessage("Member update could not be saved. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const unchanged =
    student?.first_name === normalizeMemberName(firstName) &&
    (student?.last_name ?? "") === normalizeMemberName(lastName) &&
    student?.belt_rank === beltRank &&
    student?.stripes === stripes &&
    student?.membership_status === membershipStatus &&
    student?.promotion_track === promotionTrack &&
    !haveProgramsChanged(student, programs);

  const trackIsInvalid = promotionTrack !== undefined && !promotionTrack;

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
            accessibilityLabel="Back to member profile"
            onPress={() => router.dismissTo(memberProfilePath(studentId))}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Edit member</Text>
          <View className="h-10 w-10" />
        </View>
        {isLoading ? (
          <View className="items-center py-24">
            <LoadingIndicator />
            <Text className="mt-3 text-sm text-muted-foreground">Loading member…</Text>
          </View>
        ) : null}
        {!isLoading && !student ? (
          <View className="items-center py-24">
            <LucideIcon name="UserRoundX" className="mb-3 h-7 w-7 text-muted-foreground" />
            <Text className="text-lg font-bold text-foreground">Member not found</Text>
          </View>
        ) : null}
        {!isLoading && student && isComplete ? <SuccessState name={fullName(student)} /> : null}
        {!isLoading && student && !isComplete ? (
          <View className="pt-7">
            <MemberSummary student={student} />
            <Text className="mb-3 mt-7 text-xl font-bold text-foreground">Member name</Text>
            <View className="rounded-2xl border border-border bg-card p-4">
              <Text className="mb-2 font-bold text-foreground">First name</Text>
              <ThemedTextInput
                value={firstName}
                onChangeText={(value) => {
                  setFirstName(value);
                  setErrorMessage(null);
                }}
                autoCapitalize="words"
                autoComplete="name-given"
                placeholder="First name"
                className="rounded-xl border border-border bg-background px-3 py-3 text-base text-foreground"
              />
              <Text className="mb-2 mt-5 font-bold text-foreground">Last name</Text>
              <ThemedTextInput
                value={lastName}
                onChangeText={(value) => {
                  setLastName(value);
                  setErrorMessage(null);
                }}
                autoCapitalize="words"
                autoComplete="name-family"
                placeholder="Last name (optional)"
                className="rounded-xl border border-border bg-background px-3 py-3 text-base text-foreground"
              />
              <Text className="mt-3 text-sm leading-5 text-muted-foreground">
                First names are required. Spaces, apostrophes, hyphens, and accented letters are
                supported.
              </Text>
            </View>
            <Text className="mb-3 mt-7 text-xl font-bold text-foreground">Training details</Text>
            <Text className="mb-4 text-sm leading-5 text-muted-foreground">
              Update rank, stripes, and every program this member attends.
            </Text>
            <View className="rounded-2xl border border-border bg-card p-4">
              <MembershipStatusSelector value={membershipStatus} onChange={setMembershipStatus} />
              <Text className="mb-2 font-bold text-foreground">Belt rank</Text>
              <ThemedTextInput
                value={beltRank}
                onChangeText={(value) => {
                  setBeltRank(value);
                  setErrorMessage(null);
                }}
                placeholder="Belt rank"
                className="rounded-xl border border-border bg-background px-3 py-3 text-base text-foreground"
              />
              <Text className="mb-3 mt-6 font-bold text-foreground">Stripes</Text>
              <View className="flex-row gap-2">
                {stripeOptions.map((count) => (
                  <Pressable
                    key={count}
                    accessibilityRole="button"
                    accessibilityState={{ selected: stripes === count }}
                    onPress={() => setStripes(count)}
                    className={`h-11 w-11 items-center justify-center rounded-xl ${stripes === count ? "bg-primary" : "bg-secondary active:bg-accent"}`}
                  >
                    <Text
                      className={`font-bold ${stripes === count ? "text-primary-foreground" : "text-secondary-foreground"}`}
                    >
                      {count}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <ProgramSelector
                programs={programs}
                onToggle={(program) =>
                  setPrograms((current) =>
                    current.includes(program)
                      ? current.filter((value) => value !== program)
                      : [...current, program],
                  )
                }
              />
              {promotionTrack !== undefined ? (
                <PromotionTrackSelector
                  programs={programs}
                  value={promotionTrack}
                  onChange={setPromotionTrack}
                />
              ) : (
                <Text className="mt-5 text-sm leading-5 text-muted-foreground">
                  Stripe progress is not enabled yet.
                </Text>
              )}
            </View>
            <ReadonlyDetails student={student} />
            {errorMessage ? (
              <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/15 px-4 py-3">
                <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" />
                <Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save member"
              disabled={
                !hasRequiredFirstName(firstName) ||
                !beltRank.trim() ||
                unchanged ||
                isSaving ||
                trackIsInvalid
              }
              onPress={saveMember}
              className={`mt-7 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${!hasRequiredFirstName(firstName) || !beltRank.trim() || unchanged || isSaving || trackIsInvalid ? "opacity-60" : ""}`}
            >
              {isSaving ? (
                <LoadingIndicator tone="on-primary" />
              ) : (
                <LucideIcon name="Save" className="h-5 w-5 text-primary-foreground" />
              )}
              <Text className="font-bold text-primary-foreground">
                {isSaving ? "Saving member…" : "Save changes"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PromotionTrackSelector({
  value,
  onChange,
}: {
  programs?: MemberProgram[];
  value: PromotionTrack | null;
  onChange: (track: PromotionTrack) => void;
}) {
  return (
    <View className="mt-6">
      <Text className="mb-2 font-bold text-foreground">Promotion track</Text>
      <Text className="mb-3 text-sm leading-5 text-muted-foreground">
        Choose the saved Kids or Adults track used for stripe requirements. It is independent from
        the classes this member attends.
      </Text>
      <View className="flex-row gap-2">
        {memberPrograms.map(({ value: track, label }) => (
          <Pressable
            key={track}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === track }}
            onPress={() => onChange(track)}
            className={`rounded-xl px-4 py-3 ${value === track ? "bg-primary" : "bg-secondary active:bg-accent"}`}
          >
            <Text
              className={`font-bold ${value === track ? "text-primary-foreground" : "text-secondary-foreground"}`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MembershipStatusSelector({
  value,
  onChange,
}: {
  value: MembershipStatus;
  onChange: (status: MembershipStatus) => void;
}) {
  return (
    <View className="mb-6">
      <Text className="mb-2 font-bold text-foreground">Membership status</Text>
      <Text className="mb-3 text-sm leading-5 text-muted-foreground">
        Paused and inactive members remain in the roster and keep their history.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {membershipStatuses.map((status) => {
          const selected = value === status;
          return (
            <Pressable
              key={status}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${status} membership status`}
              onPress={() => onChange(status)}
              className={`min-h-11 rounded-xl px-4 py-2.5 ${selected ? "bg-primary" : "bg-secondary active:bg-accent"}`}
            >
              <Text className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>
                {status}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ProgramSelector({
  programs,
  onToggle,
}: {
  programs: MemberProgram[];
  onToggle: (program: MemberProgram) => void;
}) {
  return (
    <View className="mt-6">
      <Text className="mb-2 font-bold text-foreground">Programs</Text>
      <Text className="mb-3 text-sm leading-5 text-muted-foreground">
        Choose every program this member attends.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {memberPrograms.map(({ value, label }) => {
          const selected = programs.includes(value);
          return (
            <Pressable
              key={value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label} program`}
              onPress={() => onToggle(value)}
              className={`min-h-11 flex-row items-center gap-2 rounded-xl border px-4 py-2.5 ${selected ? "border-primary bg-primary" : "border-border bg-secondary active:bg-accent"}`}
            >
              <View
                className={`h-5 w-5 items-center justify-center rounded-md border ${selected ? "border-primary-foreground bg-primary-foreground/15" : "border-border bg-card"}`}
              >
                {selected ? (
                  <LucideIcon
                    name="Check"
                    className="h-3.5 w-3.5 text-primary-foreground"
                    strokeWidth={3}
                  />
                ) : null}
              </View>
              <Text
                className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MemberSummary({ student }: { student: Student }) {
  return (
    <View className="rounded-3xl bg-primary p-5">
      <View className="flex-row items-center">
        <MemberAvatar initials={studentInitials(student)} photoUrl={student.photo_url} size="md" />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-semibold text-primary-foreground/70">EDITING MEMBER</Text>
          <Text className="mt-1 text-2xl font-bold text-primary-foreground">
            {fullName(student)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ReadonlyDetails({ student }: { student: Student }) {
  return (
    <View className="mt-7">
      <Text className="mb-3 text-xl font-bold text-foreground">Member details</Text>
      <View className="rounded-2xl border border-border bg-card px-4">
        <ReadonlyRow label="First name" value={student.first_name} />
        <ReadonlyRow label="Last name" value={student.last_name ?? "—"} />
        <ReadonlyRow label="Waiver" value={student.waiver_signed ? "Signed" : "Pending"} last />
      </View>
    </View>
  );
}

function toMembershipStatus(value: string | null | undefined): MembershipStatus {
  return membershipStatuses.includes(value as MembershipStatus) ? (value as MembershipStatus) : "Active";
}

function haveProgramsChanged(student: Student | null, programs: MemberProgram[]) {
  const savedPrograms = (student?.programs ?? []).filter(
    (program): program is MemberProgram => program === "kids" || program === "adults",
  );
  return memberPrograms.some(({ value }) => savedPrograms.includes(value) !== programs.includes(value));
}

function ReadonlyRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View className={`flex-row items-center py-4 ${last ? "" : "border-b border-border"}`}>
      <Text className="flex-1 font-medium text-muted-foreground">{label}</Text>
      <Text className="max-w-[55%] text-right font-bold text-foreground">{value}</Text>
    </View>
  );
}

function SuccessState({ name }: { name: string }) {
  return (
    <View className="items-center pt-24">
      <View className="h-16 w-16 items-center justify-center rounded-3xl bg-success">
        <LucideIcon name="Check" className="h-8 w-8 text-success-foreground" strokeWidth={3} />
      </View>
      <Text className="mt-5 text-2xl font-bold text-foreground">Member updated</Text>
      <Text className="mt-3 max-w-[290px] text-center text-sm leading-5 text-muted-foreground">
        {name}’s changes have been saved.
      </Text>
      <Text className="mt-6 text-xs text-muted-foreground">Refreshing member profile…</Text>
    </View>
  );
}
