"use client";

import React from "react";
import Link from "next/link";
import { Users, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AdminLayout({
  children,
  onLogout,
}: {
  children: React.ReactNode;
  onLogout: () => void;
}) {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="border-b border-sidebar-border px-4 py-5">
          <BrandLogo href="/admin/users" />
        </div>
        <nav className="flex-1 p-3">
          <Link
            href="/admin/users"
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
              "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Users className="h-4 w-4" />
            User management
          </Link>
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border p-3">
          <ThemeToggle />
          <Button type="button" variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4 mr-1" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
