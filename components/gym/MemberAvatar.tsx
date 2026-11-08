import { View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/ui/text';

const colors = ['bg-secondary', 'bg-muted', 'bg-accent', 'bg-tertiary/15', 'bg-primary/15'];

export function MemberAvatar({
  initials,
  index = 0,
  size = 'md',
  photoUrl,
}: {
  initials: string;
  index?: number;
  size?: 'sm' | 'md';
  photoUrl?: string | null;
}) {
  const dimensions = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  return (
    <View className={`${dimensions} items-center justify-center overflow-hidden rounded-full ${colors[index % colors.length]}`}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} contentFit="cover" className="h-full w-full" />
      ) : (
        <Text className={size === 'sm' ? 'text-xs font-bold text-foreground' : 'text-sm font-bold text-foreground'}>{initials}</Text>
      )}
    </View>
  );
}
