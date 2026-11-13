// aiprove-autonomous-agent — fully autonomous AIProve competitor.
//
// Loop (no human in the loop, no external API keys):
//   1. Fetch skill.md and derive the endpoint map from it.
//   2. Authenticate with its own keypair (AGENT_PRIVATE_KEY, or an ephemeral
//      key generated at runtime — only the address is ever printed).
//   3. List open bounties and enter every one (free).
//   4. Complete what it can: forecast bounties via the baseline strategy,
//      bug-hunt-utils via probe-based detection, deterministic code tasks
//      via verified solvers + repo publishing. Everything else is entered
//      and skipped with a documented reason.
//   5. Verify its own submissions and print an honest run report.
//
// Env:
//   API_BASE_URL       default https://aiprove.fun (staging arena override)
//   AGENT_PRIVATE_KEY  optional; ephemeral keypair when absent
//   AGENT_HANDLE       default "de51gn.auto"
//   GITHUB_TOKEN / GITHUB_USER  optional; enables repo publishing when the
//                      `gh` CLI is not authenticated
//   AGENT_GIT_NAME / AGENT_GIT_EMAIL  identity for published solution commits
import { Wallet } from "ethers";
import { Aiprove, parseEndpoints } from "./api.js";
import { classify, skipReason, predict } from "./strategy.js";
import { solveBugHunt } from "./solvers/bugHunt.js";
import { solveCodeGolf, solveFastestPrimes } from "./solvers/codeTasks.js";
import { publishSolution } from "./publish.js";

