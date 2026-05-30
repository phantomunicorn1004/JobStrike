"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { defaultHomeForRole } from "@/lib/auth/constants";
import type { UserRole } from "@/lib/auth/types";

async function authRequest(
  path: "/api/auth/login" | "/api/auth/signup",
  username: string,
  password: string,
) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data as { user: { role: UserRole } };
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center text-muted-foreground">
          Loading…
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  const [signInUsername, setSignInUsername] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpUsername, setSignUpUsername] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirm, setSignUpConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const redirectAfterAuth = (role: UserRole) => {
    if (role === "admin") {
      router.replace("/admin/users");
      router.refresh();
      return;
    }
    const fallback = defaultHomeForRole(role);
    const destination =
      nextPath && nextPath.startsWith("/") && !nextPath.startsWith("/login")
        ? nextPath
        : fallback;
    router.replace(destination);
    router.refresh();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { user } = await authRequest(
        "/api/auth/login",
        signInUsername,
        signInPassword,
      );
      toast.success("Signed in.");
      redirectAfterAuth(user.role);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signUpPassword !== signUpConfirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { user } = await authRequest(
        "/api/auth/signup",
        signUpUsername,
        signUpPassword,
      );
      toast.success("Account created.");
      redirectAfterAuth(user.role);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo-icon.png" alt="" className="h-16 w-16 rounded-2xl" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Remote Helper</h1>
            <p className="text-sm text-muted-foreground">
              Sign in or create an account to continue
            </p>
          </div>
        </div>

        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Account</CardTitle>
            <CardDescription>Use your username and password</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-username">Username</Label>
                    <Input
                      id="signin-username"
                      autoComplete="username"
                      value={signInUsername}
                      onChange={(e) => setSignInUsername(e.target.value)}
                      placeholder="your.username"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      autoComplete="current-password"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-username">Username</Label>
                    <Input
                      id="signup-username"
                      autoComplete="username"
                      value={signUpUsername}
                      onChange={(e) => setSignUpUsername(e.target.value)}
                      placeholder="Choose a username"
                      minLength={3}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirm password</Label>
                    <Input
                      id="signup-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={signUpConfirm}
                      onChange={(e) => setSignUpConfirm(e.target.value)}
                      minLength={8}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Candidate profiles and pipeline data require a member account.
        </p>
      </div>
    </div>
  );
}
