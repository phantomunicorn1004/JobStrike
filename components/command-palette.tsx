"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { CornerDownLeft, Moon, Search, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PaletteItem = {
  label: string;
  group: string;
  icon: LucideIcon;
  href?: string;
  keywords?: string;
  run?: () => void;
};

export function useCommandPaletteHotkey(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<PaletteItem[]>(
    () => [
      ...items,
      {
        label: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        group: "Preferences",
        icon: Moon,
        keywords: "theme dark light appearance",
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ],
    [items, resolvedTheme, setTheme],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => `${item.label} ${item.group} ${item.keywords ?? ""}`.toLowerCase().includes(q));
  }, [all, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    if (item.href) router.push(item.href);
    item.run?.();
  };

  const groups: Array<[string, Array<{ item: PaletteItem; index: number }>]> = [];
  results.forEach((item, index) => {
    const group = groups.find(([name]) => name === item.group);
    if (group) group[1].push({ item, index });
    else groups.push([item.group, [{ item, index }]]);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search JobStrike</DialogTitle>
        <DialogDescription className="sr-only">Jump to a page or run an action.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[active]);
              }
            }}
            placeholder="Search pages and actions…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query}”.</p>
          ) : (
            groups.map(([group, entries]) => (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
                {entries.map(({ item, index }) => (
                  <button
                    key={`${item.group}-${item.label}`}
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm",
                      index === active ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-card",
                        index === active && "border-primary/30 text-primary",
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {index === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
