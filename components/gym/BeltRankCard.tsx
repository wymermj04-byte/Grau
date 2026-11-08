import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { getBeltColorProfile } from '@/lib/belt-colors';
import { useTheme } from '@/theming/ThemeProvider';

type RecordedStripes = number | string | null | undefined;

function normalizeRecordedStripes(value: RecordedStripes) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function BeltRankCard({ beltRank, stripes, embedded = false }: { beltRank: string; stripes: RecordedStripes; embedded?: boolean }) {
  const { theme } = useTheme();
  const belt = getBeltColorProfile(beltRank, {
    primaryColor: theme.colors.secondary ?? '#E4E5DF',
    borderColor: theme.colors.border ?? '#7B837D',
    textColor: theme.colors.secondaryForeground ?? '#171B1A',
  });
  const rankName = beltRank.trim() || 'Rank not recorded';
  const recordedStripes = normalizeRecordedStripes(stripes);
  const renderedStripes = Math.min(4, recordedStripes);

  return (
    <View
      style={embedded ? styles.embeddedCard : [styles.card, { backgroundColor: theme.colors.card ?? '#29302C', borderColor: theme.colors.border ?? '#7B837D' }]}
      accessibilityLabel={`BJJ belt visualization: ${rankName} belt with a black rank bar and ${recordedStripes} recorded ${recordedStripes === 1 ? 'white stripe' : 'white stripes'}`}>
      <View
        accessible={false}
        pointerEvents="none"
        style={[styles.belt, { backgroundColor: belt.primaryColor, borderColor: belt.borderColor }]}
      >
        {belt.secondaryColor ? <View style={[styles.secondaryBeltColor, { backgroundColor: belt.secondaryColor }]} /> : null}
        <View style={styles.beltHighlight} />
        <View style={styles.rankBar}>
          <View style={styles.stripeTrack}>
            {[0, 1, 2, 3].map((stripe) => (
              <View key={stripe} style={[styles.stripe, stripe < renderedStripes ? styles.filledStripe : styles.emptyStripe]} />
            ))}
          </View>
        </View>
      </View>
      <View style={styles.content}>
        <View style={styles.rankCopy}>
          <Text style={[styles.eyebrow, { color: theme.colors.mutedForeground ?? '#7B837D' }]}>BJJ BELT</Text>
          <Text numberOfLines={1} style={[styles.rank, { color: theme.colors.foreground ?? '#171B1A' }]}>{rankName}</Text>
        </View>
        <View style={styles.rankDetail}>
          <View style={[styles.rankDot, { backgroundColor: belt.primaryColor, borderColor: belt.borderColor }]} />
          <Text style={[styles.stripeText, { color: theme.colors.foreground ?? '#171B1A' }]}>{recordedStripes} {recordedStripes === 1 ? 'stripe' : 'stripes'} recorded</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  embeddedCard: {},
  card: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 16,
  },
  belt: {
    borderRadius: 16,
    borderWidth: 1,
    height: 74,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  secondaryBeltColor: { bottom: 0, left: 0, position: 'absolute', top: 0, width: '50%' },
  beltHighlight: { backgroundColor: 'rgba(255,255,255,0.16)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  rankBar: { alignItems: 'center', backgroundColor: '#171B1A', borderColor: '#07090A', borderLeftWidth: 1, borderRadius: 5, borderRightWidth: 1, height: 74, justifyContent: 'center', position: 'absolute', right: 28, top: 0, width: 80 },
  stripeTrack: { flexDirection: 'row', gap: 5 },
  stripe: { borderRadius: 1, height: 42, width: 7 },
  filledStripe: { backgroundColor: '#FFFFFF', borderColor: '#F7F5EF', borderWidth: 1 },
  emptyStripe: { backgroundColor: 'rgba(247,245,239,0.25)' },
  content: {
    alignItems: 'flex-start',
    paddingTop: 16,
  },
  rankCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  rank: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginTop: 5,
  },
  rankDetail: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 9,
  },
  rankDot: { borderRadius: 8, borderWidth: 1, height: 16, width: 16 },
  stripeText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
