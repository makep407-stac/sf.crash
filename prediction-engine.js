"use strict";

// Crash rounds are not assumed to be predictable. This module estimates
// empirical threshold probabilities and uncertainty from verified history.
// It deliberately never emits an exact next-round multiplier.
const MIN_SAMPLE = 200;
const MAX_ROUNDS = 5000;
const THRESHOLDS = [1.2, 1.5, 2, 3, 5, 10];

function wilson(successes, n, z = 1.96) {
  if (!n) return { low: null, high: null };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function summarize(values) {
  const n = values.length;
  const probabilities = {};
  for (const threshold of THRESHOLDS) {
    const hits = values.filter(v => v >= threshold).length;
    const interval = wilson(hits, n);
    // Jeffreys smoothing avoids reporting literal 0% or 100% from finite samples.
    const smoothed = (hits + 0.5) / (n + 1);
    probabilities[threshold + "x"] = {
      estimate: Number(smoothed.toFixed(4)),
      observed: Number((hits / n).toFixed(4)),
      interval95: {
        low: Number(interval.low.toFixed(4)),
        high: Number(interval.high.toFixed(4))
      },
      hits
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = q => sorted[Math.min(n - 1, Math.floor((n - 1) * q))];
  return {
    sampleSize: n,
    median: Number(quantile(0.5).toFixed(3)),
    p10: Number(quantile(0.1).toFixed(3)),
    p90: Number(quantile(0.9).toFixed(3)),
    probabilities
  };
}

function analyzeRounds(input) {
  if (!Array.isArray(input) || input.length > MAX_ROUNDS) {
    throw new TypeError("rounds must be an array of at most " + MAX_ROUNDS + " values");
  }
  const values = input.map(Number);
  if (values.some(v => !Number.isFinite(v) || v < 1 || v > 1000000)) {
    throw new TypeError("Every multiplier must be finite and between 1 and 1000000");
  }
  const n = values.length;
  if (n < MIN_SAMPLE) {
    return {
      status: "insufficient_data",
      predictionAvailable: false,
      exactMultiplierPrediction: null,
      sampleSize: n,
      requiredSampleSize: MIN_SAMPLE,
      reason: "At least " + MIN_SAMPLE + " verified rounds are required for even a preliminary probability estimate.",
      warning: "More history does not make independent random outcomes predictable."
    };
  }

  const overall = summarize(values);
  const recentValues = values.slice(-100);
  const recent = summarize(recentValues);
  const previousValues = values.slice(-500, -100);
  const previous = previousValues.length ? summarize(previousValues) : null;
  const drift = {};
  if (previous) {
    for (const threshold of THRESHOLDS) {
      const key = threshold + "x";
      drift[key] = Number((recent.probabilities[key].observed - previous.probabilities[key].observed).toFixed(4));
    }
  }

  return {
    status: "empirical_probability_estimate",
    predictionAvailable: true,
    exactMultiplierPrediction: null,
    forecastType: "threshold_probabilities_not_exact_result",
    sampleSize: n,
    overall,
    recentWindow: recent,
    comparison: previous ? {
      previousWindowSize: previous.sampleSize,
      recentWindowSize: recent.sampleSize,
      observedProbabilityChange: drift,
      interpretation: "Descriptive drift only; it is not evidence that the next round will follow the recent pattern."
    } : null,
    confidence: "finite-sample confidence intervals; not a guarantee",
    warning: "This is historical frequency analysis. If rounds are independent, past multipliers do not reveal the next multiplier."
  };
}

module.exports = { analyzeRounds, wilson, MIN_SAMPLE, THRESHOLDS };
