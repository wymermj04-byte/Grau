import * as React from "react";
import { Pressable, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { DraftbitRestApiError } from "@/draftbit-api";
import { database } from "@/lib/database";
import { memberProfilePath } from "@/lib/member-navigation";
import { type Student } from "@/lib/students";

function isValidGymId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export default function MemberCheckInScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [student, setStudent] = React.useState<Student | null>(null);
  const [isLoadingStudent, setIsLoadingStudent] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isCheckedIn, setIsCheckedIn] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    async function loadStudent() {
      if (!studentId) {
        if (isMounted) {
          setErrorMessage("This member could not be identified. Check-in cannot be recorded.");
          setIsLoadingStudent(false);
        }
        return;
      }

      try {
        const students = await database.listStudents<Student>();
        const selectedStudent =
          students.find((item) => String(item.studentId) === studentId) ?? null;
        if (isMounted) {
          setStudent(selectedStudent);
          if (!selectedStudent)
            setErrorMessage(
              "This member could not be found in the live roster. Check-in cannot be recorded.",
            );
        }
      } catch {
        if (isMounted)
          setErrorMessage(
            "The live member record could not be loaded. Check-in cannot be recorded.",
          );
      } finally {
        if (isMounted) setIsLoadingStudent(false);
      }
    }

    loadStudent();
    return () => {
      isMounted = false;
    };
  }, [studentId]);

  const submitCheckIn = async () => {
    if (isSubmitting || isCheckedIn) return;
    if (!student) {
      setErrorMessage(
        "The live member record could not be confirmed. Check-in cannot be recorded.",
      );
      return;
    }
    if (!isValidGymId(student.gym_id)) {
      setErrorMessage("This member is not assigned to a valid gym. Check-in cannot be recorded.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await database.createAttendance({
        student_id: String(student.studentId),
        // The live attendance table stores Open Mat rows with a nullable class_id.
        class_id: null,
        check_in_date: new Date().toISOString(),
        class_type: "Open Mat",
        notes: "",
        gym_id: student.gym_id,
      });
      setIsCheckedIn(true);
    } catch (error) {
      setErrorMessage(checkInErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isGymReady = isValidGymId(student?.gym_id);
  const isDisabled = isLoadingStudent || !student || !isGymReady || isSubmitting || isCheckedIn;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="flex-1 px-5 pt-4">
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to member profile"
          onPress={() => router.dismissTo(memberProfilePath(studentId))}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Check in</Text>
          <View className="h-10 w-10" />
        </View>
        <View className="flex-1 justify-center pb-20">
          <View
            className={`items-center rounded-3xl p-6 ${isCheckedIn ? "bg-success/15" : "bg-secondary"}`}
          >
            <View
              className={`h-16 w-16 items-center justify-center rounded-3xl ${isCheckedIn ? "bg-success" : "bg-card"}`}
            >
              <LucideIcon
                name={isCheckedIn ? "Check" : "ScanLine"}
                className={`h-7 w-7 ${isCheckedIn ? "text-success-foreground" : "text-tertiary"}`}
                strokeWidth={isCheckedIn ? 3 : 2}
              />
            </View>
            <Text className="mt-5 text-2xl font-bold text-foreground">
              {isCheckedIn ? "Check-in recorded" : "Open Mat check-in"}
            </Text>
            <Text className="mt-3 max-w-[290px] text-center text-sm leading-5 text-muted-foreground">
              {isCheckedIn
                ? "This member has been added to today’s Open Mat attendance."
                : isLoadingStudent
                  ? "Confirming this member’s gym assignment…"
                  : "Record this member’s attendance for Open Mat using the current time."}
            </Text>
          </View>
          {errorMessage ? (
            <View className="mt-5 flex-row items-center gap-2 rounded-2xl bg-destructive/15 px-4 py-3">
              <LucideIcon name="CircleAlert" className="h-5 w-5 text-destructive" />
              <Text className="flex-1 text-sm font-medium text-foreground">{errorMessage}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record Open Mat check-in"
            disabled={isDisabled}
            onPress={submitCheckIn}
            className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl py-4 ${isCheckedIn ? "bg-success" : "bg-primary"} ${isDisabled && !isCheckedIn ? "opacity-60" : ""}`}
          >
            {isSubmitting || isLoadingStudent ? (
              <LoadingIndicator tone="on-primary" />
            ) : (
              <LucideIcon
                name={isCheckedIn ? "Check" : "ScanLine"}
                className={`h-5 w-5 ${isCheckedIn ? "text-success-foreground" : "text-primary-foreground"}`}
                strokeWidth={isCheckedIn ? 3 : 2}
              />
            )}
            <Text
              className={
                isCheckedIn
                  ? "font-bold text-success-foreground"
                  : "font-bold text-primary-foreground"
              }
            >
              {isSubmitting
                ? "Recording check-in…"
                : isCheckedIn
                  ? "Check-in complete"
                  : isLoadingStudent
                    ? "Loading member…"
                    : "Check in to Open Mat"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function checkInErrorMessage(error: unknown) {
  if (error instanceof DraftbitRestApiError) {
    try {
      const response = JSON.parse(error.responseText ?? "") as {
        message?: string;
        details?: string;
      };
      if (response.message) return `Check-in could not be recorded: ${response.message}`;
      if (response.details) return `Check-in could not be recorded: ${response.details}`;
    } catch {
      // The endpoint did not return a JSON error body.
    }
    return `Check-in could not be recorded (HTTP ${error.status}). Try again.`;
  }

  return error instanceof Error && error.message
    ? `Check-in could not be recorded: ${error.message}`
    : "Check-in could not be recorded. Try again.";
}
