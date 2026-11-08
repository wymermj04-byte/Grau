import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { AppHeader } from "@/components/gym/AppHeader";
import { MemberAvatar } from "@/components/gym/MemberAvatar";
import { PageContent } from "@/components/layout/PageContent";
import { useGymAccess } from "@/providers/GymAccessProvider";
import { getBeltColorProfile } from "@/lib/belt-colors";
import { useTheme } from "@/theming/ThemeProvider";
import {
  formatMemberProgram,
  fullName,
  filterStudents,
  isActiveStudent,
  loadStudents,
  studentInitials,
  type Student,
} from "@/lib/students";

export default function MembersScreen() {
  return <MembersContent />;
}

function MembersContent() {
  const router = useRouter();
  const { gymId } = useGymAccess();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<"All" | "Active" | "Leads">("All");
  const [programFilter, setProgramFilter] = React.useState<"All" | "Kids" | "Adults">("All");
  const [students, setStudents] = React.useState<Student[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let isFocused = true;
      setIsLoading(true);
      setErrorMessage(null);
      setStudents([]);

      async function loadMemberData() {
        try {
          const result = await loadStudents();
          if (isFocused) {
            setStudents(result);
          }
        } catch {
          if (isFocused) setErrorMessage('Live member records could not be loaded. Try again.');
        } finally {
          if (isFocused) setIsLoading(false);
        }
      }

      void loadMemberData();
      return () => {
        isFocused = false;
      };
    }, []),
  );

  const filtered = React.useMemo(
    () => filterStudents(students, query, filter, programFilter),
    [filter, programFilter, query, students],
  );
  const hasQuery = query.length > 0;

  const activeCount = students.filter(isActiveStudent).length;
  const needsFollowUp = students.filter((student) => !isActiveStudent(student)).length;
  const waiverCount = students.filter((student) => student.waiver_signed).length;
  const dataLabel = isLoading ? "Loading students" : errorMessage ? "Member data unavailable" : "Live student records";
  const directoryCount = isLoading ? "Loading roster" : `${students.length} ${students.length === 1 ? "member" : "members"}`;
  const academyLabel = gymId === null ? "Academy roster" : "Active academy";

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-8"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PageContent className="px-5 pt-4">
          <AppHeader
            title="Members"
            action={errorMessage ? undefined : "add"}
            secondaryAction={errorMessage ? undefined : "promotions"}
            dataLabel={dataLabel}
          />
        </PageContent>
        <PageContent className="mb-3 px-5">
          <View className="flex-row items-end justify-between gap-4">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase tracking-[1.4px] text-primary">{academyLabel}</Text>
              <Text className="mt-1 text-2xl font-bold tracking-tight text-foreground">Member directory</Text>
            </View>
            <View className="mb-0.5 flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5">
              <View className="h-1.5 w-1.5 rounded-full bg-tertiary" />
              <Text className="text-xs font-bold text-secondary-foreground">{directoryCount}</Text>
            </View>
          </View>
        </PageContent>
        <PageContent className="mb-3 px-5">
          <View className="flex-row rounded-2xl border border-border bg-card px-1 py-2">
            <Stat value={isLoading ? "—" : String(activeCount)} label="Active" primary />
            <Stat value={isLoading ? "—" : String(needsFollowUp)} label="Follow-up" divided />
            <Stat value={isLoading ? "—" : String(waiverCount)} label="Waivers" divided />
          </View>
        </PageContent>
        {!errorMessage ? (
          <PageContent className="mb-4 px-5">
            <View>
              <View className="flex-row items-center rounded-2xl border border-border bg-card px-3.5 py-2.5">
                <LucideIcon name="Search" className="mr-2.5 h-5 w-5 text-muted-foreground" />
                <ThemedTextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search members"
                  className="flex-1 text-base text-foreground"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear member search"
                  accessibilityState={{ disabled: !hasQuery }}
                  disabled={!hasQuery}
                  onPress={() => setQuery("")}
                  className="ml-2 h-9 w-9 items-center justify-center rounded-full bg-secondary active:bg-accent"
                  style={hasQuery ? undefined : styles.clearHidden}
                >
                  <LucideIcon name="X" className="h-4 w-4 text-secondary-foreground" />
                </Pressable>
              </View>
              <View className="mt-3 gap-2">
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-normal text-muted-foreground">Program</Text>
                  <View className="flex-1 flex-row gap-2">
                  {(["All", "Kids", "Adults"] as const).map((option) => (
                    <FilterChip key={option} label={option} selected={programFilter === option} onPress={() => setProgramFilter(option)} />
                  ))}
                  </View>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-normal text-muted-foreground">Status</Text>
                  <View className="flex-1 flex-row gap-2">
                  {(["All", "Active", "Leads"] as const).map((option) => (
                    <FilterChip key={option} label={option} selected={filter === option} onPress={() => setFilter(option)} />
                  ))}
                  </View>
                </View>
              </View>
            </View>
          </PageContent>
        ) : null}
        {errorMessage ? (
          <PageContent className="px-5">
            <View className="items-center rounded-3xl border border-destructive/20 bg-destructive/10 px-6 py-10">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-destructive/15"><LucideIcon name="CircleAlert" className="h-5 w-5 text-destructive" /></View>
              <Text className="mt-4 font-bold text-foreground">Members unavailable</Text>
              <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage}</Text>
            </View>
          </PageContent>
        ) : (
          <PageContent className="px-5">
            <View className="mb-3 flex-row items-end justify-between">
              <View>
                <Text className="text-xl font-bold tracking-tight text-foreground">Students</Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">{isLoading ? "Loading live records…" : `${filtered.length} shown`}</Text>
              </View>
              <View className="h-8 w-8 items-center justify-center rounded-full bg-secondary"><LucideIcon name="UsersRound" className="h-4 w-4 text-secondary-foreground" /></View>
            </View>
            {isLoading ? (
              <View className="items-center rounded-3xl border border-border bg-card py-14">
                <View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary"><LoadingIndicator /></View>
                <Text className="mt-4 text-sm font-semibold text-foreground">Loading members</Text>
                <Text className="mt-1 text-sm text-muted-foreground">Pulling in the live academy roster.</Text>
              </View>
            ) : null}
            {!isLoading && filtered.length ? (
              <View className="gap-3">
                {filtered.map((student) => (
                  <MemberCard
                    key={student.studentId}
                    student={student}
                    onPress={() => router.push(`/members/${student.studentId}`)}
                  />
                ))}
              </View>
            ) : null}
            {!isLoading && !filtered.length ? (
              <View className="items-center rounded-3xl border border-dashed border-border bg-card px-5 py-12">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="SearchX" className="h-5 w-5 text-tertiary" /></View>
                <Text className="mt-4 font-bold text-foreground">No members found</Text>
                <Text className="mt-1 text-center text-sm leading-5 text-muted-foreground">Try another name or filter.</Text>
              </View>
            ) : null}
          </PageContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  clearHidden: {
    opacity: 0,
  },
  rowPressed: {
    opacity: 0.6,
  },
  memberCard: {
    alignSelf: 'stretch',
    minHeight: 104,
    width: '100%',
  },
  beltAccent: {
    width: 6,
  },
  secondaryBeltAccent: {
    flex: 1,
  },
});

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter members by ${label}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-10 flex-1 items-center justify-center rounded-full px-2.5 py-1.5 ${selected ? "bg-primary" : "bg-secondary active:bg-accent"}`}
    >
      <Text className={`text-xs font-bold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>{label}</Text>
    </Pressable>
  );
}

