import { Redirect } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

export default function Index() {
  const { session } = useAuth();
  const { accessStatus } = useGymAccess();
  return <Redirect href={!session ? '/sign-in' : accessStatus === 'staff' ? '/(tabs)' : '/my-members'} />;
}
