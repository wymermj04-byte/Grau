import { View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';

function PageContent({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn('w-full max-w-5xl self-center', className)} {...props} />;
}

export { PageContent };
