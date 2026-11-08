import * as React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import LucideIcon from '@/lib/icons/LucideIcon';
import { isReusableCheckInAcademy } from '@/lib/academy-check-in-qr';
import { isSelfCheckInEnabledForGym, selfCheckInCapability } from '@/lib/self-check-in-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

function parseGymId(value: string | undefined) {
  const gymId = Number(value);
  return Number.isSafeInteger(gymId) && gymId > 0 ? gymId : null;
}

export default function AcademyCheckInLinkScreen() {
  const { gymId: routeGymId } = useLocalSearchParams<{ gymId?: string }>();
  const { session } = useAuth();
  const { accessStatus, isResolvingAccess, linkedGyms } = useGymAccess();
  const gymId = parseGymId(routeGymId);

  if (!isReusableCheckInAcademy(gymId)) {
    return <Unavailable title="Check-in link unavailable" detail="This academy does not have a reusable family check-in link." />;
  }

  if (!session) {
    return <Redirect href={{ pathname: '/sign-in', params: { returnTo: `/check-in/${gymId}` } }} />;
  }

  if (isResolvingAccess) {
    return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><LoadingIndicator /><Text className="mt-3 text-center text-sm text-muted-foreground">Verifying family access…</Text></View></SafeAreaView>;
  }

  const hasApprovedFamilyAccess = (accessStatus === 'family' || accessStatus === 'staff')
    && linkedGyms.some((gym) => gym.gym_id === gymId);

  if (!hasApprovedFamilyAccess) {
    return <Unavailable title="Family access required" detail="Sign in with an approved family account linked to this academy to request check-in." />;
  }

  if (!isSelfCheckInEnabledForGym(gymId)) {
    return <Unavailable title="Check-in unavailable" detail={selfCheckInCapability.reason} />;
  }

  return <Redirect href={`/family-check-in/${gymId}`} />;
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><View className="w-full max-w-sm items-center rounded-3xl border border-border bg-card px-6 py-9"><LucideIcon name="Lock" className="h-8 w-8 text-muted-foreground" /><Text className="mt-4 text-center text-xl font-bold text-foreground">{title}</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{detail}</Text></View></View></SafeAreaView>;
}
