import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { extractZip } from "@/lib/files";
import { getProjectDir, readProject, resetExtractedFiles, saveProject, uploadsRoot } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const formData = await request.formData();
  const archive = formData.get("archive");

  if (!(archive instanceof File)) {
    return NextResponse.json({ error: "请上传压缩包。" }, { status: 400 });
  }

  if (!archive.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "第一版仅支持 .zip 压缩包。" }, { status: 400 });
  }

  const project = await readProject(id);
  const buffer = Buffer.from(await archive.arrayBuffer());

  await mkdir(uploadsRoot, { recursive: true });
  await writeFile(path.join(uploadsRoot, `${id}-${archive.name}`), buffer);

  const filesDir = await resetExtractedFiles(id);
  const files = await extractZip(buffer, filesDir);

  project.archiveName = archive.name;
  project.files = files;
  project.status = "uploaded";
  await saveProject(project);

  return NextResponse.json({
    project,
    summary: {
      total: files.length,
      readable: files.filter((file) => file.kind !== "unsupported").length,
      images: files.filter((file) => file.kind === "image").length,
      unsupported: files.filter((file) => file.kind === "unsupported").length
    },
    projectDir: getProjectDir(id)
  });
}
