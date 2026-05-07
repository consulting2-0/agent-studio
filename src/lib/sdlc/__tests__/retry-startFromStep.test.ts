/**
 * Unit tests for Phase 12 retry route logic — smart startFromStep calculation.
 *
 * We test the pure logic in isolation (no HTTP, no DB) by extracting
 * the step-selection algorithm into a helper that mirrors the route exactly.
 */

import { describe, it, expect } from "vitest";
import { IMPLEMENTATION_STEPS, GATE_STEPS } from "../orchestrator";

// ---------------------------------------------------------------------------
// Mirror of the retry route's startFromStep logic (pure function for testing)
// ---------------------------------------------------------------------------

function computeStartFromStep(
  currentStep: number,
  pipeline: string[],
): { startFromStep: number; wasGateBlock: boolean } {
  const failedStepId = pipeline[currentStep] ?? "";
  let startFromStep = currentStep;

  if (GATE_STEPS.has(failedStepId)) {
    let lastImplIdx = -1;
    for (let i = currentStep - 1; i >= 0; i--) {
      if (IMPLEMENTATION_STEPS.has(pipeline[i]!)) {
        lastImplIdx = i;
        break;
      }
    }
    if (lastImplIdx >= 0) {
      startFromStep = lastImplIdx;
    }
  }

  return { startFromStep, wasGateBlock: GATE_STEPS.has(failedStepId) };
}

function trimStepResults(
  stepResults: Record<string, string>,
  startFromStep: number,
): Record<string, string> {
  const trimmed: Record<string, string> = {};
  for (const [key, val] of Object.entries(stepResults)) {
    if (Number(key) < startFromStep) {
      trimmed[key] = val;
    }
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("retry — smart startFromStep (gate BLOCK)", () => {
  const PIPELINE = [
    "project_context",   // 0 — PLANNING
    "ecc-planner",       // 1 — PLANNING
    "ecc-implementer",   // 2 — IMPLEMENTATION
    "ecc-code-reviewer", // 3 — GATE
  ];

  it("steps back to last impl step when gate blocked (primary scenario)", () => {
    // After Phase 12 fix: gate BLOCK leaves currentStep = 3 (gateIdx)
    const { startFromStep, wasGateBlock } = computeStartFromStep(3, PIPELINE);
    expect(wasGateBlock).toBe(true);
    expect(startFromStep).toBe(2); // ecc-implementer
  });

  it("does not change startFromStep for non-gate failures", () => {
    // Implementation step crash: currentStep = 2
    const { startFromStep, wasGateBlock } = computeStartFromStep(2, PIPELINE);
    expect(wasGateBlock).toBe(false);
    expect(startFromStep).toBe(2); // unchanged
  });

  it("does not change startFromStep for planning step failures", () => {
    // Planning step crash: currentStep = 1
    const { startFromStep, wasGateBlock } = computeStartFromStep(1, PIPELINE);
    expect(wasGateBlock).toBe(false);
    expect(startFromStep).toBe(1); // unchanged
  });

  it("handles gate with no prior impl step (unusual pipeline config)", () => {
    // Hypothetical: gate is the very first step — no impl step before it
    const unusual = ["ecc-code-reviewer"];
    const { startFromStep, wasGateBlock } = computeStartFromStep(0, unusual);
    expect(wasGateBlock).toBe(true);
    expect(startFromStep).toBe(0); // stays at gateIdx — no impl step found
  });

  it("picks the LAST impl step when multiple impl steps precede the gate", () => {
    const multi = [
      "project_context",       // 0
      "ecc-implementer",       // 1 — IMPLEMENTATION
      "ecc-implementer",       // 2 — IMPLEMENTATION (duplicate for test)
      "ecc-code-reviewer",     // 3 — GATE
    ];
    const { startFromStep } = computeStartFromStep(3, multi);
    expect(startFromStep).toBe(2); // last impl before gate
  });

  it("handles security-reviewer gate correctly", () => {
    const pipeline = [
      "project_context",
      "ecc-planner",
      "ecc-implementer",
      "ecc-security-reviewer", // GATE
    ];
    const { startFromStep, wasGateBlock } = computeStartFromStep(3, pipeline);
    expect(wasGateBlock).toBe(true);
    expect(startFromStep).toBe(2); // ecc-implementer
  });
});

describe("retry — trimStepResults", () => {
  it("removes step results at and after startFromStep", () => {
    const results = { "0": "planning", "1": "arch", "2": "impl", "3": "gate" };
    const trimmed = trimStepResults(results, 2);
    expect(trimmed).toEqual({ "0": "planning", "1": "arch" });
  });

  it("keeps all results when startFromStep is beyond all existing", () => {
    const results = { "0": "step0", "1": "step1" };
    const trimmed = trimStepResults(results, 5);
    expect(trimmed).toEqual({ "0": "step0", "1": "step1" });
  });

  it("returns empty object when startFromStep is 0", () => {
    const results = { "0": "step0", "1": "step1" };
    const trimmed = trimStepResults(results, 0);
    expect(trimmed).toEqual({});
  });

  it("returns empty object when stepResults is empty", () => {
    const trimmed = trimStepResults({}, 2);
    expect(trimmed).toEqual({});
  });
});

describe("GATE_STEPS and IMPLEMENTATION_STEPS sets", () => {
  it("GATE_STEPS contains expected reviewers", () => {
    expect(GATE_STEPS.has("ecc-code-reviewer")).toBe(true);
    expect(GATE_STEPS.has("ecc-security-reviewer")).toBe(true);
  });

  it("GATE_STEPS does not contain implementation steps", () => {
    expect(GATE_STEPS.has("ecc-implementer")).toBe(false);
    expect(GATE_STEPS.has("ecc-planner")).toBe(false);
  });

  it("IMPLEMENTATION_STEPS contains implementers", () => {
    expect(IMPLEMENTATION_STEPS.has("ecc-implementer")).toBe(true);
  });

  it("IMPLEMENTATION_STEPS does not contain gate steps", () => {
    expect(IMPLEMENTATION_STEPS.has("ecc-code-reviewer")).toBe(false);
    expect(IMPLEMENTATION_STEPS.has("ecc-security-reviewer")).toBe(false);
  });
});
