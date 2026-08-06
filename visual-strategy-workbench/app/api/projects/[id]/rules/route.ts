import { NextResponse } from "next/server";
import type { StepKey } from "@/lib/types";
import { nowIso, readProject, saveProject, stepKeys } from "@/lib/storage";

export const runtime = "nodejs";

function isStep(value: unknown): value is StepKey {
  return typeof value === "string" && stepKeys.includes(value as StepKey);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const formData = await request.formData();
  const step = formData.get("step");
  const rule = formData.get("rule");

  if (!isStep(step)) {
    return NextResponse.json({ error: "规则步骤无效。" }, { status: 400 });
  }

  if (!(rule instanceof File)) {
    return NextResponse.json({ error: "请上传规则文件。" }, { status: 400 });
  }

  if (!rule.name.toLowerCase().endsWith(".md")) {
    return NextResponse.json({ error: "规则文件仅支持 .md。" }, { status: 400 });
  }

  const content = await rule.text();
  const project = await readProject(id);
  project.rules[step] = {
    step,
    enabled: true,
    fileName: rule.name,
    content,
    updatedAt: nowIso()
  };
  await saveProject(project);
  return NextResponse.json({ project });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (!isStep(body.step)) {
    return NextResponse.json({ error: "规则步骤无效。" }, { status: 400 });
  }

  const step: StepKey = body.step;
  const project = await readProject(id);
  project.rules[step] = { step, enabled: false };
  await saveProject(project);
  return NextResponse.json({ project });
}
