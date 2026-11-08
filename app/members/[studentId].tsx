import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { AppHeader } from "@/components/gym/AppHeader";
import { MemberAvatar } from "@/components/gym/MemberAvatar";
import { BeltRankCard } from "@/components/gym/BeltRankCard";
import { CalendarDatePicker } from "@/components/gym/CalendarDatePicker";
import { Button } from "@/components/ui/button";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { formatMemberProgram, fullName, loadStudents, studentInitials, type Student } from "@/lib/students";
import { MEMBERS_LIST_PATH } from "@/lib/member-navigation";
import { database, isWaiverSigningSchemaAbsent } from "@/lib/database";
import { getBeltColorProfile } from "@/lib/belt-colors";
import { useTheme } from "@/theming/ThemeProvider";
import {
  calculateStripeProgress,
  type ClassContractException,
  type HistoricalPromotionBoundary,
  type ProgressAttendance,
  type ProgressBaseline,
  type ProgressClass,
  type ProgressPromotion,
} from "@/lib/stripe-progress";

export default function MemberProfileScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [student, setStudent] = React.useState<Student | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let isMounted = true;
      async function loadStudent() {
        setIsLoading(true);
        setErrorMessage(null);
        try {
          const result = await loadStudents();
          const foundStudent = result.find((item) => String(item.studentId) === studentId);
          if (isMounted) {
            setStudent(foundStudent ?? null);
          }
        } catch {
          if (isMounted) setErrorMessage("Live member data could not be loaded. Try again.");
        } finally {
          if (isMounted) setIsLoading(false);
        }
      }
      loadStudent();
      return () => {
        isMounted = false;
      };
    }, [studentId]),
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full max-w-2xl self-center pt-4">
          <AppHeader
            title="Member profile"
            dataLabel="Active academy · Live student record"
            backAction={{
              accessibilityLabel: "Back to members",
              onPress: () => router.dismissTo(MEMBERS_LIST_PATH),
            }}
          />

        {isLoading ? (
          <View className="items-center py-24">
            <LoadingIndicator />
            <Text className="mt-3 text-sm text-muted-foreground">Loading member profile…</Text>
          </View>
        ) : null}
        {!isLoading && errorMessage ? (
          <View className="items-center py-24">
            <LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" />
            <Text className="text-lg font-bold text-foreground">Member unavailable</Text>
            <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">
              {errorMessage}
            </Text>
          </View>
        ) : null}
        {!isLoading && !errorMessage && !student ? (
          <View className="items-center py-24">
            <View className="mb-4 h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <LucideIcon name="UserRoundX" className="h-6 w-6 text-muted-foreground" />
            </View>
            <Text className="text-lg font-bold text-foreground">Member not found</Text>
            <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">
              This student record is no longer available.
            </Text>
          </View>
        ) : null}
        {!isLoading && !errorMessage && student ? (
          <Profile
            student={student}
            onAction={(action) => router.push(`/members/${student.studentId}/${action}`)}
            onSetup={() => router.push(`/members/${student.studentId}/stripe-progress-setup`)}
          />
        ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Profile({
  student,
  onAction,
  onSetup,
}: {
  student: Student;
  onAction: (action: MemberAction) => void;
  onSetup: () => void;
}) {
  const statusIsActive = student.membership_status.trim().toLowerCase() === "active";
  const programs = Array.isArray(student.programs)
    ? student.programs.map(formatMemberProgram).filter(Boolean)
    : [];
  const programLabel = programs.length ? programs.join(" · ") : "Program not assigned";
  return (
    <View className="pt-1">
      <View className="overflow-hidden rounded-3xl border border-border bg-card">
        <View className="h-1 bg-primary" />
        <View className="p-5">
          <View className="flex-row items-start gap-4">
            <View className="rounded-2xl border-2 border-primary/30 p-1">
              <MemberAvatar initials={studentInitials(student)} photoUrl={student.photo_url} size="md" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase tracking-wide text-tertiary">Student athlete</Text>
              <Text numberOfLines={2} className="mt-1 text-3xl font-bold tracking-tight text-foreground">{fullName(student)}</Text>
              <Text numberOfLines={1} className="mt-1 text-sm font-medium text-muted-foreground">{programLabel}</Text>
            </View>
          </View>
          <View className="mt-5 flex-row items-center justify-between border-t border-border pt-4">
            <View>
              <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Academy</Text>
              <Text className="mt-1 text-sm font-semibold text-foreground">Active academy</Text>
            </View>
            <View className={`rounded-full px-3 py-1.5 ${statusIsActive ? "bg-success/15" : "bg-tertiary/15"}`}>
              <Text className={`text-xs font-bold ${statusIsActive ? "text-success" : "text-tertiary"}`}>{student.membership_status}</Text>
            </View>
          </View>
        </View>
      </View>
      <View className="mt-6 overflow-hidden rounded-3xl border border-border bg-card">
        <View className="h-1 bg-primary" />
        <View className="p-5">
          <View className="mb-5 flex-row items-end justify-between gap-3"><View className="flex-1"><Text className="text-xl font-bold tracking-tight text-foreground">Athlete progress</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Recorded rank and authoritative qualifying-class progress</Text></View><Text className="text-xs font-bold uppercase tracking-wide text-tertiary">Live record</Text></View>
          <BeltRankCard beltRank={student.belt_rank} stripes={student.stripes} embedded />
          <View className="my-5 border-t border-border" />
          <StripeProgressCard student={student} onSetup={onSetup} embedded />
          <Pressable accessibilityRole="button" accessibilityLabel="Attendance history" onPress={() => onAction("attendance-history")} className="mt-5 flex-row items-center rounded-2xl bg-background/50 px-4 py-3 active:bg-accent"><View className="h-9 w-9 items-center justify-center rounded-xl bg-secondary"><LucideIcon name="History" className="h-4 w-4 text-tertiary" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">Attendance history</Text><Text className="mt-0.5 text-xs text-muted-foreground">Review recorded class activity</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></Pressable>
        </View>
      </View>
      <View className="mt-8">
        <View className="mb-3"><Text className="text-xl font-bold tracking-tight text-foreground">Promotion history</Text><Text className="mt-1 text-sm text-muted-foreground">Confirmed staff boundaries only</Text></View>
        <HistoricalPromotionSetup student={student} />
      </View>
      <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Member record</Text>
      <View className="rounded-2xl border border-border bg-card px-4">
        <DetailRow icon="BadgeCheck" label="Membership" value={student.membership_status} />
        <WaiverStatusRow student={student} />
      </View>
      <Text className="mb-3 mt-8 text-xl font-bold tracking-tight text-foreground">Coach actions</Text>
      <View className="gap-3">
        <ActionButton icon="ScanLine" label="Check in" detail="Open member check-in" onPress={() => onAction("check-in")} />
        <ActionButton icon="Award" label="Promote student" detail="Review and record a promotion" onPress={() => onAction("promote")} />
        <ActionButton icon="CircleDollarSign" label="Add payment" detail="Record a member payment" onPress={() => onAction("add-payment")} />
        <ActionButton icon="WalletCards" label="Payment history" detail="View recorded payments" onPress={() => onAction("payment-history")} />
        <ActionButton icon="Signature" label="Sign current waiver" detail="Open the current waiver workflow" onPress={() => onAction("waiver")} />
        <ActionButton icon="Pencil" label="Edit member" detail="Update this member record" onPress={() => onAction("edit")} />
      </View>
    </View>
  );
}

type MemberAction =
  | "check-in"
  | "promote"
  | "attendance-history"
  | "add-payment"
  | "payment-history"
  | "edit"
  | "waiver";

type ProfileAttendance = ProgressAttendance & {
  student_id?: number | string | null;
};

function StripeProgressCard({ student, onSetup, embedded = false }: { student: Student; onSetup: () => void; embedded?: boolean }) {
  const { theme } = useTheme();
  const [result, setResult] = React.useState<ReturnType<typeof calculateStripeProgress> | null>(
    null,
  );
  const [enabled, setEnabled] = React.useState(true);
  const [contractIssue, setContractIssue] = React.useState<string | null>(null);
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      setResult(null);
      setEnabled(true);
      setContractIssue(null);
      Promise.all([
        database.listAttendanceForStudent<ProfileAttendance>(student.studentId),
        database.listPromotions<ProgressPromotion>(),
        database.listStripeProgressBaselines<ProgressBaseline>(),
        database.getGymStripeProgressContext<StripeProgressContext>(),
      ])
        .then(([attendance, promotions, baselines, context]) => {
          if (!active) return;
          if (context.class_contract_exceptions.length > 0) {
            setContractIssue(
              `${context.class_contract_exceptions.length} scheduled class record${context.class_contract_exceptions.length === 1 ? "" : "s"} does not use the verified calendar-day contract. Stripe progress is paused until it is reviewed.`,
            );
            return;
          }
          setResult(
            calculateStripeProgress(
              student,
              filterAttendanceForStudent(attendance, student.studentId),
              promotions.filter((item) => item.student_id === student.studentId),
              baselines.filter((item) => item.student_id === student.studentId),
              {
                classes: context.classes,
                historicalBoundaries: context.historical_boundaries.filter(
                  (item) => item.student_id === student.studentId,
                ),
              },
            ),
          );
        })
        .catch(() => {
          if (active) setEnabled(false);
        });
      return () => {
        active = false;
      };
    }, [student]),
  );
  if (!enabled || contractIssue)
    return (
      <View className={`${embedded ? 'rounded-2xl border border-tertiary/30 bg-tertiary/10 p-4' : 'rounded-2xl border border-tertiary/30 bg-tertiary/10 p-5'}`}>
        <Text className="font-bold text-foreground">Stripe progress is not enabled yet.</Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">
          {contractIssue ?? "This gym’s progress tables are not available."}
        </Text>
      </View>
    );
  if (!result)
    return (
      <View className={`${embedded ? 'rounded-2xl bg-background/50 p-4' : 'rounded-2xl border border-border bg-card p-5'}`}>
        <Text className="font-bold text-foreground">Stripe progress</Text>
        <Text className="mt-1 text-sm text-muted-foreground">Loading counted classes…</Text>
      </View>
    );
  if (result.state !== "ready") {
    const title =
      result.state === "rank-unconfigured" ? "Rank requirements unavailable" : "Setup needed";
    return (
      <View className={`${embedded ? 'rounded-2xl border border-warning/30 bg-warning/10 p-4' : 'rounded-2xl border border-warning/30 bg-warning/10 p-5'}`}>
        <Text className="font-bold text-foreground">{title}</Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">{result.reason}</Text>
        {result.state === "setup-needed" ? (
          <Pressable onPress={onSetup} className="mt-4 self-start rounded-xl bg-primary px-4 py-2">
            <Text className="font-bold text-primary-foreground">Set counting boundary</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const countLabel =
    result.source === "confirmed-baseline"
      ? "Recorded qualifying classes since confirmed baseline"
      : "Recorded qualifying classes since last promotion";
  const isNextBeltProgress = student.stripes >= 4;
  const belt = getBeltColorProfile(student.belt_rank, {
    primaryColor: theme.colors.primary ?? '#A63832',
    borderColor: theme.colors.border ?? '#7B837D',
    textColor: theme.colors.primaryForeground ?? '#F7F5EF',
  });
  const primaryBeltColor = belt.primaryColor.toLowerCase();
  const beltAccent = primaryBeltColor === '#f5f1e8' || primaryBeltColor === '#202326'
    ? belt.secondaryColor ?? theme.colors.primary ?? '#A63832'
    : belt.primaryColor;
  const progressPercent = Math.min(100, Math.max(0, (result.counted / result.required) * 100));
  return (
    <View className={embedded ? '' : `rounded-2xl border p-5 ${result.met ? "border-success/40 bg-success/10" : "border-border bg-card"}`}>
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1"><Text className="text-xs font-bold uppercase tracking-wide text-tertiary">Advancement</Text><Text className="mt-1 text-xl font-bold tracking-tight text-foreground">{isNextBeltProgress ? "Progress toward next belt" : "Stripe progress"}</Text></View>
        {result.met ? (
          <Text className="max-w-[150px] text-right text-xs font-bold leading-4 text-success">
            {isNextBeltProgress
              ? "Class requirement met — coach review for next belt."
              : "Class requirement met"}
          </Text>
        ) : null}
      </View>
      <Text className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{countLabel}</Text>
      <View className="mt-2 flex-row items-end justify-between gap-4">
        <Text className="text-4xl font-bold tracking-tight text-foreground">{result.counted}<Text className="text-lg font-semibold text-muted-foreground"> / {result.required}</Text></Text>
        <Text className="mb-1 text-sm font-semibold text-muted-foreground">qualifying classes</Text>
      </View>
      <View accessibilityLabel={`${Math.round(progressPercent)} percent of the qualifying class requirement completed`} className="mt-4 h-3 overflow-hidden rounded-full border border-border bg-muted">
        <View pointerEvents="none" className="h-full rounded-full" style={{ width: `${progressPercent}%`, backgroundColor: beltAccent }} />
      </View>
      <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-background/60 px-4 py-3"><View><Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Next promotion</Text><Text className="mt-1 text-lg font-bold text-foreground">{result.remaining} {result.remaining === 1 ? "class" : "classes"} remaining</Text></View><View className="rounded-full bg-secondary px-3 py-1.5"><Text className="text-xs font-bold capitalize text-secondary-foreground">{result.track} track</Text></View></View>
      <Text className="mt-3 text-xs leading-4 text-muted-foreground">Missing attendance history is not included.</Text>
    </View>
  );
}

/** The profile must never count a different member's gym-scoped attendance. */
function filterAttendanceForStudent(
  attendance: ProfileAttendance[],
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

type StripeProgressContext = {
  classes: ProgressClass[];
  class_contract_exceptions: ClassContractException[];
  historical_boundaries: HistoricalPromotionBoundary[];
};

function HistoricalPromotionSetup({ student }: { student: Student }) {
  const [promotionDate, setPromotionDate] = React.useState<string | null>(null);
  const [confirmationNote, setConfirmationNote] = React.useState("");
  const [previousDate, setPreviousDate] = React.useState<string | null>(null);
  const [isEnabled, setIsEnabled] = React.useState<boolean | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);

  const loadSetup = React.useCallback(async () => {
    setIsEnabled(null);
    setMessage(null);
    try {
      const context = await database.getGymStripeProgressContext<StripeProgressContext>();
      const latestBoundary = context.historical_boundaries
        .filter(
          (boundary) => boundary.student_id === student.studentId && boundary.last_promotion_date,
        )
        .sort(
          (first, second) =>
            Date.parse(second.confirmed_at ?? "") - Date.parse(first.confirmed_at ?? ""),
        )[0];
      setPreviousDate(latestBoundary?.last_promotion_date ?? null);
      setIsEnabled(context.class_contract_exceptions.length === 0);
      if (context.class_contract_exceptions.length > 0) {
        setMessage("Scheduled class records need review before a historical promotion date can be confirmed.");
      }
    } catch {
      setIsEnabled(false);
      setMessage("Historical promotion setup is not enabled for this gym yet.");
    }
  }, [student.studentId]);

  React.useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  const saveHistoricalDate = async () => {
    if (!promotionDate || confirmationNote.trim().length < 3) {
      setMessage("Choose the last promotion date and enter a short confirmation note.");
      return;
    }
    if (isEnabled !== true) return;

    setSaving(true);
    setMessage(null);
    try {
      await database.confirmHistoricalPromotionDate(
        student.studentId,
        promotionDate,
        confirmationNote.trim(),
      );
      setPreviousDate(promotionDate);
      setConfirmationNote("");
      setMessage("Historical promotion date confirmed.");
    } catch {
      setMessage("The historical promotion date could not be confirmed. Check your access and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Historical Promotion Setup"
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => setIsExpanded((expanded) => !expanded)}
        className="flex-row items-center gap-3 px-4 py-3.5 active:bg-accent"
      >
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-secondary">
          <LucideIcon name="CalendarCheck2" className="h-5 w-5 text-tertiary" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-bold text-foreground">Historical Promotion Setup</Text>
          {previousDate ? (
            <Text numberOfLines={1} className="mt-0.5 text-xs font-medium text-success">
              Confirmed date: {previousDate}
            </Text>
          ) : (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">
              Set a confirmed counting boundary
            </Text>
          )}
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-xs font-bold text-tertiary">{isExpanded ? "Close" : "Edit"}</Text>
          <LucideIcon name={isExpanded ? "ChevronUp" : "ChevronDown"} className="h-5 w-5 text-muted-foreground" />
        </View>
      </Pressable>

      {isExpanded ? (
        <View className="border-t border-border px-4 pb-4 pt-4">
          <Text className="text-sm leading-5 text-muted-foreground">
            Confirm the last stripe or belt date to count qualifying classes from the next day.
          </Text>
          {previousDate ? (
            <View className="mt-4 rounded-xl border border-success/25 bg-success/10 px-3 py-2">
              <Text className="text-sm text-foreground">
                Previously confirmed date: <Text className="font-bold">{previousDate}</Text>
              </Text>
            </View>
          ) : null}

          <View className="mt-5 gap-4">
            <CalendarDatePicker
              label="Last Promotion Date"
              value={promotionDate}
              onChange={(date) => {
                setPromotionDate(date);
                setMessage(null);
              }}
              disabled={isEnabled !== true || saving}
            />
            <View>
              <Text className="mb-2 font-bold text-foreground">Confirmation Note</Text>
              <ThemedTextInput
                value={confirmationNote}
                onChangeText={(value) => {
                  setConfirmationNote(value);
                  setMessage(null);
                }}
                editable={isEnabled === true && !saving}
                multiline
                textAlignVertical="top"
                placeholder="How was this date confirmed?"
                className="min-h-24 py-3"
              />
              <Text className="mt-2 text-xs leading-4 text-muted-foreground">
                This records a staff confirmation only. It does not change rank, attendance, or promotions.
              </Text>
            </View>
          </View>

          {isEnabled === null ? (
            <View className="mt-4 flex-row items-center">
              <LoadingIndicator />
              <Text className="ml-2 text-sm text-muted-foreground">Checking setup…</Text>
            </View>
          ) : null}
          {message ? (
            <View
              className={`mt-4 rounded-xl px-3 py-3 ${message === "Historical promotion date confirmed." ? "bg-success/10" : "bg-tertiary/10"}`}
            >
              <Text
                className={
                  message === "Historical promotion date confirmed." ? "text-success" : "text-foreground"
                }
              >
                {message}
              </Text>
            </View>
          ) : null}

          <Button
            disabled={isEnabled !== true || saving}
            onPress={saveHistoricalDate}
            className="mt-5 self-start"
          >
            <Text>{saving ? "Saving…" : "Save Historical Promotion Date"}</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  icon,
  label,
  detail,
  onPress,
}: {
  icon:
    | "ScanLine"
    | "Award"
    | "History"
    | "CircleDollarSign"
    | "WalletCards"
    | "Pencil"
    | "Signature";
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="flex-row items-center rounded-2xl border border-border bg-card px-4 py-3.5 active:bg-accent"
    >
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-secondary">
        <LucideIcon name={icon} className="h-4 w-4 text-tertiary" />
      </View>
      <View className="ml-3 min-w-0 flex-1"><Text className="font-bold text-foreground">{label}</Text><Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">{detail}</Text></View>
      <LucideIcon name="ChevronRight" className="ml-3 h-5 w-5 text-muted-foreground" />
    </Pressable>
  );
}

function DetailRow({
  icon,
  label,
  value,
  last = false,
}: {
  icon: "BadgeCheck" | "FileCheck";
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View className={`flex-row items-center py-4 ${last ? "" : "border-b border-border"}`}>
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-secondary">
        <LucideIcon name={icon} className="h-4 w-4 text-tertiary" />
      </View>
      <Text className="ml-3 flex-1 font-medium text-muted-foreground">{label}</Text>
      <Text className="font-bold text-foreground">{value}</Text>
    </View>
  );
}

function WaiverStatusRow({ student }: { student: Student }) {
  const [label, setLabel] = React.useState(
    student.waiver_signed ? "Previously marked signed" : "Pending",
  );

  React.useEffect(() => {
    let active = true;
    database
      .getMemberWaiverSigningData(student.studentId)
      .then((data) => {
        if (active)
          setLabel(
            data.hasDigitalSubmission
              ? "Signed"
              : student.waiver_signed
                ? "Previously marked signed"
                : "Pending",
          );
      })
      .catch((error) => {
        if (active && !isWaiverSigningSchemaAbsent(error)) setLabel("Status unavailable");
      });
    return () => {
      active = false;
    };
  }, [student.studentId, student.waiver_signed]);

  return <DetailRow icon="FileCheck" label="Waiver" value={label} last />;
}
