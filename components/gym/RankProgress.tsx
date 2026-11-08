import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { getBeltColorProfile } from '@/lib/belt-colors';
import { useTheme } from '@/theming/ThemeProvider';

export function RankProgress({
  beltRank,
  stripes,
  variant = 'prominent',
}: {
  beltRank?: string | null;
  stripes?: number | null;
  variant?: 'compact' | 'prominent' | 'athlete';
}) {
  const { theme } = useTheme();
  const belt = getBeltColorProfile(beltRank, {
    primaryColor: theme.colors.secondary ?? '#E4E5DF',
    borderColor: theme.colors.border ?? '#7B837D',
    textColor: theme.colors.secondaryForeground ?? '#171B1A',
  });
  const stripeCount = Math.max(0, Math.min(4, stripes ?? 0));
  const rankName = beltRank?.trim() || 'Rank not recorded';
  const isCompact = variant === 'compact';
  const isAthlete = variant === 'athlete';

  return (
    <View
      accessibilityLabel={`Current rank: ${rankName}, ${stripeCount} ${stripeCount === 1 ? 'stripe' : 'stripes'}`}
      className={isCompact ? 'flex-row items-center' : isAthlete ? '' : 'overflow-hidden rounded-[24px] border border-border bg-card p-5'}
    >
      {!isCompact ? <Text className={isAthlete ? 'text-xs font-semibold text-muted-foreground' : 'text-sm font-medium text-muted-foreground'}>Current rank</Text> : null}
      <View
        style={[styles.belt, isCompact ? styles.compactBelt : isAthlete ? styles.athleteBelt : styles.prominentBelt, { backgroundColor: belt.primaryColor, borderColor: belt.borderColor }]}
      >
        <View style={[styles.beltAccent, { backgroundColor: belt.secondaryColor ?? belt.primaryColor }]} />
        <View style={[styles.stripeTrack, isCompact ? styles.compactStripeTrack : isAthlete ? styles.athleteStripeTrack : styles.prominentStripeTrack]}>
          {[0, 1, 2, 3].map((stripe) => (
            <View
              key={stripe}
              style={stripeStyle(stripe < stripeCount, belt.textColor, variant)}
            />
          ))}
        </View>
      </View>
      <View className={isCompact ? 'ml-3 min-w-0 flex-1' : isAthlete ? 'mt-4 flex-row items-end justify-between gap-3' : 'mt-5'}>
        <Text numberOfLines={1} className={isCompact ? 'text-base font-bold text-foreground' : isAthlete ? 'flex-1 text-2xl font-bold tracking-tight text-foreground' : 'text-2xl font-bold tracking-tight text-foreground'}>{rankName}</Text>
        <Text className={isCompact ? 'mt-0.5 text-xs font-medium text-muted-foreground' : isAthlete ? 'text-sm font-semibold text-muted-foreground' : 'mt-1.5 text-sm font-medium text-muted-foreground'}>
          {stripeCount} {stripeCount === 1 ? 'stripe' : 'stripes'} recorded
        </Text>
      </View>
    </View>
  );
}

function stripeStyle(isFilled: boolean, color: string, variant: 'compact' | 'prominent' | 'athlete') {
  return [
    styles.stripe,
    variant === 'compact' ? styles.compactStripe : variant === 'athlete' ? styles.athleteStripe : styles.prominentStripe,
    { backgroundColor: isFilled ? color : 'transparent', borderColor: color },
  ];
}

const styles = StyleSheet.create({
  belt: { borderRadius: 7, borderWidth: 1, overflow: 'hidden', position: 'relative' },
  prominentBelt: { height: 34, marginTop: 16, width: '100%' },
  athleteBelt: { height: 36, marginTop: 10, width: '100%' },
  compactBelt: { height: 20, width: 102 },
  beltAccent: { bottom: 0, left: 0, opacity: 0.64, position: 'absolute', top: 0, width: '29%' },
  stripeTrack: { alignItems: 'center', flexDirection: 'row', height: '100%', justifyContent: 'flex-end' },
  prominentStripeTrack: { gap: 6, paddingRight: 14 },
  athleteStripeTrack: { gap: 5, paddingRight: 12 },
  compactStripeTrack: { gap: 3, paddingRight: 8 },
  stripe: { borderRadius: 2, borderWidth: 1 },
  prominentStripe: { height: 21, width: 11 },
  athleteStripe: { height: 24, width: 11 },
  compactStripe: { height: 12, width: 7 },
});
