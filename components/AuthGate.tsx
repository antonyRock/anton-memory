"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LoginScreen } from "@/components/LoginScreen";

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading, configError } = useAuth();

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite" className="auth-screen auth-screen-loading">
        <div className="auth-loading-card">
          <strong>
            <span className="brand-accent">T</span>Brain
          </strong>
          <span>Проверка сессии...</span>
        </div>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <strong>
              <span className="brand-accent">T</span>Brain
            </strong>
            <span>Auth не настроен</span>
          </div>
          <div className="auth-error">{configError}</div>
          <p className="auth-config-hint">
            Добавьте <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> в <code>.env.local</code> и
            перезапустите <code>npm run dev</code>.
            <br />
            Ключ: Supabase → Project Settings → API → <strong>anon public</strong>.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return children;
}
