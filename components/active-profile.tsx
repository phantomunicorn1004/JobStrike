"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { CandidateAvatar } from "@/components/candidate-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "jobstrike.activeProfileId";

export type ActiveProfileOption = { id: number; full_name: string };

type ActiveProfileValue = {
  profiles: ActiveProfileOption[];
  /** null = all candidates. */
  profileId: number | null;
  profile: ActiveProfileOption | null;
  setProfileId: (id: number | null) => void;
  /** The saved choice has been read; pages can trust profileId. */
  ready: boolean;
};

const ActiveProfileContext = createContext<ActiveProfileValue>({
  profiles: [],
  profileId: null,
  profile: null,
  setProfileId: () => {},
  ready: true,
});

export function useActiveProfile(): ActiveProfileValue {
  return useContext(ActiveProfileContext);
}

function readSaved(): number | null {
  try {
    const id = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function ActiveProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<ActiveProfileOption[]>([]);
  const [profileId, setId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setId(readSaved());
    setReady(true);
    void fetch("/api/profiles", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { profiles: [] }))
      .then((data: { profiles?: ActiveProfileOption[] }) => {
        const list = data.profiles ?? [];
        setProfiles(list);
        setId((current) => (current !== null && !list.some((p) => p.id === current) ? null : current));
      })
      .catch(() => {});
  }, []);

  const setProfileId = useCallback((id: number | null) => {
    setId(id);
    try {
      if (id === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(id));
    } catch {}
  }, []);

  const value = useMemo<ActiveProfileValue>(
    () => ({
      profiles,
      profileId,
      profile: profiles.find((p) => p.id === profileId) ?? null,
      setProfileId,
      ready,
    }),
    [profiles, profileId, setProfileId, ready],
  );

  return <ActiveProfileContext.Provider value={value}>{children}</ActiveProfileContext.Provider>;
}

export function ActiveProfileSwitcher({ className }: { className?: string }) {
  const { profiles, profileId, profile, setProfileId } = useActiveProfile();
  const name = profile?.full_name ?? "All candidates";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 max-w-[220px] items-center gap-2 rounded-md border bg-card pl-1 pr-2 text-sm shadow-xs transition-colors hover:bg-accent",
            className,
          )}
          title="Choose which candidate you are working as"
        >
          <CandidateAvatar profileId={profile ? profile.id : null} name={name} />
          <span className="hidden truncate font-medium sm:inline">{name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Working as</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setProfileId(null)} className="gap-2">
          <CandidateAvatar profileId={null} name="" />
          <span className="flex-1">All candidates</span>
          {profileId === null && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        {profiles.length > 0 && <DropdownMenuSeparator />}
        {profiles.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => setProfileId(p.id)} className="gap-2">
            <CandidateAvatar profileId={p.id} name={p.full_name} />
            <span className="flex-1 truncate">{p.full_name}</span>
            {profileId === p.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2 text-muted-foreground">
          <Link href="/profile">
            <Settings2 className="h-4 w-4" />
            Manage profiles
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
