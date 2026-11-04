const presetBox = document.getElementById("presets");
const presetsNote = document.getElementById("presets-note");
const customBox = document.getElementById("custom");
const counter = document.getElementById("counter");
const scopeBox = document.getElementById("scope");
const statusBox = document.getElementById("status");
const previewBox = document.getElementById("preview");
const saveButton = document.getElementById("save");
const clearButton = document.getElementById("clear");

const state = { preset: "", scope: "all" };
let previewTimer = 0;
let dirty = false;

function value(config, key, fallback) {
  const raw = config ? config[key] : undefined;
  return typeof raw === "string" ? raw : fallback;
}

function note(text) {
  presetsNote.textContent = text;
  presetsNote.hidden = !text;
}

function chips(options) {
  presetBox.textContent = "";
  const items = [{ id: "", label: "不选预设" }].concat(options || []);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = item.label;
    button.setAttribute("role", "radio");
    button.dataset.id = item.id;
    button.onclick = () => select(item.id);
    presetBox.appendChild(button);
  }
  render();
}

function scopeOf(raw) {
  return raw === "chat" || raw === "project" ? raw : "all";
}

function select(id) {
  state.preset = id;
  markDirty();
  render();
}

function markDirty() {
  dirty = true;
  statusBox.textContent = "";
  statusBox.className = "";
}

function render() {
  for (const button of presetBox.querySelectorAll(".chip")) {
    const on = button.dataset.id === state.preset;
    button.setAttribute("aria-checked", String(on));
    button.classList.toggle("on", on);
  }
  counter.textContent = customBox.value.length + " / 2000";
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(drawPreview, 150);
}

async function drawPreview() {
  const body = { preset: state.preset, custom: customBox.value };
  if (!body.preset && !customBox.value.trim()) {
    previewBox.textContent = "未设置风格，系统提示词保持原样。";
    previewBox.className = "empty";
    return;
  }
  try {
    const result = await loopra.request("preview", body);
    previewBox.textContent = result.text || "未设置风格，系统提示词保持原样。";
    previewBox.className = result.text ? "" : "empty";
  } catch (error) {
    previewBox.textContent = "无法生成预览：" + (error && error.message ? error.message : "插件未启用");
    previewBox.className = "empty";
  }
}

async function load() {
  try {
    await loopra.ready;
    const config = await loopra.config.get();
    state.preset = value(config, "preset", "");
    state.scope = scopeOf(value(config, "scope", "all"));
    customBox.value = value(config, "custom", "");
    scopeBox.value = state.scope;
    try {
      const options = await loopra.request("options");
      chips(options.presets);
      if (!options.presets.some(item => item.id === state.preset) && state.preset) {
        note("已保存的预设「" + state.preset + "」不在当前版本里，重新选择后会覆盖。");
      }
    } catch (error) {
      chips([]);
      note("插件未启用，暂时只能编辑这里的内容；启用后可以选择预设并保存。");
    }
    render();
    drawPreview();
  } catch (error) {
    statusBox.textContent = error && error.message ? error.message : "没有连上 Loopra";
    statusBox.className = "error";
  }
}

customBox.addEventListener("input", () => { markDirty(); render(); schedulePreview(); });
scopeBox.addEventListener("change", () => { markDirty(); schedulePreview(); });

saveButton.onclick = async () => {
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  statusBox.textContent = "保存中";
  statusBox.className = "";
  try {
    const saved = await loopra.config.set({
      preset: state.preset,
      custom: customBox.value.trim(),
      scope: scopeBox.value
    });
    state.scope = scopeOf(value(saved, "scope", scopeBox.value));
    scopeBox.value = state.scope;
    dirty = false;
    statusBox.textContent = state.preset || customBox.value.trim() ? "已保存，下一轮对话生效" : "已保存，系统提示词保持原样";
    statusBox.className = "ok";
    drawPreview();
  } catch (error) {
    statusBox.textContent = error && error.message ? error.message : "没有连上 Loopra";
    statusBox.className = "error";
  } finally {
    saveButton.disabled = false;
  }
};

clearButton.onclick = () => {
  state.preset = "";
  customBox.value = "";
  scopeBox.value = "all";
  render();
  markDirty();
  statusBox.textContent = "已清空，点「保存」后生效";
  schedulePreview();
};

load();
