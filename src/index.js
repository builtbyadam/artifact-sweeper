const core = require("@actions/core");
const github = require("@actions/github");
const {
  globToRegExp,
  parseInputs,
  selectCandidates,
  sumBytes,
  toReportRow,
} = require("./sweep");

/** List old artifacts as normalized items. Paginated. */
async function collectArtifacts(octokit, repo) {
  const artifacts = await octokit.paginate(octokit.rest.actions.listArtifactsForRepo, {
    ...repo,
    per_page: 100,
  });
  return artifacts.map((a) => ({
    type: "artifact",
    id: a.id,
    name: a.name,
    created_at: a.created_at,
    size_in_bytes: a.size_in_bytes,
    timestamp: a.created_at,
    workflowRunId: a.workflow_run ? a.workflow_run.id : null,
  }));
}

/** List caches as normalized items. Paginated. Age is from last_accessed_at. */
async function collectCaches(octokit, repo) {
  const caches = await octokit.paginate(octokit.rest.actions.getActionsCacheList, {
    ...repo,
    per_page: 100,
  });
  return caches.map((c) => ({
    type: "cache",
    id: c.id,
    name: c.key,
    created_at: c.created_at,
    size_in_bytes: c.size_in_bytes,
    // A recently-used cache is still valuable, so age is measured from the
    // last access time, not creation time.
    timestamp: c.last_accessed_at || c.created_at,
    workflowRunId: null,
  }));
}

/** Delete a single item. Returns true on success, false (with a warning) on failure. */
async function deleteItem(octokit, repo, item) {
  try {
    if (item.type === "artifact") {
      await octokit.rest.actions.deleteArtifact({ ...repo, artifact_id: item.id });
    } else {
      await octokit.rest.actions.deleteActionsCacheById({ ...repo, cache_id: item.id });
    }
    return true;
  } catch (e) {
    core.warning(`Failed to delete ${item.type} "${item.name}" (id ${item.id}): ${e.message}`);
    return false;
  }
}

function setOutputs({ deletedCount, reclaimedBytes, dryRun, report }) {
  core.setOutput("deleted-count", String(deletedCount));
  core.setOutput("reclaimed-bytes", String(reclaimedBytes));
  core.setOutput("dry-run", String(dryRun));
  core.setOutput("report", JSON.stringify(report));
}

async function run() {
  try {
    const opts = parseInputs({
      olderThanDays: core.getInput("older-than-days") || "30",
      includeCaches: core.getInput("include-caches") || "true",
      includeArtifacts: core.getInput("include-artifacts") || "true",
      namePattern: core.getInput("name-pattern"),
      confirm: core.getInput("confirm") || "false",
    });

    const dryRun = !opts.confirm;
    const token = core.getInput("github-token");

    // Missing token → safe no-op rather than a crash.
    if (!token) {
      core.warning("No github-token provided; skipping (no artifacts or caches were inspected).");
      setOutputs({ deletedCount: 0, reclaimedBytes: 0, dryRun, report: [] });
      return;
    }

    const octokit = github.getOctokit(token);
    const repo = github.context.repo;
    const now = Date.now();
    const nameRegExp = opts.namePattern ? globToRegExp(opts.namePattern) : null;
    const currentRunId = process.env.GITHUB_RUN_ID
      ? Number(process.env.GITHUB_RUN_ID)
      : null;

    core.info(
      `Sweeping ${repo.owner}/${repo.repo}: older-than-days=${opts.olderThanDays}, ` +
        `include-artifacts=${opts.includeArtifacts}, include-caches=${opts.includeCaches}, ` +
        `name-pattern=${opts.namePattern || "(all)"}, dry-run=${dryRun}.`
    );
    if (currentRunId != null) {
      core.info(`Excluding artifacts of the current run (id ${currentRunId}).`);
    }

    const items = [];
    if (opts.includeArtifacts) {
      const artifacts = await collectArtifacts(octokit, repo);
      core.info(`Found ${artifacts.length} artifact(s).`);
      items.push(...artifacts);
    }
    if (opts.includeCaches) {
      const caches = await collectCaches(octokit, repo);
      core.info(`Found ${caches.length} cache(s).`);
      items.push(...caches);
    }

    const candidates = selectCandidates(items, {
      olderThanDays: opts.olderThanDays,
      nameRegExp,
      currentRunId,
      now,
    });
    const candidateBytes = sumBytes(candidates);
    core.info(`${candidates.length} item(s) match the sweep criteria.`);

    if (dryRun) {
      const report = candidates.map((item) => toReportRow(item, false));
      core.info(
        `Would delete ${candidates.length} item(s) (${candidateBytes} bytes) (dry-run). ` +
          `Set confirm: "true" to delete.`
      );
      setOutputs({ deletedCount: 0, reclaimedBytes: 0, dryRun: true, report });
      return;
    }

    const report = [];
    let deletedCount = 0;
    let reclaimedBytes = 0;
    for (const item of candidates) {
      const ok = await deleteItem(octokit, repo, item);
      report.push(toReportRow(item, ok));
      if (ok) {
        deletedCount += 1;
        reclaimedBytes += item.size_in_bytes || 0;
        core.info(`Deleted ${item.type} "${item.name}" (id ${item.id}).`);
      }
    }

    core.info(`Deleted ${deletedCount} item(s) (${reclaimedBytes} bytes freed).`);
    setOutputs({ deletedCount, reclaimedBytes, dryRun: false, report });
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
