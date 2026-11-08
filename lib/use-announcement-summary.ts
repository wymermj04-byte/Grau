import * as React from 'react';
import { useFocusEffect } from 'expo-router';
import { listAnnouncements, listMyReadReceipts, type Announcement } from '@/lib/announcements';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

export function useAnnouncementSummary() {
  const { session } = useAuth();
  const { accessError, accessStatus, isResolvingAccess } = useGymAccess();
  const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
  const [readAnnouncementIds, setReadAnnouncementIds] = React.useState<Set<number>>(new Set());
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const hasLoadedRef = React.useRef(false);

  const accessScope = session?.user.id && !isResolvingAccess && !accessError && (accessStatus === 'staff' || accessStatus === 'family')
    ? `${session.user.id}:${accessStatus}`
    : null;
  const accessScopeRef = React.useRef<string | null>(accessScope);

  React.useEffect(() => {
    accessScopeRef.current = accessScope;
    requestIdRef.current += 1;
    hasLoadedRef.current = false;
    setAnnouncements([]);
    setReadAnnouncementIds(new Set());
    setUnreadCount(0);
    setIsLoading(false);
    setError(null);
  }, [accessScope]);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      const requestScope = accessScope;
      const requestId = ++requestIdRef.current;

      if (!requestScope) {
        setIsLoading(false);
        return () => {
          isActive = false;
        };
      }

      async function loadSummary() {
        if (!hasLoadedRef.current) setIsLoading(true);
        setError(null);

        try {
          const [announcements, readReceipts] = await Promise.all([
            listAnnouncements(),
            listMyReadReceipts(),
          ]);
          if (!isActive || requestId !== requestIdRef.current || requestScope !== accessScopeRef.current) return;

          const readAnnouncementIds = new Set(readReceipts.map((receipt) => receipt.announcementId));
          setAnnouncements(announcements);
          setReadAnnouncementIds(readAnnouncementIds);
          setUnreadCount(announcements.reduce(
            (count, announcement) => count + (readAnnouncementIds.has(announcement.id) ? 0 : 1),
            0,
          ));
          hasLoadedRef.current = true;
        } catch {
          if (!isActive || requestId !== requestIdRef.current || requestScope !== accessScopeRef.current) return;
          setAnnouncements([]);
          setReadAnnouncementIds(new Set());
          setUnreadCount(0);
          setError('Announcements are unavailable.');
        } finally {
          if (isActive && requestId === requestIdRef.current && requestScope === accessScopeRef.current) {
            setIsLoading(false);
          }
        }
      }

      void loadSummary();
      return () => {
        isActive = false;
      };
    }, [accessScope]),
  );

  return { announcements, readAnnouncementIds, unreadCount, isLoading, error };
}
