const chatApp = "__loopra_chat__";
const maxCustom = 2000;

// 预设只写“怎么说”，不碰能做什么。回复风格排在其它插件之后追加，
// 用户的明确选择优先于内置人设里的语气描述。
const presets = [
  { id: "concise", label: "简洁", text: "- 直接给答案，不寒暄、不复述问题、不总结刚说过的话。\n- 能一句话说清就不写一段，默认不超过三段。" },
  { id: "detailed", label: "详细", text: "- 给出完整推理和背景，说明为什么这样做。\n- 关键步骤、参数和边界条件写全，必要时配例子。" },
  { id: "conclusion", label: "结论先行", text: "- 第一句先给结论或结果，再补理由和细节。\n- 需要取舍时明确推荐一个方案，不要只罗列选项。" },
  { id: "outline", label: "要点式", text: "- 用短句和列表组织内容，一项一个要点。\n- 不写大段连续段落，层级不超过两层。" },
  { id: "casual", label: "口语", text: "- 用日常口语，像同事之间说话。\n- 少用术语和公文腔，句子短一些。" },
  { id: "formal", label: "严谨", text: "- 用中性、克制的书面语，不用夸张和情绪化表达。\n- 区分事实、推断和不确定；没有依据就直说。" }
];

function clean(value, limit) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n").map(line => line.trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

function presetOf(id) {
  return presets.find(item => item.id === id) || null;
}

function compose(config) {
  const preset = presetOf(config && config.preset);
  const custom = clean(config && config.custom, maxCustom);
  return [preset ? preset.text : "", custom].filter(Boolean).join("\n");
}

function block(body) {
  return "\n## 回复风格\n\n" + body + "\n- 这条只改变表达方式。工具审批、可用范围和安全规则继续有效，冲突时以它们为准。";
}

export const meta = {
  displayName: "回复风格",
  description: "在系统提示词末尾追加回复风格约定，可选预设并补充自己的要求",
  hookPriority: { systemPrompt: 10 }
};

function inScope(scope, app) {
  if (scope === "chat") return app === chatApp;
  if (scope === "project") return app !== chatApp;
  return true;
}

export function systemPrompt(input) {
  const config = (input && input.config) || {};
  if (!inScope(config.scope, input && input.app)) return {};
  const body = compose(config);
  return body ? { append: block(body) } : {};
}

// 设置页用同一个组合函数生成预览，避免页面和实际提示词各写一份。
export function onRequest(input) {
  const action = input && input.action;
  if (action === "options") return { presets: presets.map(({ id, label }) => ({ id, label })), maxCustom };
  if (action === "preview") {
    const body = compose(input.value || {});
    return { text: body ? block(body) : "" };
  }
  throw new Error("不支持的回复风格操作");
}
