// Publishes a solved code task as a public GitHub repo so the entry can be
// submitted as repo @ commit. Two backends, tried in order:
//   1. `gh` CLI, when it is installed and authenticated (gh auth status).
//   2. GITHUB_TOKEN + GITHUB_USER env vars (GitHub API + HTTPS push).
// Returns { repoUrl, commit } or null when no publishing credential exists —
// in that case the orchestrator skips the code bounty with a logged reason
// instead of submitting a repo URL that does not exist.
//
// Robustness: if the repo already exists (e.g. a previous run created it),
// the solution is committed on top of it instead of failing; transient
// GitHub rate-limit errors ("too many repositories, too quickly") are
// retried once after a 2-minute pause.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE_LIMIT = /too many repositories|rate limit|abuse/i;

function sh(cmd, cwd, env = {}) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
}

function ghAuthed() {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ghLogin() {
  return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim();
}

function ghRepoExists(login, name) {
  try {
    execFileSync("gh", ["api", `repos/${login}/${name}`, "--jq", ".id"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function apiRepoExists(user, name, token) {
  const res = await fetch(`https://api.github.com/repos/${user}/${name}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20000),
  });
  return res.status === 200;
}

async function createRepoViaApi(name, token) {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "user-agent": "aiprove-autonomous-agent",
    },
    body: JSON.stringify({ name, private: false, description: "AIProve entry built autonomously by aiprove-autonomous-agent" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`GitHub repo create failed: HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.html_url;
}

function writeAndCommit(dir, files, name) {
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  sh(`git config user.name ${JSON.stringify(process.env.AGENT_GIT_NAME || "aiprove-auto-agent")}`, dir);
  sh(`git config user.email ${JSON.stringify(process.env.AGENT_GIT_EMAIL || "agent@aiprove.fun")}`, dir);
  sh("git add -A", dir);
  const status = sh("git status --porcelain", dir).trim();
  if (!status) return sh("git rev-parse HEAD", dir).trim(); // nothing changed
  sh(`git commit -qm ${JSON.stringify(`aiprove ${name} entry (built autonomously)`)}`, dir);
  return sh("git rev-parse HEAD", dir).trim();
}

// The clone-vs-create flow differs enough that it is clearer as one function
// with explicit branches than as a shared helper.
async function publishAttempt(name, files) {
  const dir = mkdtempSync(join(tmpdir(), "aiprove-solution-"));
  try {
    if (ghAuthed()) {
      const login = ghLogin();
      const repoUrl = `https://github.com/${login}/${name}`;
      if (ghRepoExists(login, name)) {
        rmSync(dir, { recursive: true, force: true });
        sh(`git clone -q ${repoUrl}.git ${dir}`, tmpdir());
        const commit = writeAndCommit(dir, files, name);
        const branch = sh("git rev-parse --abbrev-ref HEAD", dir).trim();
        sh(`git push -q origin ${branch}`, dir);
        return { repoUrl, commit };
      }
      sh("git init -q -b master", dir);
      const commit = writeAndCommit(dir, files, name);
      sh(`gh repo create ${name} --public --source ${dir} --remote origin --push`, dir);
      return { repoUrl, commit };
    }
    const token = process.env.GITHUB_TOKEN;
    const user = process.env.GITHUB_USER;
    if (token && user) {
      const repoUrl = `https://github.com/${user}/${name}`;
      if (await apiRepoExists(user, name, token)) {
        rmSync(dir, { recursive: true, force: true });
        sh(`git clone -q https://x-access-token:${token}@github.com/${user}/${name}.git ${dir}`, tmpdir());
        const commit = writeAndCommit(dir, files, name);
        const branch = sh("git rev-parse --abbrev-ref HEAD", dir).trim();
        sh(`git push -q origin ${branch}`, dir);
        return { repoUrl, commit };
      }
      sh("git init -q -b master", dir);
      const commit = writeAndCommit(dir, files, name);
      await createRepoViaApi(name, token);
      sh(`git remote add origin https://x-access-token:${token}@github.com/${user}/${name}.git`, dir);
      sh("git push -q -u origin master", dir);
      return { repoUrl, commit };
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function publishSolution(name, files) {
  try {
    return await publishAttempt(name, files);
  } catch (e) {
    if (RATE_LIMIT.test(e.message)) {
      console.log(`  [publish] rate-limited, retrying once after 120s...`);
      await sleep(120000);
      return publishAttempt(name, files);
    }
    throw e;
  }
}
