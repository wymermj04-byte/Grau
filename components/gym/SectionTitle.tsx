import { View } from 'react-native';
import { Text } from '@/components/ui/text';

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <View className="mb-3 flex-row items-end justify-between">
      <Text className="text-xl font-bold tracking-tight text-foreground">{title}</Text>
      {detail ? <Text className="text-sm font-medium text-tertiary">{detail}</Text> : null}
    </View>
  );
}
