import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { AcademyCheckInQr } from '@/components/gym/AcademyCheckInQr';
import { PageContent } from '@/components/layout/PageContent';
import LucideIcon from '@/lib/icons/LucideIcon';
import { academyCheckInUrl, reusableCheckInAcademyId } from '@/lib/academy-check-in-qr';
import { resolveActiveGymMembership } from '@/lib/database';
import { selfCheckInCapability, selfCheckInPreviewCapability } from '@/lib/self-check-in-feature';

export default function FamilyCheckInQrPreviewScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [isAuthorized, setIsAuthorized] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const qrUrl = academyCheckInUrl(reusableCheckInAcademyId);

  useFocusEffect(React.useCallback(() => {
    let current = true;
    setIsLoading(true);
    setErrorMessage(null);
    void resolveActiveGymMembership().then((membership) => {
      if (!current) return;
      const canManage = membership.gymId === reusableCheckInAcademyId
        && (membership.role === 'admin' || membership.role === 'coach');
      setIsAuthorized(canManage);
      if (!canManage) setErrorMessage('An active Gym 4 administrator or coach account is required to view the academy QR preview.');
    }).catch(() => {
      if (current) setErrorMessage('Academy access could not be verified.');
    }).finally(() => {
      if (current) setIsLoading(false);
    });
    return () => { current = false; };
  }, []));

  const print = () => {
    if (Platform.OS === 'web' && typeof globalThis.print === 'function') globalThis.print();
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/schedule');
  };

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView className="flex-1" contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}><PageContent className="px-5 pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-80"><LucideIcon name="ChevronLeft" className="h-6 w-6 text-secondary-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Academy QR</Text><View className="h-11 w-11" /></View></PageContent><PageContent className="px-5">{isLoading ? <View className="mt-10 items-center rounded-3xl border border-border bg-card py-12"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Verifying staff access…</Text></View> : null}{!isLoading && !isAuthorized ? <View className="mt-8 rounded-3xl border border-destructive/30 bg-destructive/10 p-6"><LucideIcon name="Lock" className="h-7 w-7 text-destructive" /><Text className="mt-4 text-xl font-bold text-foreground">QR preview unavailable</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{errorMessage}</Text></View> : null}{!isLoading && isAuthorized ? <><View className="mt-5 overflow-hidden rounded-3xl border border-primary/25 bg-card"><View className="h-1 bg-primary" /><View className="p-5"><Text className="text-xs font-bold uppercase tracking-[1.4px] text-primary">Development-only print preview</Text><Text className="mt-2 text-3xl font-bold tracking-tight text-card-foreground">Sandusky Bay Jiu Jitsu</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">This is one reusable academy QR code. It never contains a class, student, family, attendance record, or authorization credential.</Text></View></View><View className="mt-6 items-center rounded-3xl border border-border bg-white p-6"><AcademyCheckInQr value={qrUrl} /><Text selectable className="mt-5 text-center text-xs leading-5 text-[#171B1A]">{qrUrl}</Text></View><View className="mt-6 rounded-2xl border border-dashed border-border bg-muted/35 p-5"><View className="flex-row gap-3"><LucideIcon name="ShieldCheck" className="mt-0.5 h-5 w-5 text-primary" /><View className="flex-1"><Text className="font-bold text-foreground">What scanning does</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">The link opens the Gym 4 check-in entry route. Families must sign in and have approved access before they can see currently eligible classes or linked students. Scanning never records attendance.</Text></View></View></View>{Platform.OS === 'web' ? <Pressable accessibilityRole="button" accessibilityLabel="Print reusable academy QR code" onPress={print} className="mt-6 min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary px-5 active:opacity-85"><LucideIcon name="Printer" className="h-5 w-5 text-primary-foreground" /><Text className="font-bold text-primary-foreground">Print academy QR</Text></Pressable> : <View className="mt-6 rounded-2xl bg-muted px-5 py-4"><Text className="text-center text-sm leading-5 text-muted-foreground">Open this preview in the web app to print the academy QR poster.</Text></View>}<Text className="mt-4 text-center text-xs leading-4 text-muted-foreground">{selfCheckInPreviewCapability.reason} {selfCheckInCapability.reason}</Text></> : null}</PageContent></ScrollView></SafeAreaView>;
}
