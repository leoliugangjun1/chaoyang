import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import type { Project, RuleSlot, StepKey } from "./types";

const root = process.cwd();
export const storageRoot = path.join(root, "storage");
export const projectsRoot = path.join(storageRoot, "projects");
export const uploadsRoot = path.join(storageRoot, "uploads");

const stepKeys: StepKey[] = ["productFacts", "marketAnalysis", "visualStrategy"];

export function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function ensureStorage() {
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(uploadsRoot, { recursive: true });
}

export function getProjectDir(projectId: string) {
  return path.join(projectsRoot, projectId);
}

export function getProjectFile(projectId: string) {
  return path.join(getProjectDir(projectId), "project.json");
}

export function emptyRules(): Record<StepKey, RuleSlot> {
  return {
    productFacts: { step: "productFacts", enabled: false },
    marketAnalysis: { step: "marketAnalysis", enabled: false },
    visualStrategy: { step: "visualStrategy", enabled: false }
  };
}

export async function saveProject(project: Project) {
  await ensureStorage();
  await mkdir(getProjectDir(project.id), { recursive: true });
  project.updatedAt = nowIso();
  await writeFile(getProjectFile(project.id), JSON.stringify(project, null, 2), "utf8");
}

export async function readProject(projectId: string): Promise<Project> {
  const raw = await readFile(getProjectFile(projectId), "utf8");
  return JSON.parse(raw) as Project;
}

export async function deleteProject(projectId: string) {
  await rm(getProjectDir(projectId), { recursive: true, force: true });
  await ensureStorage();
  const uploads = await readdir(uploadsRoot);
  await Promise.all(
    uploads
      .filter((fileName) => fileName.startsWith(`${projectId}-`))
      .map((fileName) => rm(path.join(uploadsRoot, fileName), { force: true }))
  );
}

export async function listProjects(): Promise<Project[]> {
  await ensureStorage();
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      projects.push(await readProject(entry.name));
    } catch {
      // Ignore incomplete project folders.
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeResult(projectId: string, runId: string, markdown: string, json: unknown) {
  const resultDir = path.join(getProjectDir(projectId), "results");
  await mkdir(resultDir, { recursive: true });
  await writeFile(path.join(resultDir, `${runId}.md`), markdown, "utf8");
  await writeFile(path.join(resultDir, `${runId}.json`), JSON.stringify(json, null, 2), "utf8");
}

export async function resetExtractedFiles(projectId: string) {
  const filesDir = path.join(getProjectDir(projectId), "files");
  try {
    await stat(filesDir);
    await rm(filesDir, { recursive: true, force: true });
  } catch {
    // Nothing to remove.
  }
  await mkdir(filesDir, { recursive: true });
  return filesDir;
}

export function stepLabel(step: StepKey) {
  return {
    productFacts: "产品事实判断",
    marketAnalysis: "市场分析",
    visualStrategy: "视觉策略"
  }[step];
}

export { stepKeys };
