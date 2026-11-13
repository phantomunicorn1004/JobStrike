/**
 * Classifier accuracy test — runs known field labels through the classifier
 * and checks they produce the expected category. Run after any change to
 * classifyFieldByLabel or the AI fill rules.
 *
 * Usage: npx tsx scripts/classifier-test.ts
 */

// Test cases extracted from real submitted applications (bid_fields audit).
// Each entry: [label, expectedCategory, description]
const CASES: Array<[string, string, string]> = [
  // === Names ===
  ["First Name", "first_name", "basic first name"],
  ["Last Name", "last_name", "basic last name"],
  ["Legal First and Last Name", "full_name", "compound label with both first+last"],
  ["Full name", "full_name", "explicit full name"],
  ["Preferred First Name", "first_name", "preferred name variant"],
  ["What is your Legal First Name?", "first_name", "legal first only"],
  ["What is your Legal Last Name?", "last_name", "legal last only"],
  ["Middle Name", "middle_name", "middle name"],
  ["First and Last Name", "full_name", "first and last compound"],
  ["Legal Name", "full_name", "legal name = full name"],

  // === Contact ===
  ["Email", "email", "basic email"],
  ["Phone", "phone", "basic phone"],

  // === Address ===
  ["Please enter your full mailing address in the box below. (Street Address, City, State, Zip)", "full_address", "explicit full mailing address"],
  ["Please share your full address including city, state and zip code:", "full_address", "full address with city/state/zip"],
  ["We require the current physical/mailing address for all candidates. Please enter your complete address.", "full_address", "mailing address request"],
  ["Street Address", "address", "street only"],
  ["Address Line 1", "address", "address line 1"],
  ["Home address (123 Streetname Boulevard, City, State 12345)", "full_address", "address with format example"],

  // === Work authorization ===
  ["Are you legally authorized to work in the United States?", "work_authorization_us", "US work auth yes/no"],
  ["Are you authorized to work in the US?", "work_authorization_us", "short US work auth"],
  ["What is the expiration date of your current work authorization (if applicable)?", "custom_question", "auth expiration date — NOT a yes/no"],
  ["When does your visa expire?", "custom_question", "visa expiration — date question"],
  ["Will you now or in the future require sponsorship?", "sponsorship", "sponsorship question"],
  ["Are you authorized to work for any US employer?", "work_authorization", "generic work auth"],

  // === Salary ===
  ["What are your salary expectations for this role?", "salary", "salary expectation"],
  ["What is your target base salary range?", "salary", "target salary"],
  ["Desired compensation", "salary", "compensation"],

  // === EEO / Self-ID ===
  ["Gender", "gender", "gender"],
  ["Are you Hispanic/Latino?", "hispanic_latino", "hispanic/latino"],
  ["Veteran Status", "veteran_status", "veteran"],
  ["Do you have a disability?", "disability_status", "disability"],
  ["Please identify your race", "race", "race"],

  // === Other ===
  ["How did you hear about us?", "how_heard", "how heard"],
  ["LinkedIn Profile", "linkedin", "linkedin"],
  ["GitHub URL", "github", "github"],
  ["Location (City)", "city", "city"],
  ["Do you now or will you in the future need an employer to sponsor you for a visa?", "sponsorship", "sponsorship long form"],

  // === Sanctions ===
  // These should go to custom_question or be answered by AI with "No"
  ["Are you located in or a national of Cuba, Iran, North Korea, Syria, or Crimea?", "custom_question", "sanctions question"],

  // === Tricky edge cases ===
  ["By providing your phone number you may receive text messages. Do you consent?", "custom_question", "consent about phone — NOT a phone field"],
  ["Have you ever worked for State Farm?", "custom_question", "question containing 'state' — NOT a state field"],
  ["What city do you currently live in?", "city", "city question form"],
  ["This position requires US Citizenship. Do you meet this requirement?", "custom_question", "citizenship requirement — yes/no question"],
];

// We need to load the classifier from content.js. Since it's a content script
// with IIFE, we extract the function for testing.
// For now, this is a specification of expected behavior that can be validated
// manually or by instrumenting the extension.

async function main() {
  let pass = 0;
  let fail = 0;
  const failures: Array<{ label: string; expected: string; description: string }> = [];

  console.log("=== Classifier Test Suite ===\n");
  console.log(`Running ${CASES.length} test cases...\n`);

  // Since we can't directly import content.js (it's an IIFE content script),
  // output the test cases as a validation checklist.
  // To actually run: paste these into the extension console or extract the classifier.

  for (const [label, expected, desc] of CASES) {
    // For now, just output the spec
    console.log(`  [SPEC] "${label}"`);
    console.log(`         Expected: ${expected} — ${desc}`);
  }

  console.log(`\n=== ${CASES.length} test cases defined ===`);
  console.log("\nTo validate: open the extension's background page console and run:");
  console.log("  classifyFieldByLabel(label) for each test case above.");
  console.log("\nOr extract classifyFieldByLabel into a testable module.\n");

  // Also output as JSON for automated testing
  const testData = CASES.map(([label, expected, desc]) => ({ label, expected, description: desc }));
  const outPath = require("path").join(__dirname, "classifier-test-cases.json");
  require("fs").writeFileSync(outPath, JSON.stringify(testData, null, 2));
  console.log(`Test cases written to: ${outPath}`);
}

main().catch(console.error);
