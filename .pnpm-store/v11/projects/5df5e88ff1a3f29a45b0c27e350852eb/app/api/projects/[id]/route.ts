import { NextResponse } from "next/server";
import { deleteProject, readProject, saveProject } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await readProject(id);
  return NextResponse.json({ project });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const project = await readProject(id);
  project.name = body.name ?? project.name;
  project.productName = body.productName ?? project.productName;
  project.category = body.category ?? project.category;
  project.targetChannel = body.targetChannel ?? project.targetChannel;
  project.businessGoal = body.businessGoal ?? project.businessGoal;
  await saveProject(project);
  return NextResponse.json({ project });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await readProject(id);
  await deleteProject(id);
  return NextResponse.json({ deleted: true, id });
}
