import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { GymLogo } from '@/components/gym/GymLogo';

export function AcademyIdentity({
  name,
  logoUrl,
  label = 'Academy',
}: {
  name?: string | null;
  logoUrl?: string | null;
  label?: string;
}) {
  const academyName = name?.trim() || 'Academy';

  return (
    <View className="flex-row items-center gap-3">
      <GymLogo source={logoUrl} />
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
        <Text numberOfLines={1} className="mt-0.5 text-sm font-bold text-foreground">{academyName}</Text>
      </View>
    </View>
  );
}
