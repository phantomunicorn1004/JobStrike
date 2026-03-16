import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Home redirects to the unified job pipeline
export default function Home() {
  redirect("/jobs");
}
