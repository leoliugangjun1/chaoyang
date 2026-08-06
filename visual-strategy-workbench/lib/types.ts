export type StepKey = "productFacts" | "marketAnalysis" | "visualStrategy";

export type ProjectFileKind = "text" | "markdown" | "image" | "unsupported";

export type ProjectFile = {
  id: string;
  name: string;
  relativePath: string;
  kind: ProjectFileKind;
  mimeType: string;
  size: number;
};

export type RuleSlot = {
  step: StepKey;
  enabled: boolean;
  fileName?: string;
  content?: string;
  updatedAt?: string;
};

export type RunRecord = {
  id: string;
  step: StepKey;
  status: "completed" | "failed";
  createdAt: string;
  summary: string;
  result: unknown;
  rawText?: string;
  error?: string;
};

export type Project = {
  id: string;
  name: string;
  productName: string;
  category: string;
  targetChannel: string;
  businessGoal: string;
  status: "draft" | "uploaded" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  archiveName?: string;
  files: ProjectFile[];
  rules: Record<StepKey, RuleSlot>;
  runs: RunRecord[];
};

export type StepResult = {
  status: "pass" | "needs_input" | "risk";
  confidence: "high" | "medium" | "low";
  summary: string;
  missingItems: string[];
  conflictItems: string[];
  dataPackage: Record<string, unknown>;
  visualStrategy?: {
    targetUser: string;
    purchaseMotivation: string;
    purchaseConcerns: string;
    coreSellingPoints: string[];
    visualizableSellingPoints: string[];
    competitorVisualMethods: string[];
    referenceDirection: string[];
    avoidDirection: string[];
    differentiatedVisualPositioning: string;
    executionStrategy: string[];
  };
};
