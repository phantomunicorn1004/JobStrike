import JobsLayout from "../jobs-layout";
import { JobsPipelineBoard } from "@/components/jobs/JobsPipelineBoard";

export const dynamic = "force-dynamic";

export default function JobsPipelinePage() {
  return (
    <JobsLayout>
      <JobsPipelineBoard />
    </JobsLayout>
  );
}