const API_BASE = process.env.API_BASE_URL || "https://aiprove.fun";
const HANDLE = process.env.AGENT_HANDLE || "de51gn.auto";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --only slug1,slug2: restrict the run to specific bounties (e.g. retrying
// one that failed). Without it, the agent works through every open bounty.
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;

const CODE_SOLVERS = { codeGolf: solveCodeGolf, fastestPrimes: solveFastestPrimes };
const REPO_NAMES = { codeGolf: "aiprove-agent-code-golf-expr", fastestPrimes: "aiprove-agent-fastest-primes" };

function transcriptFor(slug, lines) {
  return [`agent run — ${slug} (${new Date().toISOString()})`, ...lines].join("\n");
}

async function main() {
  const report = { entered: [], completed: [], skipped: [], failed: [] };
  const api = new Aiprove(API_BASE);

  // 1. Read skill.md and learn the API from it.
  const skill = await api.fetchSkill();
  const endpoints = parseEndpoints(skill);
  console.log(`[1] skill.md read (${skill.length} chars, ${Object.keys(endpoints).length} endpoints parsed)`);

  // 2. Identity: own keypair. Never print the key — address only.
  const wallet = process.env.AGENT_PRIVATE_KEY
    ? new Wallet(process.env.AGENT_PRIVATE_KEY)
    : Wallet.createRandom();
  console.log(`[2] identity: ${wallet.address} (${process.env.AGENT_PRIVATE_KEY ? "env keypair" : "ephemeral keypair"})`);
  const challenge = await api.challenge(wallet.address);
  const signature = await wallet.signMessage(challenge);
  const session = await api.verify(wallet.address, signature);
  console.log(`[2] authenticated, session expires ${new Date(session.expiresAt).toISOString()}`);

  // 3. List + enter everything open.
  let bounties = await api.listBounties("open");
  if (ONLY) bounties = bounties.filter((b) => ONLY.has(b.slug));
  console.log(`[3] ${bounties.length} open bounties${ONLY ? " (filtered by --only)" : ""}`);

  for (const bounty of bounties) {
    const slug = bounty.slug;
    try {
      await api.enter(slug, HANDLE);
      report.entered.push(slug);
    } catch (e) {
      console.log(`  [enter] ${slug}: FAILED (${e.message.slice(0, 120)})`);
      report.failed.push({ slug, stage: "enter", error: e.message.slice(0, 200) });
      continue;
    }
    await sleep(300);

    // 4. Attempt completion.
    try {
      const task = classify(bounty);
      if (!task) {
        const reason = skipReason(bounty);
        console.log(`  [skip] ${slug}: ${reason}`);
        report.skipped.push({ slug, reason });
        continue;
      }

      if (task.kind.startsWith("forecast") || task.kind === "signal" || task.kind === "top5") {
        const { prediction, note, skip } = await predict(bounty, task);
        if (skip) {
          console.log(`  [skip] ${slug}: ${skip}`);
          report.skipped.push({ slug, reason: skip });
          continue;
        }
        const res = await api.submit(slug, { prediction, handle: HANDLE });
        console.log(`  [done] ${slug}: prediction submitted (${res.status}, id ${res.id}) — ${note}`);
        report.completed.push({ slug, kind: task.kind, submissionId: res.id, status: res.status, note });
        continue;
      }

      if (task.kind === "bughunt") {
        const reports = await solveBugHunt();
        if (reports.length === 0) {
          console.log(`  [skip] ${slug}: probe found no bugs`);
          report.skipped.push({ slug, reason: "probe found no bugs" });
          continue;
        }
        const note = `probe-based detection: ${reports.length} verified bugs (${reports.map((r) => r.fn).join(", ")})`;
        // Full shape first (repo + prediction), exactly as the live API accepts;
        // fall back to prediction-only when no publishing credential exists.
        let payload = { prediction: reports, handle: HANDLE };
        let published = null;
        try {
          published = await publishSolution("aiprove-agent-bug-hunt-utils", {
            "reports.json": JSON.stringify(reports, null, 2) + "\n",
            "README.md":
              "# bug-hunt-utils\n\nReports found by probing every function in `utils.js` against an independent reference implementation.\n\n- Entry: `reports.json` ([{fn, input, expected}])\n",
          });
        } catch (e) {
          console.log(`  [publish] ${slug}: repo publish failed (${e.message.slice(0, 120)}), submitting prediction-only`);
        }
        if (published) {
          payload = {
            repoUrl: published.repoUrl,
            commit: published.commit,
            transcript: transcriptFor(slug, ["fetched utils.js from the official challenges repo", "probed every function against an independent reference implementation", note]),
            handle: HANDLE,
            prediction: reports,
          };
        }
        const res = await api.submit(slug, payload);
        console.log(`  [done] ${slug}: ${reports.length} bug reports submitted (${res.status}, id ${res.id})`);
        report.completed.push({ slug, kind: "bughunt", submissionId: res.id, status: res.status, note });
        continue;
      }

      if (task.kind === "code") {
        const solved = await CODE_SOLVERS[task.solver]();
        let published = null;
        try {
          published = await publishSolution(REPO_NAMES[task.solver], solved.files);
        } catch (e) {
          console.log(`  [publish] ${slug}: repo publish failed (${e.message.slice(0, 120)})`);
          report.failed.push({ slug, stage: "publish", error: e.message.slice(0, 200) });
          continue;
        }
        if (!published) {
          const reason = "no git publishing credential (no authenticated `gh` CLI, no GITHUB_TOKEN)";
          console.log(`  [skip] ${slug}: ${reason}`);
          report.skipped.push({ slug, reason });
          continue;
        }
        const res = await api.submit(slug, {
          repoUrl: published.repoUrl,
          commit: published.commit,
          transcript: transcriptFor(slug, ["fetched public cases from the official challenges repo", "built solution, verified against every public case", solved.note]),
          handle: HANDLE,
        });
        console.log(`  [done] ${slug}: repo submitted (${res.status}, id ${res.id}) — ${solved.note}`);
        report.completed.push({ slug, kind: "code", submissionId: res.id, status: res.status, note: solved.note, repoUrl: published.repoUrl });
        continue;
      }
    } catch (e) {
      console.log(`  [fail] ${slug}: ${e.message.slice(0, 160)}`);
      report.failed.push({ slug, stage: "complete", error: e.message.slice(0, 200) });
    }
    await sleep(300);
  }

  // 5. Verify what actually landed.
  const mine = await api.mySubmissions();
  const verified = mine.filter((s) => report.completed.some((c) => c.submissionId === s.id));
  console.log("\n=== RUN REPORT ===");
  console.log(`entered: ${report.entered.length} | completed: ${report.completed.length} | skipped: ${report.skipped.length} | failed: ${report.failed.length}`);
  console.log(`submissions verified on server: ${verified.length}/${report.completed.length}`);
  for (const c of report.completed) console.log(`  + ${c.slug} (${c.kind}) — ${c.status} ${c.submissionId}`);
  for (const s of report.skipped) console.log(`  ~ ${s.slug} — ${s.reason}`);
  for (const f of report.failed) console.log(`  ! ${f.slug} [${f.stage}] — ${f.error}`);
  console.log(JSON.stringify({ ...report, verifiedCount: verified.length }, null, 2));
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
