/**
 * On Windows, project paths containing '#' can cause Tailwind/PostCSS to produce
 * paths with null bytes (ERR_INVALID_ARG_VALUE). This script fails the build
 * with a clear message so you move the repo to a path without '#'.
 * See: https://github.com/tailwindlabs/tailwindcss/discussions/15268
 */
const isWindows = process.platform === "win32";
const cwd = process.cwd();

if (isWindows && cwd.includes("#")) {
  console.error(`
Build failed: project path contains '#' which breaks Tailwind CSS on Windows.

  Current path: ${cwd}

Fix: Move the project to a path without '#'.
  - Example: C:\\GitHub_proj\\JobStrike  (no #)
  - Or:      C:\\dev\\JobStrike
`);
  process.exit(1);
}
