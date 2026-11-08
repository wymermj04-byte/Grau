import * as React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import LucideIcon from '@/lib/icons/LucideIcon';
import { normalizeGymLogoUrl } from '@/lib/gym-logo';

export function GymLogo({ source }: { source?: string | null }) {
  const logoUrl = normalizeGymLogoUrl(source);
  const [hasLoadError, setHasLoadError] = React.useState(false);

  React.useEffect(() => {
    setHasLoadError(false);
  }, [logoUrl]);

  return (
    <View style={styles.container} className="bg-tertiary">
      {logoUrl && !hasLoadError ? (
        <Image
          accessibilityLabel="Gym logo"
          resizeMode="contain"
          source={{ uri: logoUrl }}
          style={styles.image}
          onError={() => setHasLoadError(true)}
        />
      ) : (
        <LucideIcon name="Shield" className="h-5 w-5 text-tertiary-foreground" strokeWidth={2.6} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: 16,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  image: {
    height: '100%',
    width: '100%',
  },
});
