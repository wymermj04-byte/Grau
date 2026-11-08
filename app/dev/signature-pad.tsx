import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignaturePad } from '@/components/gym/SignaturePad';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';

export default function SignaturePadPreviewScreen() {
  const router = useRouter();
  const [hasSignature, setHasSignature] = React.useState(false);
  const [isDrawing, setIsDrawing] = React.useState(false);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/settings');
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-10"
        scrollEnabled={!isDrawing}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full max-w-xl self-center pt-4">
          <View className="flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Settings"
              onPress={goBack}
              className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
            >
              <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">Signature pad test</Text>
            <View className="h-11 w-11" />
          </View>

          <View className="mt-7 rounded-3xl bg-primary p-5">
            <Text className="text-sm font-bold tracking-wide text-primary-foreground">
              TEST ONLY — NOTHING IS SAVED.
            </Text>
            <Text className="mt-2 text-2xl font-bold text-primary-foreground">
              Try a real touch signature.
            </Text>
            <Text className="mt-2 text-sm leading-5 text-primary-foreground/75">
              Draw with a finger or stylus, use Clear, then return when you are done. This preview has no submit action and never calls Supabase, Storage, or waiver finalization.
            </Text>
          </View>

          <View className="mt-6">
            <SignaturePad
              onChange={(signatureSvg) => setHasSignature(Boolean(signatureSvg))}
              onGestureStateChange={setIsDrawing}
            />
          </View>

          <View className={`mt-5 rounded-2xl px-4 py-3 ${hasSignature ? 'bg-success/15' : 'bg-secondary'}`}>
            <Text className={`text-sm font-semibold ${hasSignature ? 'text-foreground' : 'text-secondary-foreground'}`}>
              {hasSignature ? 'Signature is held only in this screen while you test it.' : 'Draw a signature to verify touch input.'}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Settings"
            onPress={goBack}
            className="mt-7 min-h-12 items-center justify-center rounded-2xl bg-secondary px-5 active:bg-accent"
          >
            <Text className="font-bold text-secondary-foreground">Back</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
