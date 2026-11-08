import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { ThemedTextInput } from '@/components/ui/themed-text-input';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { DraftbitRestApiError } from '@/draftbit-api';
import { database } from '@/lib/database';

type GymSettings = {
  id: number;
  gym_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
};

type GymForm = {
  gym_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logo_url: string;
};

function formFromGym(gym: GymSettings): GymForm {
  return {
    gym_name: gym.gym_name ?? '',
    address: gym.address ?? '',
    phone: gym.phone ?? '',
    email: gym.email ?? '',
    website: gym.website ?? '',
    logo_url: gym.logo_url ?? '',
  };
}

function gymUpdateError(error: unknown) {
  if (error instanceof DraftbitRestApiError) {
    try {
      const response = JSON.parse(error.responseText ?? '') as { message?: string; details?: string };
      if (response.message) return `Gym information could not be saved: ${response.message}`;
      if (response.details) return `Gym information could not be saved: ${response.details}`;
    } catch {
      // The endpoint did not return a JSON error body.
    }
    return `Gym information could not be saved (HTTP ${error.status}). Try again.`;
  }
  return error instanceof Error && error.message ? `Gym information could not be saved: ${error.message}` : 'Gym information could not be saved. Try again.';
}

export default function GymInformationScreen() {
  const router = useRouter();
  const [gym, setGym] = React.useState<GymSettings | null>(null);
  const [form, setForm] = React.useState<GymForm>({ gym_name: '', address: '', phone: '', email: '', website: '', logo_url: '' });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [multipleGyms, setMultipleGyms] = React.useState(false);

  const loadGym = React.useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setErrorMessage(null);
    setMultipleGyms(false);
    try {
      const gyms = await database.listGymSettings<GymSettings>();
      if (gyms.length !== 1) {
        setGym(null);
        setMultipleGyms(gyms.length > 1);
        return null;
      }
      const liveGym = gyms[0];
      setGym(liveGym);
      setForm(formFromGym(liveGym));
      return liveGym;
    } catch (error) {
      setGym(null);
      setErrorMessage(error instanceof Error && error.message ? `Gym information could not be loaded: ${error.message}` : 'Gym information could not be loaded. Try again.');
      return null;
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useFocusEffect(React.useCallback(() => { loadGym(); }, [loadGym]));

  const updateField = (field: keyof GymForm, value: string) => {
    setSuccessMessage(null);
    setErrorMessage(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const unchanged = gym ? Object.entries(formFromGym(gym)).every(([field, value]) => form[field as keyof GymForm] === value) : true;

  const saveGym = async () => {
    if (!gym || isSaving || unchanged || multipleGyms) return;
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      await database.updateGymSettings(gym.id, form);
      const refreshedGym = await loadGym(false);
      if (refreshedGym) setSuccessMessage('Gym information saved and refreshed.');
    } catch (error) {
      setErrorMessage(gymUpdateError(error));
    } finally {
      setIsSaving(false);
    }
  };

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View className="flex-row items-center justify-between pt-4"><Pressable accessibilityRole="button" accessibilityLabel="Back to settings" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/settings'); }} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="text-lg font-bold text-foreground">Gym Information</Text><View className="h-10 w-10" /></View>{isLoading ? <LoadingState /> : null}{!isLoading && multipleGyms ? <MultipleGymsState /> : null}{!isLoading && !multipleGyms && !gym && !errorMessage ? <NoGymState /> : null}{!isLoading && errorMessage && !gym ? <ErrorState message={errorMessage} onRetry={() => loadGym()} /> : null}{!isLoading && gym ? <View className="pt-7"><View className="rounded-2xl bg-secondary p-4"><View className="flex-row items-center gap-3"><View className="h-10 w-10 items-center justify-center rounded-xl bg-tertiary/15"><LucideIcon name="Building2" className="h-5 w-5 text-tertiary" /></View><View className="flex-1"><Text className="font-bold text-secondary-foreground">Live gym record</Text><Text className="mt-1 text-xs text-muted-foreground">Changes are saved to the selected gym only.</Text></View></View></View><Text className="mb-3 mt-7 text-xl font-bold tracking-tight text-foreground">Gym details</Text><FormField label="Gym name" value={form.gym_name} onChangeText={(value) => updateField('gym_name', value)} autoCapitalize="words" /><FormField label="Address" value={form.address} onChangeText={(value) => updateField('address', value)} autoCapitalize="words" multiline /><FormField label="Phone" value={form.phone} onChangeText={(value) => updateField('phone', value)} keyboardType="phone-pad" /><FormField label="Email" value={form.email} onChangeText={(value) => updateField('email', value)} keyboardType="email-address" autoCapitalize="none" /><FormField label="Website" value={form.website} onChangeText={(value) => updateField('website', value)} autoCapitalize="none" autoCorrect={false} /><FormField label="Logo URL" value={form.logo_url} onChangeText={(value) => updateField('logo_url', value)} autoCapitalize="none" autoCorrect={false} />{successMessage ? <View className="mt-5 flex-row gap-2 rounded-2xl bg-success/15 px-4 py-3"><LucideIcon name="CircleCheck" className="mt-0.5 h-5 w-5 text-success" /><Text className="flex-1 text-sm leading-5 text-foreground">{successMessage}</Text></View> : null}{errorMessage ? <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/10 px-4 py-3"><LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" /><Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text></View> : null}<Pressable accessibilityRole="button" accessibilityLabel="Save gym information" disabled={unchanged || isSaving} onPress={saveGym} className={`mt-7 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${unchanged || isSaving ? 'opacity-60' : ''}`}>{isSaving ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="Save" className="h-5 w-5 text-primary-foreground" />}<Text className="font-bold text-primary-foreground">{isSaving ? 'Saving gym information…' : 'Save changes'}</Text></Pressable></View> : null}</ScrollView></SafeAreaView>;
}

function FormField({ label, value, onChangeText, multiline = false, ...inputProps }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad'; autoCapitalize?: 'none' | 'words'; autoCorrect?: boolean }) {
  return <View className="mt-5"><Text className="mb-2 font-bold text-foreground">{label}</Text><View className={`rounded-2xl border border-border bg-card px-4 py-3 ${multiline ? 'min-h-[88px]' : ''}`}><ThemedTextInput value={value} onChangeText={onChangeText} placeholder={label} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} className="flex-1 text-base text-foreground" {...inputProps} /></View></View>;
}

function LoadingState() { return <View className="items-center py-24"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading gym information…</Text></View>; }
function NoGymState() { return <View className="items-center py-24"><LucideIcon name="Building2" className="mb-3 h-7 w-7 text-muted-foreground" /><Text className="text-lg font-bold text-foreground">No gym information found</Text><Text className="mt-2 max-w-[280px] text-center text-sm leading-5 text-muted-foreground">A gym record is required before it can be edited.</Text></View>; }
function MultipleGymsState() { return <View className="mt-12 items-center rounded-3xl bg-warning/15 px-6 py-10"><LucideIcon name="Building2" className="mb-3 h-7 w-7 text-warning" /><Text className="text-center text-lg font-bold text-foreground">Choose a gym first</Text><Text className="mt-2 max-w-[300px] text-center text-sm leading-5 text-muted-foreground">More than one gym record is available. Authenticated gym selection is needed before this screen can safely edit a record.</Text></View>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <View className="mt-12 items-center rounded-3xl bg-destructive/10 px-6 py-10"><LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" /><Text className="text-center text-lg font-bold text-foreground">Gym information unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading gym information" onPress={onRetry} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">Retry</Text></Pressable></View>; }
