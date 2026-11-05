"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { OverviewResponse } from "@/app/api/overview/route";

const REFRESH_MS = 60_000;

type OverviewValue = { overview: OverviewResponse | null; refresh: () => void };

const OverviewContext = createContext<OverviewValue>({ overview: null, refresh: () => {} });

export function useOverview(): OverviewValue {
  return useContext(OverviewContext);
}

export function OverviewProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  const refresh = useCallback(() => {
    void fetch("/api/overview", { credentials: "same-origin", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: OverviewResponse | null) => {
        if (data) setOverview(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return <OverviewContext.Provider value={{ overview, refresh }}>{children}</OverviewContext.Provider>;
}
