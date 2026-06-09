"use client";

import { FormEvent, useState } from "react";
import { ObsidianBackground } from "@/components/ObsidianBackground";
import { useAuth } from "@/components/AuthProvider";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Не удалось войти"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <ObsidianBackground />
      <div className="auth-card">
        <div className="auth-brand">
          <strong>
            <span className="brand-accent">T</span>Brain
          </strong>
          <span>Вход в личный чат</span>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              autoComplete="email"
              disabled={submitting}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          <label className="auth-field">
            <span>Пароль</span>
            <input
              autoComplete="current-password"
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
              type="password"
              value={password}
            />
          </label>

          {error ? <div className="auth-error">{error}</div> : null}

          <button className="auth-submit" disabled={submitting} type="submit">
            {submitting ? "Вход..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
