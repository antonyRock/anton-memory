"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { clearUserClientState } from "@/lib/auth-client-state";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  configError: string | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSupabase(getSupabaseBrowserClient());
    } catch (error) {
      setConfigError(
        error instanceof Error
          ? error.message
          : "Supabase Auth is not configured on the client."
      );
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        return { error: configError ?? "Supabase Auth is not ready yet." };
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        return { error: error.message };
      }

      return {};
    },
    [configError, supabase]
  );

  const signOut = useCallback(async () => {
    setSession(null);
    setLoading(false);
    clearUserClientState();

    if (!supabase) return;

    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      throw error;
    }
  }, [supabase]);

  const value = useMemo(
    () => ({
      session,
      loading,
      configError,
      signIn,
      signOut
    }),
    [session, loading, configError, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
