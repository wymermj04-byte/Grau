import * as React from 'react';
import { canSetPasswordFromAuthCallback } from '@/lib/password-setup';
import { useAuth } from '@/providers/AuthProvider';

type PasswordSetupContextValue = {
  canSetPassword: boolean;
  beginPasswordSetup: (userId: string) => void;
  clearPasswordSetup: () => void;
};

const PasswordSetupContext = React.createContext<PasswordSetupContextValue | null>(null);

export function PasswordSetupProvider({ children }: React.PropsWithChildren) {
  const { session } = useAuth();
  const [pendingUserId, setPendingUserId] = React.useState<string | null>(null);
  const sessionUserId = session?.user.id ?? null;

  React.useEffect(() => {
    setPendingUserId((currentUserId) => (currentUserId && currentUserId !== sessionUserId ? null : currentUserId));
  }, [sessionUserId]);

  const value = React.useMemo<PasswordSetupContextValue>(() => ({
    canSetPassword: canSetPasswordFromAuthCallback(pendingUserId, sessionUserId),
    beginPasswordSetup: (userId) => setPendingUserId(userId),
    clearPasswordSetup: () => setPendingUserId(null),
  }), [pendingUserId, sessionUserId]);

  return <PasswordSetupContext.Provider value={value}>{children}</PasswordSetupContext.Provider>;
}

export function usePasswordSetup() {
  const context = React.useContext(PasswordSetupContext);
  if (!context) throw new Error('usePasswordSetup must be used within a PasswordSetupProvider.');
  return context;
}
