import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { AcademyIdentity } from '@/components/gym/AcademyIdentity';
import { PageContent } from '@/components/layout/PageContent';
import { useGymAccess } from '@/providers/GymAccessProvider';
import { selfCheckInCapability, selfCheckInPreviewCapability } from '@/lib/self-check-in-feature';
import { academyCheckInUrl, reusableCheckInAcademyId } from '@/lib/academy-check-in-qr';

type PreviewStudent = {
  id: string;
  name: string;
  detail: string;
  status: 'eligible' | 'already-checked-in' | 'not-eligible';
};

const previewStudents: PreviewStudent[] = [
  { id: 'example-1', name: 'Example student', detail: 'Active · Kids program', status: 'eligible' },
  { id: 'example-2', name: 'Example sibling', detail: 'Trial · Kids program', status: 'eligible' },
  { id: 'example-3', name: 'Example attendee', detail: 'Already checked in', status: 'already-checked-in' },
  { id: 'example-4', name: 'Example member', detail: 'Paused membership · Not eligible', status: 'not-eligible' },
];

export default function FamilySelfCheckInPreviewScreen() {
  const router = useRouter();
  const { linkedGyms } = useGymAccess();
  const [selectedStudentIds, setSelectedStudentIds] = React.useState<Set<string>>(() => new Set());
  const gym = linkedGyms.find((item) => item.gym_id === 4) ?? null;
  const academyQrUrl = academyCheckInUrl(reusableCheckInAcademyId);

  const toggleStudent = (student: PreviewStudent) => {
    if (student.status !== 'eligible') return;
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (next.has(student.id)) next.delete(student.id);
      else next.add(student.id);
      return next;
    });
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/my-members');
  };

  return <SafeAreaView edges={['top']} className="flex-1 bg-background">
    <ScrollView className="flex-1" contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
      <PageContent className="px-5 pt-4">
        <View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-80"><LucideIcon name="ChevronLeft" className="h-6 w-6 text-secondary-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Check In</Text><View className="h-11 w-11" /></View>
      </PageContent>
      <PageContent className="px-5">
        <View className="mt-5 overflow-hidden rounded-3xl border border-primary/25 bg-card"><View className="h-1 bg-primary" /><View className="p-5"><View className="flex-row items-start justify-between gap-4"><View className="min-w-0 flex-1"><Text className="text-xs font-bold uppercase tracking-[1.4px] text-primary">Development preview · example data</Text><Text className="mt-2 text-3xl font-bold tracking-tight text-card-foreground">Check In</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Choose an available class and the family members you want to check in. Scanning a QR code will never record attendance by itself.</Text></View><View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><LucideIcon name="ScanLine" className="h-6 w-6 text-primary" /></View></View><View className="mt-5 border-t border-border pt-4"><AcademyIdentity name={gym?.gym_name ?? 'Sandusky Bay Jiu Jitsu'} logoUrl={gym?.logo_url} label="Academy" /><Text selectable className="mt-3 text-xs leading-4 text-muted-foreground">Reusable academy QR destination: {academyQrUrl}</Text></View></View></View>

        <View className="mt-6"><Text className="text-xl font-bold text-foreground">Class</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Example availability only — no live class schedule is being loaded.</Text><View className="mt-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"><View className="flex-row items-center justify-between gap-3"><View><Text className="font-bold text-foreground">Example Kids Fundamentals</Text><Text className="mt-1 text-sm text-muted-foreground">Saturday, September 20 · 6:00 PM · Kids audience</Text></View><View className="rounded-full bg-warning/15 px-2.5 py-1"><Text className="text-xs font-bold text-warning">Example open</Text></View></View><Text className="mt-3 text-sm leading-5 text-muted-foreground">Self-check-in opens 15 minutes before the scheduled start and remains available only while staff has enabled it and the class is In Progress.</Text></View></View>

        <View className="mt-7"><View className="flex-row items-end justify-between gap-3"><View><Text className="text-xl font-bold text-foreground">Family members</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Multiple eligible children can be selected together.</Text></View><Text className="text-sm font-bold text-primary">{selectedStudentIds.size} selected</Text></View><View className="mt-3 gap-3">{previewStudents.map((student) => <PreviewStudentRow key={student.id} student={student} selected={selectedStudentIds.has(student.id)} onPress={() => toggleStudent(student)} />)}</View></View>

        <View className="mt-7 rounded-2xl border border-dashed border-border bg-muted/35 p-5"><View className="flex-row gap-3"><LucideIcon name="Info" className="mt-0.5 h-5 w-5 text-primary" /><View className="flex-1"><Text className="font-bold text-foreground">Preview safeguards</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">{selfCheckInPreviewCapability.reason} Family links, eligibility, staff enablement, time windows, and duplicate protection will be verified on the server before any live check-in can exist.</Text></View></View></View>

        <View accessibilityState={{ disabled: true }} className="mt-5 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-muted px-5 opacity-70"><LucideIcon name="Lock" className="h-5 w-5 text-muted-foreground" /><Text className="font-bold text-muted-foreground">Check In unavailable</Text></View><Text className="mt-3 text-center text-xs leading-4 text-muted-foreground">No attendance is recorded in this preview. {selfCheckInCapability.reason}</Text>
      </PageContent>
    </ScrollView>
  </SafeAreaView>;
}

function PreviewStudentRow({ student, selected, onPress }: { student: PreviewStudent; selected: boolean; onPress: () => void }) {
  const isEligible = student.status === 'eligible';
  const statusText = student.status === 'already-checked-in' ? 'Already checked in' : student.status === 'not-eligible' ? 'Not eligible' : 'Eligible example';
  const statusClass = student.status === 'already-checked-in' ? 'text-success' : student.status === 'not-eligible' ? 'text-destructive' : 'text-primary';
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: !isEligible }} accessibilityLabel={`${student.name}, ${statusText}`} disabled={!isEligible} onPress={onPress} className={`flex-row items-center gap-3 rounded-2xl border p-4 ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'} ${isEligible ? 'active:bg-accent' : 'opacity-70'}`}><View className={`h-6 w-6 items-center justify-center rounded-md border-2 ${selected ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-card'}`}>{selected ? <LucideIcon name="Check" className="h-4 w-4 text-primary-foreground" strokeWidth={3} /> : null}</View><View className="min-w-0 flex-1"><Text className="font-bold text-card-foreground">{student.name}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{student.detail}</Text></View><Text className={`text-xs font-bold ${statusClass}`}>{statusText}</Text></Pressable>;
}
