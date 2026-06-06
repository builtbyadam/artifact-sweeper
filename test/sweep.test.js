const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  globToRegExp,
  parseBool,
  parseNonNegativeInt,
  parseInputs,
  ageInDays,
  isCandidate,
  selectCandidates,
  sumBytes,
  toReportRow,
} = require("../src/sweep");

const DAY = 1000 * 60 * 60 * 24;
const NOW = Date.parse("2026-06-06T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

describe("globToRegExp", () => {
  test("* matches within a segment, ** across", () => {
    assert.ok(globToRegExp("build-*").test("build-123"));
    assert.ok(!globToRegExp("build-*").test("build/123"));
    assert.ok(globToRegExp("**").test("anything/at/all"));
  });

  test("? matches a single character and metacharacters are escaped", () => {
    assert.ok(globToRegExp("cache-?").test("cache-1"));
    assert.ok(!globToRegExp("cache-?").test("cache-12"));
    assert.ok(globToRegExp("v1.2+x").test("v1.2+x"));
    assert.ok(!globToRegExp("v1.2").test("v1X2"));
  });

  test("exact keys match exactly", () => {
    assert.ok(globToRegExp("Linux-node-abc").test("Linux-node-abc"));
    assert.ok(!globToRegExp("Linux-node").test("Linux-node-abc"));
  });
});

describe("parseBool", () => {
  test("accepts true/false", () => {
    assert.strictEqual(parseBool("x", "true"), true);
    assert.strictEqual(parseBool("x", "false"), false);
  });
  test("rejects anything else", () => {
    assert.throws(() => parseBool("include-caches", "yes"), /Input "include-caches" must be/);
  });
});

describe("parseNonNegativeInt", () => {
  test("accepts non-negative integers including 0", () => {
    assert.strictEqual(parseNonNegativeInt("x", "0"), 0);
    assert.strictEqual(parseNonNegativeInt("x", "30"), 30);
  });
  test("rejects negatives, decimals, and non-numbers", () => {
    assert.throws(() => parseNonNegativeInt("older-than-days", "-1"), /must be a non-negative integer/);
    assert.throws(() => parseNonNegativeInt("older-than-days", "1.5"), /must be a non-negative integer/);
    assert.throws(() => parseNonNegativeInt("older-than-days", "abc"), /must be a non-negative integer/);
  });
});

describe("parseInputs", () => {
  test("parses a full set of raw inputs", () => {
    const opts = parseInputs({
      olderThanDays: "7",
      includeCaches: "false",
      includeArtifacts: "true",
      namePattern: "build-*",
      confirm: "true",
    });
    assert.deepStrictEqual(opts, {
      olderThanDays: 7,
      includeCaches: false,
      includeArtifacts: true,
      namePattern: "build-*",
      confirm: true,
    });
  });

  test("empty name-pattern becomes empty string", () => {
    const opts = parseInputs({
      olderThanDays: "0",
      includeCaches: "true",
      includeArtifacts: "true",
      namePattern: "",
      confirm: "false",
    });
    assert.strictEqual(opts.namePattern, "");
    assert.strictEqual(opts.confirm, false);
  });

  test("propagates validation errors", () => {
    assert.throws(
      () =>
        parseInputs({
          olderThanDays: "x",
          includeCaches: "true",
          includeArtifacts: "true",
          namePattern: "",
          confirm: "false",
        }),
      /older-than-days/
    );
  });
});

describe("ageInDays", () => {
  test("computes whole-day age from a timestamp", () => {
    assert.strictEqual(ageInDays(daysAgo(10), NOW), 10);
    assert.strictEqual(ageInDays(daysAgo(0), NOW), 0);
  });
});

describe("isCandidate", () => {
  const base = { olderThanDays: 30, nameRegExp: null, currentRunId: null, now: NOW };

  test("old enough with no pattern qualifies", () => {
    const item = { name: "old", timestamp: daysAgo(31), workflowRunId: 1 };
    assert.ok(isCandidate(item, base));
  });

  test("too recent does not qualify", () => {
    const item = { name: "fresh", timestamp: daysAgo(5), workflowRunId: 1 };
    assert.ok(!isCandidate(item, base));
  });

  test("exactly older-than-days qualifies (>=)", () => {
    const item = { name: "edge", timestamp: daysAgo(30), workflowRunId: 1 };
    assert.ok(isCandidate(item, base));
  });

  test("name-pattern filters by name", () => {
    const opts = { ...base, nameRegExp: globToRegExp("build-*") };
    assert.ok(isCandidate({ name: "build-1", timestamp: daysAgo(40), workflowRunId: 1 }, opts));
    assert.ok(!isCandidate({ name: "test-1", timestamp: daysAgo(40), workflowRunId: 1 }, opts));
  });

  test("current run is always excluded even when old and matching", () => {
    const opts = { ...base, currentRunId: 42 };
    assert.ok(!isCandidate({ name: "x", timestamp: daysAgo(99), workflowRunId: 42 }, opts));
    assert.ok(isCandidate({ name: "x", timestamp: daysAgo(99), workflowRunId: 7 }, opts));
  });

  test("older-than-days of 0 sweeps everything not in the current run", () => {
    const opts = { ...base, olderThanDays: 0 };
    assert.ok(isCandidate({ name: "x", timestamp: daysAgo(0), workflowRunId: 1 }, opts));
  });
});

describe("selectCandidates", () => {
  const items = [
    { type: "artifact", id: 1, name: "build-old", created_at: daysAgo(40), size_in_bytes: 100, timestamp: daysAgo(40), workflowRunId: 10 },
    { type: "artifact", id: 2, name: "build-fresh", created_at: daysAgo(2), size_in_bytes: 200, timestamp: daysAgo(2), workflowRunId: 11 },
    { type: "artifact", id: 3, name: "build-current", created_at: daysAgo(99), size_in_bytes: 400, timestamp: daysAgo(99), workflowRunId: 99 },
    { type: "cache", id: 4, name: "test-old", created_at: daysAgo(60), size_in_bytes: 800, timestamp: daysAgo(60), workflowRunId: null },
  ];
  const opts = { olderThanDays: 30, nameRegExp: null, currentRunId: 99, now: NOW };

  test("selects old items, excludes fresh and current run", () => {
    const selected = selectCandidates(items, opts);
    assert.deepStrictEqual(
      selected.map((i) => i.id),
      [1, 4]
    );
  });

  test("name-pattern narrows the selection", () => {
    const selected = selectCandidates(items, { ...opts, nameRegExp: globToRegExp("build-*") });
    assert.deepStrictEqual(
      selected.map((i) => i.id),
      [1]
    );
  });
});

describe("sumBytes", () => {
  test("sums size_in_bytes, tolerating missing fields", () => {
    assert.strictEqual(sumBytes([{ size_in_bytes: 100 }, { size_in_bytes: 250 }, {}]), 350);
    assert.strictEqual(sumBytes([]), 0);
  });
});

describe("toReportRow", () => {
  const item = {
    type: "cache",
    id: 7,
    name: "Linux-cache",
    created_at: "2026-01-01T00:00:00Z",
    size_in_bytes: 1024,
    timestamp: "2026-05-01T00:00:00Z",
    workflowRunId: null,
  };

  test("would-delete row in dry-run drops internal fields", () => {
    assert.deepStrictEqual(toReportRow(item, false), {
      type: "cache",
      id: 7,
      name: "Linux-cache",
      created_at: "2026-01-01T00:00:00Z",
      size_in_bytes: 1024,
      action: "would-delete",
    });
  });

  test("deleted row when actually deleted", () => {
    assert.strictEqual(toReportRow(item, true).action, "deleted");
  });
});
