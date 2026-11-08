import * as React from 'react';
import { AppState } from 'react-native';
import { GymMembershipError, resolveActiveGymMembership } from '@/lib/database';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export type LinkedMember = {
  student_id: number;
  gym_id: number;
  first_name: string | null;
  last_name: string | null;
  belt_rank: string | null;
  stripes: number | null;
  membership_status: string | null;
  waiver_signed: boolean | null;
  photo_url: string | null;
  programs: string[] | null;
};

export type LinkedGym = {
  gym_id: number;
  gym_name: string | null;
  logo_url: string | null;
};

type GymAccessContextValue = {
  gymId: number | null;
  staffRole: 'admin' | 'coach' | null;
  isResolvingAccess: boolean;
  accessStatus: 'staff' | 'family' | 'unlinked' | 'selection-required' | 'lookup-failed';
  accessError: string | null;
  linkedMembers: LinkedMember[];
  linkedGyms: LinkedGym[];
  refreshAccess: () => Promise<void>;
};

const GymAccessContext = React.createContext<GymAccessContextValue | null>(null);

export function GymAccessProvider({ children }: React.PropsWithChildren) {
  const { session } = useAuth();
  const [gymId, setGymId] = React.useState<number | null>(null);
  const [staffRole, setStaffRole] = React.useState<GymAccessContextValue['staffRole']>(null);
  const [resolvedUserId, setResolvedUserId] = React.useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [accessStatus, setAccessStatus] = React.useState<GymAccessContextValue['accessStatus']>('unlinked');
  const [accessError, setAccessError] = React.useState<string | null>(null);
  const [linkedMembers, setLinkedMembers] = React.useState<LinkedMember[]>([]);
  const [linkedGyms, setLinkedGyms] = React.useState<LinkedGym[]>([]);
  const isResolvingAccess = Boolean(session) && resolvedUserId !== session?.user.id;

  const refreshAccess = React.useCallback(async () => {
    setResolvedUserId(null);
    setRefreshVersion((version) => version + 1);
  }, []);

  React.useEffect(() => {
    let isCurrent = true;
    setGymId(null);
    setStaffRole(null);
    setAccessStatus('unlinked');
    setAccessError(null);
    setLinkedMembers([]);
    setLinkedGyms([]);

    if (!session) {
      setResolvedUserId(null);
      return () => {
        isCurrent = false;
      };
    }

    const resolveAccess = async () => {
      const loadLinkedGyms = async () => {
        const { data, error } = await supabase.rpc('my_linked_gyms');
        return error ? [] : (data ?? []) as LinkedGym[];
      };

      try {
        const activeMembership = await resolveActiveGymMembership();
        if (!isCurrent) return;
        const { data, error } = await supabase.rpc('my_linked_members');
        if (error) throw error;
        const nextLinkedGyms = await loadLinkedGyms();
        if (!isCurrent) return;
        setGymId(activeMembership.gymId);
        setStaffRole(activeMembership.role === 'admin' || activeMembership.role === 'coach' ? activeMembership.role : null);
        setLinkedMembers((data ?? []) as LinkedMember[]);
        setLinkedGyms(nextLinkedGyms);
        setAccessStatus('staff');
      } catch (error: unknown) {
        if (!isCurrent) return;
        if (error instanceof GymMembershipError) {
          if (error.reason !== 'no-access') {
            setAccessStatus('selection-required');
            setAccessError(error.message);
            return;
          }
          try {
            const { data, error: linkedMembersError } = await supabase.rpc('my_linked_members');
            if (linkedMembersError) throw linkedMembersError;
            const nextLinkedGyms = await loadLinkedGyms();
            if (!isCurrent) return;
            const nextLinkedMembers = (data ?? []) as LinkedMember[];
            setLinkedMembers(nextLinkedMembers);
            setLinkedGyms(nextLinkedGyms);
            setAccessStatus(nextLinkedMembers.length > 0 ? 'family' : 'unlinked');
          } catch {
            if (!isCurrent) return;
            setAccessStatus('lookup-failed');
            setAccessError('Member access could not be verified. Try again.');
          }
          return;
        }
        setAccessStatus('lookup-failed');
        setAccessError('Gym access could not be verified. Try again.');
      } finally {
        if (isCurrent) setResolvedUserId(session.user.id);
      }
    };

    void resolveAccess();

    return () => {
      isCurrent = false;
    };
  }, [refreshVersion, session?.user.id]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && session) void refreshAccess();
    });
    return () => subscription.remove();
  }, [refreshAccess, session]);

  const value = React.useMemo<GymAccessContextValue>(
    () => ({ gymId, staffRole, isResolvingAccess, accessStatus, accessError, linkedMembers, linkedGyms, refreshAccess }),
    [accessError, accessStatus, gymId, isResolvingAccess, linkedGyms, linkedMembers, refreshAccess, staffRole],
  );

  return <GymAccessContext.Provider value={value}>{children}</GymAccessContext.Provider>;
}

export function useGymAccess() {
  const context = React.useContext(GymAccessContext);
  if (!context) throw new Error('useGymAccess must be used within a GymAccessProvider.');
  return context;
}
