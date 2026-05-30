import { createLogoutJsonResponse } from "@/lib/auth/session";

export async function POST() {
  return createLogoutJsonResponse();
}
