import { NextResponse } from "next/server";
import type { Project } from "@/lib/types";
import { createId, emptyRules, listProjects, nowIso, saveProject } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const now = nowIso();
  const project: Project = {
    id: createId("project"),
    name: body.name || "未命名项目",
    productName: body.productName || "",
    category: body.category || "",
    targetChannel: body.targetChannel || "",
    businessGoal: body.businessGoal || "",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    files: [],
    rules: emptyRules(),
    runs: []
  };

  await saveProject(project);
  return NextResponse.json({ project });
}
