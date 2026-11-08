import * as React from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { Text } from "@/components/ui/text";
import { SignaturePad } from "@/components/gym/SignaturePad";
import LucideIcon from "@/lib/icons/LucideIcon";
import { database, isWaiverSigningSchemaAbsent, resolveActiveGymId } from "@/lib/database";
import { fullName, loadStudents, type Student } from "@/lib/students";
import { supabase } from "@/lib/supabase";
import { createWaiverIdempotencyKey, submitWaiverWithGateway } from "@/lib/waiver-submission";
import { memberProfilePath } from "@/lib/member-navigation";

type SigningData = Awaited<ReturnType<typeof database.getMemberWaiverSigningData>>;

function encodeSvg(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isExistingObjectError(error: { message?: string; statusCode?: string | number } | null) {
  return (
    error?.statusCode === 409 ||
    String(error?.message ?? "")
      .toLowerCase()
      .includes("already exists")
  );
}

export default function WaiverSigningScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const parsedStudentId = Number(studentId);
  const [student, setStudent] = React.useState<Student | null>(null);
  const [data, setData] = React.useState<SigningData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [participantName, setParticipantName] = React.useState("");
  const [signerName, setSignerName] = React.useState("");
  const [signerRole, setSignerRole] = React.useState<"participant" | "parent_guardian">(
    "participant",
  );
  const [emergencyContactName, setEmergencyContactName] = React.useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = React.useState("");
  const [signatureSvg, setSignatureSvg] = React.useState<string | null>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [idempotencyKey] = React.useState(createWaiverIdempotencyKey);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isComplete, setIsComplete] = React.useState(false);
  const [isWaiverVisible, setIsWaiverVisible] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function load() {
      if (!Number.isSafeInteger(parsedStudentId) || parsedStudentId <= 0) {
        if (active) {
          setErrorMessage("This member could not be identified.");
          setIsLoading(false);
        }
        return;
      }
      try {
        const [students, signingData] = await Promise.all([
          loadStudents(),
          database.getMemberWaiverSigningData(parsedStudentId),
        ]);
        if (!active) return;
        const foundStudent = students.find((item) => item.studentId === parsedStudentId) ?? null;
        setStudent(foundStudent);
        setData(signingData);
        if (foundStudent) {
          const name = fullName(foundStudent);
          setParticipantName(name);
          setSignerName(name);
        }
      } catch (error) {
        if (!active) return;
        if (isWaiverSigningSchemaAbsent(error)) {
          try {
            const students = await loadStudents();
            if (!active) return;
            const foundStudent =
              students.find((item) => item.studentId === parsedStudentId) ?? null;
            setStudent(foundStudent);
            if (foundStudent) {
              const name = fullName(foundStudent);
              setParticipantName(name);
              setSignerName(name);
            }
            setData({ activeVersion: null, hasDigitalSubmission: false });
          } catch {
            setErrorMessage("Live member data could not be loaded. Try again.");
          }
        } else {
          setErrorMessage("Waiver information could not be loaded. Try again.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [parsedStudentId]);

  const goBack = () =>
    router.dismissTo(
      memberProfilePath(
        Number.isSafeInteger(parsedStudentId) && parsedStudentId > 0 ? parsedStudentId : undefined,
      ),
    );

  const save = async () => {
    if (!student || !data?.activeVersion || !signatureSvg || isSubmitting || isComplete) return;
    const trimmedParticipant = participantName.trim();
    const trimmedSigner = signerName.trim();
    const trimmedContactName = emergencyContactName.trim();
    const trimmedContactPhone = emergencyContactPhone.trim();
    if (!trimmedParticipant || !trimmedSigner || !trimmedContactName || !trimmedContactPhone) {
      setErrorMessage("Complete every required field before saving the signed waiver.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const gymId = await resolveActiveGymId();
      const signatureObjectPath = `gym/${gymId}/members/${student.studentId}/waivers/${idempotencyKey}/signature.svg`;
      await submitWaiverWithGateway(
        {
          uploadSignature: async (path, svg) => {
            const { error } = await supabase.storage
              .from("member-waivers")
              .upload(path, encodeSvg(svg), {
                contentType: "image/svg+xml",
                upsert: false,
              });
            if (!error) return "uploaded";
            if (isExistingObjectError(error)) return "already-exists";
            throw new Error(error.message);
          },
          finalize: (request) => database.finalizeMemberWaiverSubmission(request),
        },
        {
          studentId: student.studentId,
          waiverVersionId: data.activeVersion.id,
          participantName: trimmedParticipant,
          signerName: trimmedSigner,
          signerRole,
          emergencyContactName: trimmedContactName,
          emergencyContactPhone: trimmedContactPhone,
          signatureObjectPath,
          signatureSvg,
          idempotencyKey,
        },
      );
      setIsComplete(true);
    } catch {
      setErrorMessage("The signed waiver was not saved. Confirm the information and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const legacyStatus = student?.waiver_signed ? "Previously marked signed" : "Pending";
  const canSubmit = Boolean(
    data?.activeVersion &&
      participantName.trim() &&
      signerName.trim() &&
      emergencyContactName.trim() &&
      emergencyContactPhone.trim() &&
      signatureSvg &&
      !isSubmitting &&
      !isComplete,
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", default: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-10"
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!isDrawing}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row items-center justify-between pt-4">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to member profile"
              onPress={goBack}
              className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
            >
              <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">Sign current waiver</Text>
            <View className="h-11 w-11" />
          </View>

          {isLoading ? (
            <View className="items-center py-24">
              <LoadingIndicator />
              <Text className="mt-3 text-sm text-muted-foreground">
                Loading waiver information…
              </Text>
            </View>
          ) : null}
          {!isLoading && errorMessage && !student ? <ErrorState message={errorMessage} /> : null}
          {!isLoading && !errorMessage && !student ? (
            <ErrorState message="This member record is no longer available." />
          ) : null}
          {!isLoading && student && isComplete ? (
            <SuccessState
              name={fullName(student)}
              onDone={() => router.dismissTo(memberProfilePath(student.studentId))}
            />
          ) : null}
          {!isLoading && student && !isComplete && !data?.activeVersion ? (
            <UnavailableState status={legacyStatus} />
          ) : null}
          {!isLoading &&
          student &&
          !isComplete &&
          data?.activeVersion &&
          data.hasDigitalSubmission ? (
            <ExistingSubmissionState />
          ) : null}
          {!isLoading &&
          student &&
          !isComplete &&
          data?.activeVersion &&
          !data.hasDigitalSubmission ? (
            <View className="pt-7">
              <View className="rounded-3xl bg-primary p-5">
                <Text className="text-sm font-semibold text-primary-foreground/75">
                  STAFF-ASSISTED SIGNING
                </Text>
                <Text className="mt-2 text-2xl font-bold text-primary-foreground">
                  {fullName(student)}
                </Text>
                <Text className="mt-2 text-sm leading-5 text-primary-foreground/75">
                  Review the current waiver with the signer. The assisting staff member is recorded
                  separately.
                </Text>
              </View>
              <View className="mt-6 rounded-2xl border border-border bg-card p-4">
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1">
                    <Text className="font-bold text-foreground">{data.activeVersion.title}</Text>
                    <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                      Approved waiver version · {data.activeVersion.content_sha256.slice(0, 12)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isWaiverVisible }}
                    onPress={() => setIsWaiverVisible((visible) => !visible)}
                    className="min-h-11 justify-center rounded-xl bg-secondary px-3 active:bg-accent"
                  >
                    <Text className="font-bold text-secondary-foreground">
                      {isWaiverVisible ? "Hide" : "Read"}
                    </Text>
                  </Pressable>
                </View>
                {isWaiverVisible ? (
                  <Text className="mt-4 text-sm leading-6 text-foreground">
                    {data.activeVersion.exact_text}
                  </Text>
                ) : null}
              </View>
              <Field
                label="Participant’s full name"
                value={participantName}
                onChangeText={setParticipantName}
                placeholder="Participant’s full name"
              />
              <Field
                label="Signer’s full name"
                value={signerName}
                onChangeText={setSignerName}
                placeholder="Signer’s full legal name"
              />
              <View className="mt-6">
                <Text className="mb-2 font-bold text-foreground">Signing as</Text>
                <View className="flex-row flex-wrap gap-2">
                  <RoleButton
                    selected={signerRole === "participant"}
                    label="Participant"
                    onPress={() => setSignerRole("participant")}
                  />
                  <RoleButton
                    selected={signerRole === "parent_guardian"}
                    label="Parent / legal guardian"
                    onPress={() => setSignerRole("parent_guardian")}
                  />
                </View>
              </View>
              <View className="mt-6">
                <Text className="mb-2 font-bold text-foreground">Handwritten signature</Text>
                <Text className="mb-3 text-sm leading-5 text-muted-foreground">
                  The signer should sign inside the box with a finger, mouse, or stylus.
                </Text>
                <SignaturePad onChange={setSignatureSvg} onGestureStateChange={setIsDrawing} />
              </View>
              <Field
                label="Emergency contact name"
                value={emergencyContactName}
                onChangeText={setEmergencyContactName}
                placeholder="Emergency contact name"
              />
              <Field
                label="Emergency contact phone"
                value={emergencyContactPhone}
                onChangeText={setEmergencyContactPhone}
                placeholder="Emergency contact phone"
                keyboardType="phone-pad"
              />
              {errorMessage ? (
                <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/15 px-4 py-3">
                  <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" />
                  <Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save signed waiver"
                disabled={!canSubmit}
                onPress={save}
                className={`mt-7 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary px-5 ${canSubmit ? "active:opacity-90" : "opacity-60"}`}
              >
                {isSubmitting ? (
                  <LoadingIndicator tone="on-primary" />
                ) : (
                  <LucideIcon name="FileCheck" className="h-5 w-5 text-primary-foreground" />
                )}
                <Text className="font-bold text-primary-foreground">
                  {isSubmitting ? "Saving signed waiver…" : "Save signed waiver"}
                </Text>
              </Pressable>
              <Text className="mt-3 text-center text-xs leading-4 text-muted-foreground">
                Signed is shown only after private files validate and the server finalizes the
                submission.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "phone-pad";
}) {
  return (
    <View className="mt-6">
      <Text className="mb-2 font-bold text-foreground">{label}</Text>
      <View className="rounded-2xl border border-border bg-card px-4 py-3">
        <ThemedTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType={keyboardType}
          className="text-base text-foreground"
        />
      </View>
    </View>
  );
}

function RoleButton({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-11 rounded-xl px-4 py-3 ${selected ? "bg-primary" : "bg-secondary active:bg-accent"}`}
    >
      <Text
        className={`font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function UnavailableState({ status }: { status: string }) {
  return (
    <View className="items-center py-20">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-warning/15">
        <LucideIcon name="FileClock" className="h-7 w-7 text-warning" />
      </View>
      <Text className="mt-5 text-center text-xl font-bold text-foreground">
        Waiver signing is not enabled for this gym yet.
      </Text>
      <Text className="mt-3 max-w-sm text-center text-sm leading-5 text-muted-foreground">
        The approved private-storage setup has not been deployed. No signature was collected and
        this member remains {status.toLowerCase()}.
      </Text>
      <View className="mt-6 rounded-full bg-secondary px-4 py-2">
        <Text className="font-bold text-secondary-foreground">{status}</Text>
      </View>
    </View>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <View className="items-center py-24">
      <LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" />
      <Text className="text-lg font-bold text-foreground">Waiver unavailable</Text>
      <Text className="mt-2 max-w-sm text-center text-sm leading-5 text-muted-foreground">
        {message}
      </Text>
    </View>
  );
}

function ExistingSubmissionState() {
  return (
    <View className="items-center py-20">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-success/15">
        <LucideIcon name="FileCheck" className="h-7 w-7 text-success" />
      </View>
      <Text className="mt-5 text-center text-xl font-bold text-foreground">Waiver signed</Text>
      <Text className="mt-3 max-w-sm text-center text-sm leading-5 text-muted-foreground">
        A completed digital waiver is already on file for this member. It cannot be replaced from
        this screen.
      </Text>
    </View>
  );
}

function SuccessState({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <View className="items-center py-24">
      <View className="h-16 w-16 items-center justify-center rounded-3xl bg-success">
        <LucideIcon name="Check" className="h-8 w-8 text-success-foreground" strokeWidth={3} />
      </View>
      <Text className="mt-5 text-2xl font-bold text-foreground">Waiver signed</Text>
      <Text className="mt-3 max-w-sm text-center text-sm leading-5 text-muted-foreground">
        The signed waiver for {name} was saved successfully.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Return to member profile"
        onPress={onDone}
        className="mt-7 min-h-12 justify-center rounded-2xl bg-primary px-5"
      >
        <Text className="font-bold text-primary-foreground">Return to member profile</Text>
      </Pressable>
    </View>
  );
}
