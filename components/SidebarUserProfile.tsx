"use client";

import { BarChart3, LogOut, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useAuthFetch } from "@/hooks/useAuthFetch";

type UserProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  tagline: string;
};

type UserStats = {
  chats: number;
  words: number;
  days: number;
};

type SidebarUserProfileProps = {
  onSettings: () => void;
  onNotify?: (message: string) => void;
};

const STATS_CACHE_KEY = "tbrainUserStatsCache";
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;

const EMPTY_STATS: UserStats = { chats: 0, words: 0, days: 0 };

const DEFAULT_PROFILE: UserProfile = {
  id: "f224756a-d4ae-4f09-a315-9991c03ebe84",
  displayName: "Антон",
  avatarUrl: null,
  tagline: "Ты можешь всё!"
};

function formatStatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.max(0, value));
}

function profileInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function readStatsCache():
  | {
      stats: UserStats;
      fetchedAt: number;
    }
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STATS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { stats?: UserStats; fetchedAt?: number };
    if (!parsed.stats || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > STATS_CACHE_TTL_MS) return null;
    return { stats: parsed.stats, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeStatsCache(stats: UserStats) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STATS_CACHE_KEY,
      JSON.stringify({ stats, fetchedAt: Date.now() })
    );
  } catch {
    // ignore quota errors
  }
}

export function SidebarUserProfile({ onSettings, onNotify }: SidebarUserProfileProps) {
  const { session, signOut } = useAuth();
  const { authFetch } = useAuthFetch();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [stats, setStats] = useState<UserStats>(EMPTY_STATS);

  useEffect(() => {
    const cached = readStatsCache();
    if (cached) setStats(cached.stats);

    const handle = window.setTimeout(async () => {
      try {
        const response = await authFetch("/api/user");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить профиль");

        if (data.profile) {
          setProfile({
            ...(data.profile as UserProfile),
            displayName:
              session?.user.email?.split("@")[0] ??
              (data.profile as UserProfile).displayName
          });
        }
        if (data.stats) {
          const nextStats = data.stats as UserStats;
          setStats(nextStats);
          writeStatsCache(nextStats);
        }
      } catch {
        setStats((current) => current ?? EMPTY_STATS);
      }
    }, 0);

    return () => window.clearTimeout(handle);
  }, [authFetch, session?.user.email]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function notify(message: string) {
    onNotify?.(message);
    setMenuOpen(false);
  }

  return (
    <div className="sidebar-footer" ref={rootRef}>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="sidebar-user-profile"
        onClick={() => setMenuOpen((current) => !current)}
        type="button"
      >
        {profile.avatarUrl ? (
          <img alt="" className="sidebar-user-avatar" src={profile.avatarUrl} />
        ) : (
          <span aria-hidden className="sidebar-user-avatar sidebar-user-avatar-fallback">
            {profileInitial(profile.displayName)}
          </span>
        )}

        <span className="sidebar-user-copy">
          <span className="sidebar-user-name">{profile.displayName}</span>
          <span className="sidebar-user-tagline">{profile.tagline}</span>
          <span className="sidebar-user-stats">
            Чатов:{" "}
            <span className="sidebar-user-stat-value">{formatStatNumber(stats.chats)}</span> · Слов:{" "}
            <span className="sidebar-user-stat-value">{formatStatNumber(stats.words)}</span> · Дней:{" "}
            <span className="sidebar-user-stat-value">{formatStatNumber(stats.days)}</span>
          </span>
        </span>
      </button>

      {menuOpen ? (
        <div className="sidebar-user-menu" role="menu">
          <button
            className="sidebar-user-menu-item"
            onClick={() => notify("Профиль скоро появится")}
            role="menuitem"
            type="button"
          >
            <UserRound size={16} />
            Профиль
          </button>
          <button
            className="sidebar-user-menu-item"
            onClick={() => {
              onSettings();
              setMenuOpen(false);
            }}
            role="menuitem"
            type="button"
          >
            <Settings size={16} />
            Настройки
          </button>
          <button
            className="sidebar-user-menu-item"
            onClick={() => notify("Статистика уже показана в блоке профиля")}
            role="menuitem"
            type="button"
          >
            <BarChart3 size={16} />
            Статистика
          </button>
          <button
            className="sidebar-user-menu-item sidebar-user-menu-item-muted"
            onClick={() => {
              void signOut().then(() => {
                window.sessionStorage.removeItem(STATS_CACHE_KEY);
                notify("Вы вышли из аккаунта");
              });
            }}
            role="menuitem"
            type="button"
          >
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
