import { readFile, writeFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import type { ProjectFile, ProjectFileKind } from "./types";
import { createId } from "./storage";

const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const textExts = new Set([".txt"]);
const markdownExts = new Set([".md", ".markdown"]);

export function safeFileName(input: string) {
  return input
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("__")
    .replace(/[<>:"|?*]/g, "_");
}

export function classifyFile(name: string): { kind: ProjectFileKind; mimeType: string } {
  const ext = path.extname(name).toLowerCase();
  if (markdownExts.has(ext)) return { kind: "markdown", mimeType: "text/markdown" };
  if (textExts.has(ext)) return { kind: "text", mimeType: "text/plain" };
  if (imageExts.has(ext)) {
    const mimeType = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
    return { kind: "image", mimeType };
  }
  return { kind: "unsupported", mimeType: "application/octet-stream" };
}

export async function extractZip(buffer: Buffer, targetDir: string): Promise<ProjectFile[]> {
  const zip = await JSZip.loadAsync(buffer);
  const files: ProjectFile[] = [];

  for (const [zipPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const { kind, mimeType } = classifyFile(zipPath);
    const content = await entry.async("nodebuffer");
    const outputName = safeFileName(zipPath);
    const relativePath = path.join("files", outputName);
    if (kind !== "unsupported") {
      await writeFile(path.join(targetDir, outputName), content);
    }
    files.push({
      id: createId("file"),
      name: zipPath,
      relativePath,
      kind,
      mimeType,
      size: content.length
    });
  }

  return files;
}

export async function readTextAssets(projectDir: string, files: ProjectFile[]) {
  const textFiles = files.filter((file) => file.kind === "text" || file.kind === "markdown");
  const parts: string[] = [];
  for (const file of textFiles) {
    const absolute = path.join(projectDir, file.relativePath);
    const content = await readFile(absolute, "utf8");
    parts.push(`## ${file.name}\n\n${content}`);
  }
  return parts.join("\n\n---\n\n");
}

export async function readImageAssets(projectDir: string, files: ProjectFile[]) {
  const imageFiles = files.filter((file) => file.kind === "image");
  const images = [];
  for (const file of imageFiles.slice(0, 12)) {
    const absolute = path.join(projectDir, file.relativePath);
    const buffer = await readFile(absolute);
    images.push({
      name: file.name,
      mimeType: file.mimeType,
      dataUrl: `data:${file.mimeType};base64,${buffer.toString("base64")}`
    });
  }
  return images;
}
