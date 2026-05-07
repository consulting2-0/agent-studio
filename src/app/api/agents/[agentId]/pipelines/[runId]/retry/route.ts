import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentOwner, isAuthError } from "@/lib/api/auth-guard";
import { logger } from "@/lib/logger";
import { getPipelineRun } from "@/lib/sdlc/pipeline-manager";
import { IMPLEMENTATION_STEPS, GATE_STEPS } from "@/lib/sdlc/orchestrator";
import { addPipelineRunJob } from "@/lib/queue";
import { prisma } from "@/lib/prisma";

const RetryBodySchema = z.object({
  modelId: z.string().optional(),
  useSmartRouting: z.boolean().default(false),
});

/**
 * POST /api/agents/[agentId]/pipelines/[runId]/retry
 *
 * Re-enqueues a FAILED or CANCELLED pipeline run from its last completed step.
 * Useful when a run was killed by a Railway container restart (stale run),
 * not due to a code error. Reads currentStep and stepResults from DB —
 * no need to re-run completed steps.
 *
 * For gate BLOCK failures: automatically steps back to the last implementation
 * step before the gate so the full impl → gate cycle reruns (giving the user
 * a chance to fix the code before re-evaluation).
 *
 * Only FAILED or CANCELLED runs can be retried. COMPLETED, RUNNING, and
 * AWAITING_APPROVAL runs return 409.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; runId: string }> },
) {
  const { agentId, runId } = await params;
  const authResult = await requireAgentOwner(agentId);
  if (isAuthError(authResult)) return authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = RetryBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 422 },
    );
  }

  const { modelId, useSmartRouting } = parsed.data;

  try {
    const run = await getPipelineRun(runId);

    if (!run) {
      return NextResponse.json(
        { success: false, error: "Pipeline run not found" },
        { status: 404 },
      );
    }

    if (run.agentId !== agentId) {
      return NextResponse.json(
        { success: false, error: "Pipeline run not found" },
        { status: 404 },
      );
    }

    if (run.status !== "FAILED" && run.status !== "CANCELLED") {
      return NextResponse.json(
        {
          success: false,
          error: `Pipeline run cannot be retried (status: ${run.status}). Only FAILED or CANCELLED runs can be retried.`,
        },
        { status: 409 },
      );
    }

    // Determine the correct step to restart from.
    // After the saveStepOutput fix, gate BLOCK leaves currentStep = gateIdx.
    // Restarting from gateIdx would block again (code unchanged).
    // Instead, go back to the last implementation step before the gate so the
    // full impl → gate cycle reruns (user can modify feedback before retrying).
    const failedStepIdx = run.currentStep;
    const pipelineArr = run.pipeline as string[];
    const failedStepId = pipelineArr[failedStepIdx] ?? "";

    let startFromStep = failedStepIdx;

    if (GATE_STEPS.has(failedStepId)) {
      // Find the last IMPLEMENTATION_STEPS step before the gate
      let lastImplIdx = -1;
      for (let i = failedStepIdx - 1; i >= 0; i--) {
        if (IMPLEMENTATION_STEPS.has(pipelineArr[i]!)) {
          lastImplIdx = i;
          break;
        }
      }
      if (lastImplIdx >= 0) {
        startFromStep = lastImplIdx;
      }
      // If no impl step found before gate (unusual config), stay at gateIdx
    }

    // Trim stepResults: preserve outputs for steps BEFORE startFromStep only.
    // This ensures re-run steps don't show stale outputs in the UI.
    const existingResults =
      run.stepResults &&
      typeof run.stepResults === "object" &&
      !Array.isArray(run.stepResults)
        ? (run.stepResults as Record<string, string>)
        : {};
    const trimmedStepResults: Record<string, string> = {};
    for (const [key, val] of Object.entries(existingResults)) {
      if (Number(key) < startFromStep) {
        trimmedStepResults[key] = val as string;
      }
    }

    // Enqueue FIRST — if this throws, run stays FAILED/CANCELLED (correct, user can retry again).
    // Only update DB status after job is safely in the queue.
    const jobId = await addPipelineRunJob({
      pipelineRunId: runId,
      agentId,
      userId: run.userId ?? undefined,
      modelId,
      useSmartRouting,
      requireApproval: run.requireApproval,
      startFromStep,
      existingStepResults: trimmedStepResults,
      repoUrl: run.repoUrl ?? undefined,
      sourceRepoUrl: run.sourceRepoUrl ?? undefined,
    });

    await prisma.pipelineRun.update({
      where: { id: runId },
      data: {
        status: "PENDING",
        error: null,
        jobId,
      },
    });

    logger.info("Pipeline run retry enqueued", {
      runId,
      agentId,
      resumingFromStep: startFromStep,
      totalSteps: run.pipeline.length,
      wasGateBlock: GATE_STEPS.has(failedStepId),
      jobId,
    });

    return NextResponse.json({
      success: true,
      data: {
        runId,
        status: "PENDING",
        resumingFromStep: startFromStep,
        totalSteps: run.pipeline.length,
      },
    });
  } catch (err) {
    logger.error("Pipeline retry failed", { runId, agentId, error: err });
    return NextResponse.json(
      { success: false, error: "Failed to retry pipeline run" },
      { status: 500 },
    );
  }
}
