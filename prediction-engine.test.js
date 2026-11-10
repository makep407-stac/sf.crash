"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeRounds, wilson } = require("./prediction-engine");

test("requires a minimum history and never invents an exact multiplier", () => {
  const result = analyzeRounds(Array(199).fill(2));
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.exactMultiplierPrediction, null);
});

test("returns empirical threshold probabilities with intervals", () => {
  const rounds = Array.from({ length: 200 }, (_, i) => i % 2 ? 2 : 1.2);
  const result = analyzeRounds(rounds);
  assert.equal(result.status, "empirical_probability_estimate");
  assert.equal(result.exactMultiplierPrediction, null);
  assert.equal(result.overall.sampleSize, 200);
  assert.ok(result.overall.probabilities["2x"].estimate > 0);
  assert.ok(result.overall.probabilities["2x"].interval95.low <= result.overall.probabilities["2x"].interval95.high);
});

test("rejects invalid and impossible input values", () => {
  assert.throws(() => analyzeRounds([1, 2, 0]), /between 1 and/);
  assert.throws(() => analyzeRounds("not an array"), /must be an array/);
});

test("Wilson interval handles no samples", () => {
  assert.deepEqual(wilson(0, 0), { low: null, high: null });
});
