import { Tabs } from 'expo-router';
import LucideIcon from '@/lib/icons/LucideIcon';
import { useTheme } from '@/theming/ThemeProvider';

const icons = {
  index: 'LayoutDashboard',
  schedule: 'CalendarDays',
  members: 'UsersRound',
  checkin: 'ScanLine',
  finance: 'WalletCards',
} as const;

export default function TabLayout() {
  const { theme } = useTheme();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.tertiary,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarStyle: { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border, height: 68, paddingTop: 7 },
        tabBarLabelStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
        tabBarIcon: ({ color, size }) => <LucideIcon name={icons[route.name as keyof typeof icons]} color={color} size={size} />,
      })}>
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="schedule" options={{ title: 'Classes' }} />
      <Tabs.Screen name="members" options={{ title: 'Members' }} />
      <Tabs.Screen name="checkin" options={{ title: 'Check-in' }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance' }} />
    </Tabs>
  );
}
