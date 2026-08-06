import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getProjectDir, readProject } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await context.params;
  const project = await readProject(id);
  const file = project.files.find((item) => item.id === fileId);
  if (!file || file.kind !== "image") return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
  const filePath = path.join(getProjectDir(id), file.relativePath);
  const root = path.resolve(getProjectDir(id));
  if (!path.resolve(filePath).startsWith(`${root}${path.sep}`)) return NextResponse.json({ error: "文件路径无效。" }, { status: 400 });
  const content = await readFile(filePath);
  return new NextResponse(content, { headers: { "Content-Type": file.mimeType, "Cache-Control": "private, max-age=3600" } });
}
