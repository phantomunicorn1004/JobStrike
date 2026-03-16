"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Workflow, CheckCircle, FileEdit } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarContent,
  SidebarProvider,
  SidebarFooter,
} from "@/components/ui/sidebar";

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <Sidebar className="w-[220px]">
          <div
            className="flex items-center justify-between bg-background px-3 shadow-lg"
            style={{ height: "100px" }}
          >
            <img
              src="/logo.png"
              alt="Logo"
              className="h-24 py-2 transition-transform hover:scale-105"
            />
            <ThemeToggle />
          </div>
          <SidebarContent className="bg-background flex-1 px-2 py-8">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/jobs-applied")}
                  className="rounded-lg text-lg font-medium py-3 px-4 text-foreground hover:bg-muted transition-colors flex items-center gap-3"
                >
                  <Link href="/jobs-applied">
                    <ClipboardList className="h-5 w-5" />
                    <span>Applied Jobs</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <Separator className="my-2" />
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/jobs-technical")}
                  className="rounded-lg text-lg font-medium py-3 px-4 text-foreground hover:bg-muted transition-colors flex items-center gap-3"
                >
                  <Link href="/jobs-technical">
                    <Workflow className="h-5 w-5" />
                    <span>Technical Stage</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <Separator className="my-2" />
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/jobs-final")}
                  className="rounded-lg text-lg font-medium py-3 px-4 text-foreground hover:bg-muted transition-colors flex items-center gap-3"
                >
                  <Link href="/jobs-final">
                    <CheckCircle className="h-5 w-5" />
                    <span>Final Stage</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <Separator className="my-2" />
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/resume-tailor")}
                  className="rounded-lg text-lg font-medium py-3 px-4 text-foreground hover:bg-muted transition-colors flex items-center gap-3"
                >
                  <Link href="/resume-tailor">
                    <FileEdit className="h-5 w-5" />
                    <span>Resume Tailor</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="mt-auto">
            <Link href="/profile">
              <img
                src="/placeholder-user.jpg"
                alt="Profile"
                className="w-12 h-12 rounded-full mx-auto cursor-pointer border-2 border-gray-300 hover:border-blue-600 transition"
              />
            </Link>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 bg-background p-4">{children}</main>
      </div>
    </SidebarProvider>
  );
}
