import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Home redirects to the dashboard
export default function Home() {
  redirect("/dashboard");
}
