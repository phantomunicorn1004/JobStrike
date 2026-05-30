export type UserRole = "admin" | "member";

export type AppUser = {
  id: string;
  username: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type SessionPayload = SessionUser & {
  exp: number;
};
