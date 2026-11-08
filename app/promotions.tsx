import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import LucideIcon from "@/lib/icons/LucideIcon";
import { MemberAvatar } from "@/components/gym/MemberAvatar";
import { database } from "@/lib/database";
import {
  calculateStripeProgress,
  type ClassContractException,
  type HistoricalPromotionBoundary,
  type ProgressAttendance,
  type ProgressBaseline,
  type ProgressClass,
  type ProgressPromotion,
} from "@/lib/stripe-progress";
import { fullName, isActiveStudent, studentInitials, type Student } from "@/lib/students";

type ReviewCandidate = {
  student: Student;
  counted: number;
  required: number;
  isNextBeltProgress: boolean;
};

type ReviewAttendance = ProgressAttendance & {
  student_id?: number | string | null;
};

export default function PromotionsScreen() {
  const router = useRouter();
  const [candidates, setCandidates] = React.useState<ReviewCandidate[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isEnabled, setIsEnabled] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      setIsLoading(true);
      setErrorMessage(null);
      Promise.all([
        database.listStudents<Student>(),
        database.listAttendance<ReviewAttendance>(),
        database.listPromotions<ProgressPromotion>(),
        database.listStripeProgressBaselines<ProgressBaseline>(),
        database.getGymStripeProgressContext<StripeProgressContext>(),
      ])
        .then(([students, attendance, promotions, baselines, context]) => {
          if (!active) return;
          if (context.class_contract_exceptions.length > 0) {
            setIsEnabled(false);
            setErrorMessage(
              `${context.class_contract_exceptions.length} scheduled class record${context.class_contract_exceptions.length === 1 ? "" : "s"} does not use the verified calendar-day contract. Review those records before promotion progress can be calculated.`,
            );
            return;
          }
          const nextCandidates = students.filter(isActiveStudent).flatMap((student) => {
            const progress = calculateStripeProgress(
              student,
              filterReviewAttendanceForStudent(attendance, student.studentId),
              promotions.filter((promotion) => promotion.student_id === student.studentId),
              baselines.filter((baseline) => baseline.student_id === student.studentId),
              {
                classes: context.classes,
                historicalBoundaries: context.historical_boundaries.filter(
                  (boundary) => boundary.student_id === student.studentId,
                ),
              },
            );
            return progress.state === "ready" && progress.met
              ? [
                  {
                    student,
                    counted: progress.counted,
                    required: progress.required,
                    isNextBeltProgress: student.stripes >= 4,
                  },
                ]
              : [];
          });
          setCandidates(
            nextCandidates.sort((a, b) => fullName(a.student).localeCompare(fullName(b.student))),
          );
          setIsEnabled(true);
        })
        .catch((error: unknown) => {
          if (!active) return;
          const message = error instanceof Error ? error.message : "";
          if (
            /student_stripe_progress_baselines|stripe_progress_classification|promotion_effective_at|does not exist|schema cache/i.test(
              message,
            )
          )
            setIsEnabled(false);
          else setErrorMessage("Live progress data could not be loaded. Try again.");
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-8"
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
          <View className="items-center">
            <Text className="text-lg font-bold text-foreground">Promotion review</Text>
            <Text className="text-xs text-muted-foreground">Coach decision required</Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
            <LucideIcon name="Award" className="h-5 w-5 text-tertiary" />
          </View>
        </View>
        <View className="mt-7 rounded-3xl bg-primary p-5">
          <Text className="text-sm font-semibold text-primary-foreground/70">COACH REVIEW</Text>
          <Text className="mt-2 text-3xl font-bold text-primary-foreground">
            Class requirement met
          </Text>
          <Text className="mt-2 text-sm leading-5 text-primary-foreground/75">
            This list never awards a stripe or belt. Confirm the full promotion decision before
            saving it.
          </Text>
        </View>
        {isLoading ? (
          <View className="items-center py-12">
            <LoadingIndicator />
            <Text className="mt-3 text-sm text-muted-foreground">Checking class progress…</Text>
          </View>
        ) : null}
        {!isLoading && !isEnabled ? (
          <View className="mt-7 rounded-2xl border border-tertiary/30 bg-tertiary/10 p-5">
            <Text className="font-bold text-foreground">Stripe progress is not enabled yet.</Text>
            <Text className="mt-1 text-sm leading-5 text-muted-foreground">
              This gym’s progress tables are not available.
            </Text>
          </View>
        ) : null}
        {!isLoading && errorMessage ? (
          <View className="mt-7 items-center rounded-2xl bg-destructive/10 px-6 py-10">
            <LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" />
            <Text className="font-bold text-foreground">Promotion review unavailable</Text>
            <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">
              {errorMessage}
            </Text>
          </View>
        ) : null}
        {!isLoading && isEnabled && !errorMessage ? (
          <ReviewList
            candidates={candidates}
            onOpen={(studentId) => router.push(`/members/${studentId}`)}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type StripeProgressContext = {
  classes: ProgressClass[];
  class_contract_exceptions: ClassContractException[];
  historical_boundaries: HistoricalPromotionBoundary[];
};

/** Promotion Review must never count another member's gym-scoped attendance. */
function filterReviewAttendanceForStudent(
  attendance: ReviewAttendance[],
  selectedStudentId: number | string | null | undefined,
) {
  const normalisedSelectedId = normaliseStudentId(selectedStudentId);
  if (!normalisedSelectedId) return [];
  return attendance.filter(
    (record) => normaliseStudentId(record.student_id) === normalisedSelectedId,
  );
}

function normaliseStudentId(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(numericValue) ? String(numericValue) : null;
}

function ReviewList({
  candidates,
  onOpen,
}: {
  candidates: ReviewCandidate[];
  onOpen: (studentId: number) => void;
}) {
  return (
    <View className="mt-7">
      <View className="mb-3 flex-row items-end justify-between">
        <Text className="text-xl font-bold text-foreground">Class requirement met</Text>
        <Text className="text-sm font-bold text-success">{candidates.length} members</Text>
      </View>
      <View className="rounded-2xl border border-border bg-card px-4">
        {candidates.length ? (
          candidates.map(({ student, counted, required, isNextBeltProgress }, index) => (
            <Pressable
              key={student.studentId}
              accessibilityRole="button"
              accessibilityLabel={`Review ${fullName(student)}`}
              onPress={() => onOpen(student.studentId)}
              className={`flex-row items-center py-4 ${index < candidates.length - 1 ? "border-b border-border" : ""}`}
            >
              <MemberAvatar
                initials={studentInitials(student)}
                index={index}
                photoUrl={student.photo_url}
              />
              <View className="ml-3 flex-1">
                <Text className="font-bold text-foreground">{fullName(student)}</Text>
                <Text className="mt-1 text-xs text-muted-foreground">
                  {isNextBeltProgress
                    ? "Progress toward next belt"
                    : `${student.belt_rank} · ${student.stripes} ${student.stripes === 1 ? "stripe" : "stripes"}`}{" "}
                  · {counted}/{required} classes
                </Text>
                {isNextBeltProgress ? (
                  <Text className="mt-1 text-xs font-bold text-success">
                    Class requirement met — coach review for next belt.
                  </Text>
                ) : null}
              </View>
              <LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" />
            </Pressable>
          ))
        ) : (
          <View className="items-center py-9">
            <LucideIcon name="CircleCheck" className="mb-2 h-6 w-6 text-success" />
            <Text className="font-bold text-foreground">No members ready for review</Text>
            <Text className="mt-1 text-center text-sm leading-5 text-muted-foreground">
              Members appear after their saved class requirement is met.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
