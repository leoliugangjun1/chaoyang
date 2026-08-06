import { NextResponse } from "next/server";
import path from "path";
import type { RunRecord, StepKey, StepResult } from "@/lib/types";
import { defaultRules } from "@/lib/defaultRules";
import { readImageAssets, readTextAssets } from "@/lib/files";
import { callLlm, resultToMarkdown } from "@/lib/llm";
import { createId, getProjectDir, nowIso, readProject, saveProject, stepKeys, writeResult } from "@/lib/storage";

export const runtime = "nodejs";

function isStep(value: unknown): value is StepKey {
  return typeof value === "string" && stepKeys.includes(value as StepKey);
}

function previousResultsFor(step: StepKey, runs: RunRecord[]) {
  const order: StepKey[] = ["productFacts", "marketAnalysis", "visualStrategy"];
  const currentIndex = order.indexOf(step);
  const previousSteps = order.slice(0, currentIndex);
  const latestByStep = previousSteps
    .map((item) => [...runs].reverse().find((run) => run.step === item && run.status === "completed"))
    .filter(Boolean) as RunRecord[];
  return latestByStep.map((run) => JSON.stringify(run.result, null, 2)).join("\n\n---\n\n");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  if (!isStep(body.step)) {
    return NextResponse.json({ error: "运行步骤无效。" }, { status: 400 });
  }

  const step: StepKey = body.step;
  const project = await readProject(id);
  const projectDir = getProjectDir(id);
  const activeRule = project.rules[step]?.enabled
    ? project.rules[step].content || defaultRules[step]
    : defaultRules[step];

  project.status = "running";
  await saveProject(project);

  const runId = createId("run");
  const createdAt = nowIso();

  try {
    const textAssets = await readTextAssets(projectDir, project.files);
    const images = await readImageAssets(projectDir, project.files);
    const projectContext = [
      `项目名称：${project.name}`,
      `产品名称：${project.productName || "未填写"}`,
      `品类：${project.category || "未填写"}`,
      `目标渠道：${project.targetChannel || "未填写"}`,
      `业务目标：${project.businessGoal || "未填写"}`,
      "",
      textAssets
    ].join("\n");

    const previousResults = previousResultsFor(body.step, project.runs);
    const { result, rawText } = await callLlm({
      step,
      projectContext,
      activeRule,
      previousResults,
      images
    });

    const markdown = resultToMarkdown(body.step, result);
    await writeResult(id, runId, markdown, result);

    const run: RunRecord = {
      id: runId,
      step,
      status: "completed",
      createdAt,
      summary: result.summary,
      result,
      rawText
    };

    project.runs.push(run);
    project.status = step === "visualStrategy" ? "completed" : "uploaded";
    await saveProject(project);

    return NextResponse.json({ project, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "运行失败。";
    const result: StepResult = {
      status: "risk",
      confidence: "low",
      summary: message,
      missingItems: [],
      conflictItems: [],
      dataPackage: {}
    };
    const run: RunRecord = {
      id: runId,
      step,
      status: "failed",
      createdAt,
      summary: message,
      result,
      error: message
    };
    project.runs.push(run);
    project.status = "failed";
    await saveProject(project);
    await writeResult(id, runId, `# 运行失败\n\n${message}`, result);

    return NextResponse.json({ project, run, error: message }, { status: 500 });
  }
}