function MemberCard({ student, onPress }: { student: Student; onPress: () => void }) {
  const { theme } = useTheme();
  const programs = Array.isArray(student.programs) ? student.programs.filter(Boolean) : [];
  const belt = student.belt_rank.trim() || 'Rank not recorded';
  const stripeLabel = `${student.stripes} ${student.stripes === 1 ? 'stripe' : 'stripes'}`;
  const programLabel = programs.length ? programs.map(formatMemberProgram).join(' · ') : 'Program not specified';
  const beltColors = getBeltColorProfile(student.belt_rank, {
    primaryColor: theme.colors.secondary ?? '#E4E5DF',
    borderColor: theme.colors.border ?? '#7B837D',
    textColor: theme.colors.secondaryForeground ?? '#171B1A',
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${fullName(student)} profile`}
      onPress={onPress}
      className="overflow-hidden rounded-3xl border border-border bg-card active:bg-accent"
      style={({ pressed }) => [styles.memberCard, pressed ? styles.rowPressed : undefined]}
    >
      <View className="flex-1 flex-row">
        <View style={[styles.beltAccent, { backgroundColor: beltColors.primaryColor }]}>
          {beltColors.secondaryColor ? <View style={[styles.secondaryBeltAccent, { backgroundColor: beltColors.secondaryColor }]} /> : null}
        </View>
        <View className="min-w-0 flex-1 p-3">
          <View className="flex-row items-start gap-3">
            <MemberAvatar
              initials={studentInitials(student)}
              index={student.studentId}
              photoUrl={student.photo_url}
            />
            <View className="min-w-0 flex-1">
              <View className="flex-row items-start justify-between gap-2">
                <Text numberOfLines={1} className="flex-1 text-lg font-bold tracking-tight text-card-foreground">{fullName(student)}</Text>
                <LucideIcon name="ChevronRight" className="mt-0.5 h-5 w-5 text-muted-foreground" />
              </View>
              <View className="mt-1 flex-row items-center gap-2">
                <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-muted-foreground">{programLabel}</Text>
                <View className="rounded-full bg-secondary px-2 py-0.5">
                  <Text className={`text-[10px] font-bold ${isActiveStudent(student) ? 'text-success' : 'text-tertiary'}`}>{student.membership_status}</Text>
                </View>
              </View>
            </View>
          </View>
          <View className="mt-2 flex-row items-center gap-2">
            <View className="rounded-lg bg-primary/10 px-2.5 py-1"><Text className="text-xs font-bold text-primary">{belt}</Text></View>
            <View className="rounded-lg bg-secondary px-2.5 py-1"><Text className="text-xs font-bold text-secondary-foreground">{stripeLabel}</Text></View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function Stat({
  value,
  label,
  primary = false,
  divided = false,
}: {
  value: string;
  label: string;
  primary?: boolean;
  divided?: boolean;
}) {
  return (
    <View className={`min-w-0 flex-1 px-3 py-1.5 ${divided ? "border-l border-border" : ""}`}>
      <Text
        className={`text-xl font-bold ${primary ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </Text>
      <Text
        className="mt-0.5 text-[11px] font-semibold text-muted-foreground"
      >
        {label}
      </Text>
    </View>
  );
}
