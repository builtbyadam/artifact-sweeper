// Pure logic for artifact-sweeper. No GitHub API calls here so it can be
// unit-tested directly (see test/sweep.test.js).

/**
 * Convert a glob to a RegExp. Copied verbatim from matrix-shrinker's
 * src/shrink.js so this action stays self-contained (actions never import
 * across directories). Used to match artifact names / cache keys, which have
 * no path separators, but the "/" semantics are kept for consistency.
 * Supported syntax:
 *   *   matches anything except "/"
 *   ?   matches a single character except "/"
 *   **  matches anything, including "/"
 */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?"; // "**/" — zero or more leading directories
          i += 2;
        } else {
          re += ".*"; // trailing or bare "**"
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** Parse a boolean-string input ("true"/"false"). Throws on anything else. */
function parseBool(name, value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Input "${name}" must be "true" or "false", got "${value}".`);
}

/** Parse a non-negative integer input. Throws on anything else. */
function parseNonNegativeInt(name, value) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Input "${name}" must be a non-negative integer, got "${value}".`);
  }
  return Number(value);
}

/**
 * Parse and validate all raw inputs into a typed options object.
 *
 * @param {object} raw Raw string inputs.
 * @param {string} raw.olderThanDays
 * @param {string} raw.includeCaches
 * @param {string} raw.includeArtifacts
 * @param {string} raw.namePattern
 * @param {string} raw.confirm
 * @returns {{olderThanDays:number, includeCaches:boolean, includeArtifacts:boolean,
 *           namePattern:string, confirm:boolean}}
 */
function parseInputs(raw) {
  return {
    olderThanDays: parseNonNegativeInt("older-than-days", raw.olderThanDays),
    includeCaches: parseBool("include-caches", raw.includeCaches),
    includeArtifacts: parseBool("include-artifacts", raw.includeArtifacts),
    namePattern: raw.namePattern || "",
    confirm: parseBool("confirm", raw.confirm),
  };
}

/**
 * Compute the age of a timestamp in whole days relative to `now`.
 *
 * @param {string} timestamp ISO-8601 timestamp.
 * @param {number} now Reference time in ms (defaults to Date.now()).
 * @returns {number} Age in days (fractional).
 */
function ageInDays(timestamp, now = Date.now()) {
  return (now - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Decide whether an item is a deletion candidate.
 *
 * @param {object} item Normalized item: {name, timestamp, workflowRunId}.
 * @param {object} opts
 * @param {number} opts.olderThanDays Minimum age in days to qualify.
 * @param {RegExp|null} opts.nameRegExp Compiled name pattern, or null = match all.
 * @param {number|null} opts.currentRunId Current run id to always exclude.
 * @param {number} opts.now Reference time in ms.
 * @returns {boolean}
 */
function isCandidate(item, { olderThanDays, nameRegExp, currentRunId, now }) {
  // Never touch artifacts of the currently-running workflow run.
  if (currentRunId != null && item.workflowRunId === currentRunId) return false;
  if (nameRegExp && !nameRegExp.test(item.name)) return false;
  return ageInDays(item.timestamp, now) >= olderThanDays;
}

/**
 * Select deletion candidates from a list of normalized items.
 *
 * @param {object[]} items Normalized items: {type, id, name, created_at,
 *                         size_in_bytes, timestamp, workflowRunId}.
 * @param {object} opts See isCandidate.
 * @returns {object[]} The subset that should be (or would be) deleted.
 */
function selectCandidates(items, opts) {
  return items.filter((item) => isCandidate(item, opts));
}

/** Sum the size_in_bytes field across items. */
function sumBytes(items) {
  return items.reduce((total, item) => total + (item.size_in_bytes || 0), 0);
}

/**
 * Build the report row for an item.
 *
 * @param {object} item Normalized item.
 * @param {boolean} deleted Whether the item was actually deleted.
 * @returns {object} {type, id, name, created_at, size_in_bytes, action}.
 */
function toReportRow(item, deleted) {
  return {
    type: item.type,
    id: item.id,
    name: item.name,
    created_at: item.created_at,
    size_in_bytes: item.size_in_bytes,
    action: deleted ? "deleted" : "would-delete",
  };
}

module.exports = {
  globToRegExp,
  parseBool,
  parseNonNegativeInt,
  parseInputs,
  ageInDays,
  isCandidate,
  selectCandidates,
  sumBytes,
  toReportRow,
};
