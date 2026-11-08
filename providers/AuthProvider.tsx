import * as React from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearDatabaseSession } from '@/lib/database';

type AuthContextValue = {
  session: Session | null;
  isRestoringSession: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [isRestoringSession, setIsRestoringSession] = React.useState(true);
  const activeUserIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    const restoreSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (isMounted) {
        activeUserIdRef.current = data.session?.user.id ?? null;
        setSession(data.session);
        setIsRestoringSession(false);
      }
    };

    void restoreSession();

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        const nextUserId = nextSession?.user.id ?? null;
        if (activeUserIdRef.current !== nextUserId) clearDatabaseSession();
        activeUserIdRef.current = nextUserId;
        setSession(nextSession);
        setIsRestoringSession(false);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => {
      isMounted = false;
      authSubscription.subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  const value = React.useMemo<AuthContextValue>(() => ({
    session,
    isRestoringSession,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    async signOut() {
      clearDatabaseSession();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
    },
  }), [isRestoringSession, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
