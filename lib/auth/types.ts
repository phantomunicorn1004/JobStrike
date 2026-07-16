export type UserRole = "admin" | "member";

export type AppUser = {
  id: string;
  username: string;
  role: UserRole;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
  timezone: string;
};

export type SessionPayload = SessionUser & {
  exp: number;
};
