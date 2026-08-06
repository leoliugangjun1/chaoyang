import type { StepKey, StepResult } from "./types";
import { stepLabel } from "./storage";

type ImageAsset = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

function endpointFromBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/chat/completions`;
}

function extractJson(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("模型返回内容不是有效 JSON。");
}

function resultSchema(step: StepKey) {
  const visualStrategyField =
    step === "visualStrategy"
      ? `,
  "visualStrategy": {
    "targetUser": "string",
    "purchaseMotivation": "string",
    "purchaseConcerns": "string",
    "coreSellingPoints": ["string"],
    "visualizableSellingPoints": ["string"],
    "competitorVisualMethods": ["string"],
    "referenceDirection": ["string"],
    "avoidDirection": ["string"],
    "differentiatedVisualPositioning": "string",
    "executionStrategy": ["string"]
  }`
      : "";

  return `{
  "status": "pass | needs_input | risk",
  "confidence": "high | medium | low",
  "summary": "string",
  "missingItems": ["string"],
  "conflictItems": ["string"],
  "dataPackage": { "key": "value" }${visualStrategyField}
}`;
}

function offlineResult(params: {
  step: StepKey;
  projectContext: string;
  activeRule: string;
  previousResults: string;
  images: ImageAsset[];
}) {
  const textLength = params.projectContext.trim().length;
  const hasPrevious = params.previousResults.trim().length > 0;
  const imageNames = params.images.map((image) => image.name);
  const rulePreview = params.activeRule.split(/\r?\n/).filter(Boolean).slice(0, 5);

  const commonPackage = {
    mode: "offline",
    step: params.step,
    textLength,
    imageCount: params.images.length,
    imageNames,
    activeRulePreview: rulePreview,
    note: "当前为本地离线模式，未调用大模型 API。结果用于验证工作台链路、文件解析、规则插口和项目保存。"
  };

  const result: StepResult = {
    status: "risk",
    confidence: "low",
    summary: `${stepLabel(params.step)}已在本地离线模式完成。系统已读取文本资料、图片清单和当前规则，但未执行大模型判断。`,
    missingItems:
      params.step === "productFacts"
        ? ["需要接入多模态模型后识别图片内容。", "需要由模型按规则判断产品事实缺失项和冲突项。"]
        : ["需要接入模型后生成该步骤的业务判断结论。"],
    conflictItems: [],
    dataPackage: commonPackage
  };

  if (params.step === "marketAnalysis") {
    result.dataPackage = {
      ...commonPackage,
      upstreamAvailable: hasPrevious,
      targetUser: "待模型分析",
      purchaseMotivation: "待模型分析",
      purchaseConcerns: "待模型分析",
      competitorDirection: "待模型分析"
    };
  }

  if (params.step === "visualStrategy") {
    result.visualStrategy = {
      targetUser: "待模型分析",
      purchaseMotivation: "待模型分析",
      purchaseConcerns: "待模型分析",
      coreSellingPoints: ["待模型分析"],
      visualizableSellingPoints: ["待模型分析"],
      competitorVisualMethods: ["待模型分析"],
      referenceDirection: ["待模型分析"],
      avoidDirection: ["待模型分析"],
      differentiatedVisualPositioning: "待模型分析",
      executionStrategy: ["接入真实或内网多模态模型后，按当前规则重新运行视觉策略步骤。"]
    };
    result.dataPackage = {
      ...commonPackage,
      upstreamAvailable: hasPrevious,
      visualStrategy: result.visualStrategy
    };
  }

  return {
    result,
    rawText: JSON.stringify(result, null, 2)
  };
}

export async function callLlm(params: {
  step: StepKey;
  projectContext: string;
  activeRule: string;
  previousResults: string;
  images: ImageAsset[];
}) {
  const mode = process.env.LLM_MODE || "offline";
  if (mode !== "api") {
    return offlineResult(params);
  }

  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const textModel = process.env.LLM_MODEL;
  const visionModel = process.env.LLM_VISION_MODEL || textModel;

  if (!apiKey || !baseUrl || !textModel) {
    throw new Error("缺少 LLM_API_KEY、LLM_BASE_URL 或 LLM_MODEL 配置。请在 .env 中配置后重试。");
  }

  const model = params.images.length > 0 ? visionModel : textModel;
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: [
        `当前步骤：${stepLabel(params.step)}`,
        "",
        "请严格按照规则执行判断，返回中文 JSON，不要返回 Markdown。",
        "如果资料不足，仍然可以继续分析，但需要降低 confidence，并把风险写入 missingItems 或 conflictItems。",
        "",
        "## 当前启用规则",
        params.activeRule,
        "",
        "## 项目资料",
        params.projectContext || "未提供文本资料。",
        "",
        "## 上游结果",
        params.previousResults || "暂无上游结果。",
        "",
        "## 返回 JSON 结构",
        resultSchema(params.step)
      ].join("\n")
    }
  ];

  for (const image of params.images) {
    userContent.push({ type: "text", text: `图片资料：${image.name}` });
    userContent.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }

  const response = await fetch(endpointFromBaseUrl(baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是视觉策略 AI 工作台的后台判断引擎。只基于输入资料、图片内容和规则文件生成判断。禁止把没有事实依据的卖点写成确定结论。"
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`大模型 API 调用失败：${response.status} ${errorText.slice(0, 500)}`);
  }

  const payload = await response.json();
  const rawText = payload?.choices?.[0]?.message?.content;
  if (!rawText || typeof rawText !== "string") {
    throw new Error("大模型 API 未返回可读取的文本结果。");
  }

  const result = extractJson(rawText) as StepResult;
  return { result, rawText };
}

export function resultToMarkdown(step: StepKey, result: StepResult) {
  const lines = [
    `# ${stepLabel(step)}`,
    "",
    `- 状态：${result.status}`,
    `- 置信度：${result.confidence}`,
    "",
    "## 摘要",
    "",
    result.summary || "无摘要。",
    "",
    "## 缺失项",
    "",
    ...(result.missingItems?.length ? result.missingItems.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "## 冲突项",
    "",
    ...(result.conflictItems?.length ? result.conflictItems.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "## 结构化数据包",
    "",
    "```json",
    JSON.stringify(result.dataPackage ?? {}, null, 2),
    "```"
  ];

  if (result.visualStrategy) {
    lines.push("", "## 视觉策略", "", "```json", JSON.stringify(result.visualStrategy, null, 2), "```");
  }

  return lines.join("\n");
}
