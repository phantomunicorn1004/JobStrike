/** A kit resume JSON shaped like the William template (schema 2.3), with made-up data. */

function ph(placeholder: string, text: string, bold_words: string[] = []) {
  return { placeholder, text, bold_words };
}

function role(n: number, facts: { company: string; location: string; title: string; arrangement: string }, bullets: number) {
  const entry: Record<string, unknown> = {
    company: ph(`<<Company-${n}>>`, facts.company),
    location: ph(`<<Company-Location-${n}>>`, facts.location),
    role_title: ph(`<<Role-Title-${n}>>`, facts.title),
    work_arrangement: ph(`<<Work-Arrangement-${n}>>`, facts.arrangement),
    start_date: `Jan 20${10 + n}`,
    end_date: n === 1 ? "Present" : `Dec 20${11 + n}`,
    bullets: Object.fromEntries(
      Array.from({ length: bullets }, (_, i) => [
        `bullet_${i + 1}`,
        ph(`<<Bullet-${n}-${i + 1}>>`, `Kit bullet ${n}.${i + 1} about Python services.`, ["Python"]),
      ]),
    ),
  };
  return entry;
}

export function makeKit(): Record<string, unknown> {
  return {
    schema_version: "2.3",
    resume_template: "William",
    cover_letter_filename: "Sam_Lee_Cover_Letter",
    resume_filename: "Sam_Lee_Resume",
    profile: "Sam Lee",
    email: "sam@example.com",
    phone_number: "+1 555-0100",
    current_location: "Austin, TX",
    cover_letter: {
      today_date: ph("<<Today-Date>>", "January 1, 2026"),
      cover_letter_text: ph("<<Cover-Letter-Text>>", "Kit cover letter."),
    },
    summary: { heading: "SUMMARY", ...ph("<<Summary>>", "Kit summary with Python.", ["Python"]) },
    technology_stack: {
      skill_group_1: ph("<<Skill-Group-1>>", "Languages"),
      skill_items_1: ph("<<Skill-Items-1>>", "Python, Go", ["Python"]),
    },
    work_experience: {
      experience_1: role(1, { company: "Acme Corp", location: "Austin, TX", title: "Senior Engineer", arrangement: "Remote" }, 3),
      experience_2: role(2, { company: "Globex", location: "Dallas, TX", title: "Engineer", arrangement: "Hybrid" }, 2),
    },
    education: { institution: "State University", degree: "BS Computer Science", date_range: "2006 – 2010" },
    placeholder_order: ["<<Summary>>"],
  };
}

/** A plausible model answer for makeKit(): every text rewritten, facts untouched. */
export function makeAnswer(): Record<string, unknown> {
  const answer = JSON.parse(JSON.stringify(makeKit())) as Record<string, any>;
  answer.job_title = "Staff Platform Engineer";
  answer.company_name = "Initech";
  answer.job_description = "Build platforms.";
  answer.summary.text = "Platform engineer with Kubernetes and Python depth.";
  answer.summary.bold_words = ["Kubernetes", "Python"];
  answer.cover_letter.cover_letter_text.text = "Dear Initech team, I build platforms.";
  for (const roleKey of ["experience_1", "experience_2"]) {
    for (const [key, bullet] of Object.entries(answer.work_experience[roleKey].bullets) as [string, any][]) {
      bullet.text = `Tailored ${roleKey} ${key}: shipped Python platform work.`;
    }
  }
  return answer;
}

export const TARGET = { jobTitle: "Staff Platform Engineer", company: "Initech", jobDescription: "Build platforms." };
