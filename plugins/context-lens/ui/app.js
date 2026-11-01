(() => {
  const $ = id => document.getElementById(id);
  const tones = { system: "#8b5cf6", tools: "#0ea5e9", file: "#10b981", result: "#f45b0b", chat: "#5546ef", media: "#9ca3af", free: "var(--track)" };
  const labels = { system: "系统提示词", tools: "工具", file: "文件", result: "工具结果", chat: "会话内容", media: "媒体", free: "剩余空间" };
  let records = [], usage = null, snapshot = null, selectedBlock = null, selectedParts = [], filter = "", expanded = false;
  let following = true, generation = 0, pending = 0, picking = 0, scope = "";
  const number = value => {
    value = Math.max(0, Number(value) || 0);
    const unit = value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
    return (unit === 1 ? String(Math.round(value)) : (value / unit).toFixed(value / unit < 10 ? 2 : 1).replace(/\.?0+$/, "")) + (unit === 1e6 ? "M" : unit === 1e3 ? "K" : "");
  };
  const time = value => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); if (className) el.className = className; return el; }
  function status(text = "", error = false) { $("status").hidden = !text; $("status").textContent = text; $("status").className = error ? "error" : ""; }
  function showEmpty() {
    snapshot = null; selectedBlock = null; selectedParts = []; usage = null;
    $("empty").hidden = false; $("overview").hidden = true; $("inspector").hidden = true;
    $("blocks").replaceChildren(); $("map").replaceChildren();
    $("empty-text").textContent = "选择一段已有消息的会话，即可查看上下文。";
  }
  function back() { selectedBlock = null; following = true; $("inspector").hidden = true; $("overview").hidden = false; if (snapshot) renderBlocks(); }
  function kindOf(block) {
    if (block.kind === "system" || block.kind === "pin") return "system";
    if (block.kind === "user" || block.kind === "assistant") return "chat";
    if (block.kind === "result" && /(?:^|[._-])(?:read|readfile|read_file|file_read)(?:$|[._-])/i.test(block.name || "") && (block.filePath || block.title.includes(" · "))) return "file";
    return block.kind;
  }
  function metrics() {
    const current = snapshot.id === records[0]?.id;
    const sameModel = !snapshot.model || usage?.model === snapshot.model;
    const reported = current && sameModel && Number.isFinite(usage?.lastPromptTokens) && usage.lastPromptTokens > 0 &&
      (snapshot.origin === "history" ? usage.contextSource === "agent" : usage.at >= snapshot.at);
    return { reported, used: reported ? usage.lastPromptTokens : snapshot.tokens,
      capacity: sameModel && usage?.maxContextTokens > 0 ? usage.maxContextTokens : 0 };
  }
  function composition() {
    const { used, capacity } = metrics();
    const groups = Object.keys(labels).filter(kind => kind !== "free").map(kind => ({ kind, label: labels[kind], tokens: snapshot.blocks.filter(block => kindOf(block) === kind).reduce((sum, block) => sum + block.tokens, 0) })).filter(group => group.tokens > 0 || group.kind === "media" && snapshot.media);
    const textTotal = groups.reduce((sum, group) => sum + group.tokens, 0);
    groups.forEach(group => { group.weight = textTotal ? group.tokens / textTotal * used : 0; });
    if (capacity > used) groups.push({ kind: "free", label: labels.free, tokens: capacity - used, weight: capacity - used });
    return groups;
  }
  function renderMetrics() {
    const { used, capacity, reported } = metrics(), ratio = capacity ? used / capacity : 0;
    $("total").textContent = (reported ? "" : "~") + number(used);
    $("capacity").textContent = capacity ? `/ ${number(capacity)} token` : "/ 未知窗口";
    $("measurement-label").textContent = reported ? "已计数" : snapshot.origin === "history" ? "历史估算" : "估算";
    $("health").hidden = !capacity;
    $("health").textContent = ratio >= 1 ? "已满" : ratio >= .9 ? "紧张" : ratio >= .75 ? "留意" : "健康";
    $("health").className = "health" + (ratio >= .9 ? " danger" : ratio >= .75 ? " warning" : "");
    $("usage-note").textContent = capacity ? `已用 ${ratio > 0 && ratio < .01 ? "<1" : Math.round(ratio * 100)}% · ${ratio >= 1 ? "已达窗口上限" : ratio >= .9 ? "建议整理上下文" : ratio >= .75 ? "余量减少" : "余量充足"}` : "文本估算 · 窗口大小未知";
    const cached = usage?.cacheHit, prompt = usage?.promptTokens;
    const hasCache = Number.isFinite(cached) && cached >= 0 && prompt > 0;
    const rate = hasCache ? Math.min(100, cached / prompt * 100) : 0;
    $("cache-rate").textContent = hasCache ? Math.round(rate) + "%" : "—";
    $("cache-fill").style.width = rate + "%";
    $("cache-bar").setAttribute("aria-valuemin", "0"); $("cache-bar").setAttribute("aria-valuemax", "100");
    if (hasCache) $("cache-bar").setAttribute("aria-valuenow", String(Math.round(rate))); else $("cache-bar").removeAttribute("aria-valuenow");
    $("cache-bar").setAttribute("aria-valuetext", hasCache ? `本会话累计命中 ${Math.round(rate)}%` : "暂无缓存数据");
    $("cache-note").textContent = hasCache ? `${number(cached)} 来自缓存 · ${number(Math.max(0, prompt - cached))} 新增` : "暂无缓存数据";
    $("cache-note").title = "本会话累计提示词缓存统计";
  }
  function setFilter(kind) { filter = filter === kind ? "" : kind; expanded = false; renderMap(); renderBlocks(); }
  function renderMap() {
    if (!snapshot) return;
    const map = $("map"), legend = $("legend"); map.replaceChildren(); legend.replaceChildren();
    const groups = composition(), total = groups.reduce((sum, group) => sum + group.weight, 0);
    // Each nonempty text category gets at least one cell. Legend values stay exact.
    const shares = groups.map(group => {
      const exact = total ? group.weight / total * 400 : 0;
      const minimum = group.kind !== "free" && group.tokens > 0 ? 1 : 0;
      return { group, exact, minimum, count: Math.max(minimum, Math.floor(exact)) };
    });
    let remaining = 400 - shares.reduce((sum, share) => sum + share.count, 0);
    while (remaining < 0) {
      const adjustable = shares.filter(share => share.count > share.minimum);
      const donor = adjustable.find(share => share.group.kind === "free") || adjustable.sort((a, b) => b.count - a.count)[0];
      if (!donor) break;
      donor.count--; remaining++;
    }
    while (remaining > 0 && total) {
      const recipient = [...shares].sort((a, b) => (b.exact - b.count) - (a.exact - a.count))[0];
      recipient.count++; remaining--;
    }
    shares.forEach(({ group, count }) => {
      for (let i = 0; i < count; i++) {
        const cell = node("span", undefined, `grid-cell${filter && group.kind !== filter ? " dimmed" : ""}`);
        cell.dataset.kind = group.kind;
        cell.style.setProperty("--tone", tones[group.kind]); cell.setAttribute("aria-hidden", "true"); cell.title = `${group.label} ${number(group.tokens)}`;
        cell.onclick = () => { if (group.kind !== "free") setFilter(group.kind); }; map.append(cell);
      }
    });
    if (!total) for (let i = map.children.length; i < 400; i++) map.append(node("span", undefined, "grid-cell"));
    groups.forEach(group => {
      const button = node("button"); button.type = "button"; button.style.setProperty("--tone", tones[group.kind]);
      button.setAttribute("aria-label", `${group.label}，${number(group.tokens)} tokens`); button.setAttribute("aria-pressed", String(filter === group.kind));
      button.append(node("i"), node("span", group.label), node("span", number(group.tokens), "legend-value"));
      if (group.kind === "free") button.disabled = true; else button.onclick = () => setFilter(group.kind); legend.append(button);
    });
  }
  function rows() {
    const grouped = new Map(); let turn = 0, lastUserSource = "";
    function append(kind, title, path, block) {
      const key = JSON.stringify([kind, title, path]);
      if (!grouped.has(key)) grouped.set(key, { kind, title, path, tokens: 0, blocks: [] });
      const row = grouped.get(key); row.tokens += block.tokens; row.blocks.push(block);
    }
    snapshot.blocks.forEach(block => {
      const kind = kindOf(block);
      if (Number.isInteger(block.turn) && block.turn > 0) turn = block.turn;
      else if (block.kind === "user") {
        const source = block.source.match(/^(?:messages|input|history)\[\d+\]/)?.[0] || block.id;
        if (source !== lastUserSource) turn++;
        lastUserSource = source;
      }
      // A round includes all of its messages, reasoning, calls and results.
      // Shared system instructions and tool definitions stay outside the round.
      if (["chat", "file", "result", "media"].includes(kind)) append("chat", `第 ${turn || 1} 轮`, "", block);
      if (kind === "chat") return;
      const filePath = block.filePath || (kind === "file" ? block.title.split(" · ").slice(1).join(" · ") : "");
      const parts = filePath.replace(/\\/g, "/").split("/");
      const title = kind === "file" ? parts.pop() : block.title;
      const path = kind === "file" ? parts.join("/") : "";
      append(kind, title, path, block);
    });
    return [...grouped.values()].sort((a, b) => b.tokens - a.tokens);
  }
  function previewLimit() {
    const bounds = $("blocks").getBoundingClientRect();
    if (!bounds.width) return 8;
    const outerHeight = el => { const style = getComputedStyle(el); return el.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom); };
    const mainStyle = getComputedStyle(document.querySelector("main")), bodyStyle = getComputedStyle(document.body);
    const reserve = outerHeight(document.querySelector(".session-footer")) + ($("show-all").hidden ? 0 : outerHeight($("show-all"))) + parseFloat(mainStyle.paddingBottom) + parseFloat(mainStyle.borderBottomWidth) + parseFloat(bodyStyle.paddingBottom);
    return Math.max(8, Math.floor((innerHeight - bounds.top - scrollY - reserve) / 36));
  }
  function renderBlocks() {
    if (!snapshot) return;
    const items = rows().filter(row => !filter || row.kind === filter);
    $("blocks").replaceChildren(); $("filters").replaceChildren();
    ["", ...Object.keys(labels).filter(kind => kind !== "free" && (kind !== "media" || snapshot.media))].forEach(kind => {
      const button = node("button", kind ? labels[kind] : "全部"); button.type = "button"; button.dataset.kind = kind;
      button.setAttribute("aria-pressed", String(filter === kind)); button.onclick = () => { filter = kind; expanded = false; renderMap(); renderBlocks(); }; $("filters").append(button);
    });
    $("no-results").hidden = !!items.length;
    $("show-all").hidden = items.length <= 8;
    $("show-all").textContent = expanded ? "收起" : `显示全部 ${items.length} 项`;
    const limit = previewLimit();
    const max = Math.max(1, ...items.map(row => row.tokens));
    (expanded ? items : items.slice(0, limit)).forEach(row => {
      const button = node("button", undefined, "block"); button.type = "button"; button.style.setProperty("--tone", tones[row.kind]);
      const identity = node("span", undefined, "block-identity"); identity.append(node("i", undefined, "kind-mark"), node("strong", row.title));
      if (row.path) identity.append(node("span", row.path, "block-path"));
      const tag = node("span", undefined, "block-tag"); if (row.kind === "file" || row.kind === "result") tag.append(node("code", row.kind === "file" ? "read" : "result"));
      const bar = node("span", undefined, "block-bar"); bar.style.setProperty("--fill", row.tokens / max * 100 + "%"); bar.append(node("i"));
      button.append(identity, node("span", row.blocks.length > 1 ? "×" + row.blocks.length : "", "block-count"), tag, bar, node("span", row.kind === "media" ? "未计入" : number(row.tokens), "block-tokens"));
      button.title = row.blocks.map(block => block.title).join("\n");
      button.onclick = () => inspectRow(row.blocks); $("blocks").append(button);
    });
    $("show-all").hidden = items.length <= limit;
  }
  function renderSession() {
    const context = loopra.context || {};
    const workspace = (context.workspaceDir || snapshot.app || "会话").replace(/\\/g, "/").split("/").filter(Boolean).pop();
    $("breadcrumb").replaceChildren(node("span", "Loopra"), node("span", "›"), node("span", workspace), node("span", "›"), node("span", snapshot.session));
    $("breadcrumb").title = [context.workspaceDir || snapshot.app, snapshot.session].join(" / ");
    $("round-count").textContent = `${snapshot.rounds ?? rows().filter(row => row.kind === "chat").length} 轮`;
    const recent = records.filter(record => record.origin !== "history").slice().reverse();
    $("request-count").textContent = recent.length ? `${recent.length} 个快照` : "会话历史";
    $("trend").replaceChildren();
    if (!recent.length) return;
    const max = Math.max(1, ...recent.map(record => record.tokens));
    const points = recent.map((record, i) => [recent.length > 1 ? i / (recent.length - 1) * 1000 : 1000, 40 - record.tokens / max * 32]);
    function svg(tag, attrs, className) { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value))); el.setAttribute("class", className); return el; }
    const path = points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
    $("trend").append(svg("path", { d: `${path} L1000,44 L${points[0][0]},44 Z` }, "trend-area"), svg("path", { d: path }, "trend-line"));
    points.forEach(([x, y], i) => {
      const marker = svg("circle", { cx: x, cy: y, r: recent.length === 1 || recent[i].id === snapshot.id ? 3 : 0 }, "trend-point");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title"); title.textContent = `${time(recent[i].at)} · ~${number(recent[i].tokens)} tokens`; marker.append(title); $("trend").append(marker);
    });
    $("trend").setAttribute("aria-label", `最近 ${recent.length} 个请求的文本估算：${recent.map(record => number(record.tokens)).join("，")} tokens`);
  }
  function jsonToken(value) {
    const kind = value === null ? "null" : typeof value;
    return node("span", JSON.stringify(value), "json-" + kind);
  }
  function jsonNode(value, key, comma = "", root = false) {
    const composite = value !== null && typeof value === "object";
    const longString = typeof value === "string" && value.length > 160;
    const entries = composite ? Object.entries(value) : [];
    const expandable = root || entries.length > 0 || longString;
    const row = node(expandable ? "details" : "div", undefined, expandable ? "json-node" : "json-line");
    const line = expandable ? node("summary", undefined, "json-summary") : row;
    const punctuation = text => node("span", text, "json-punctuation");
    if (root) line.append(node("span", "JSON", "json-language"));
    if (key !== undefined) line.append(node("span", JSON.stringify(key), "json-key"), punctuation(": "));
    if (composite) {
      const open = Array.isArray(value) ? "[" : "{", close = Array.isArray(value) ? "]" : "}";
      line.append(punctuation(open));
      if (expandable) {
        line.append(node("span", ` … ${close}${comma}`, "json-preview"), node("span", `${entries.length} 项`, "json-count"));
        let loaded = false;
        row.addEventListener("toggle", () => {
          if (!row.open || loaded) return;
          loaded = true;
          const children = node("div", undefined, "json-children");
          entries.forEach(([name, item], index) => children.append(jsonNode(item, Array.isArray(value) ? undefined : name, index < entries.length - 1 ? "," : "")));
          const end = node("div", undefined, "json-line"); end.append(punctuation(close + comma));
          row.append(children, end);
        });
      } else line.append(punctuation(close + comma));
    } else if (expandable) {
      const preview = node("span", undefined, "json-preview");
      preview.append(jsonToken(longString ? value.slice(0, 100) + "…" : value), punctuation(comma)); line.append(preview);
      if (longString) line.append(node("span", `${number(value.length)} 字符`, "json-count"));
      let loaded = false;
      row.addEventListener("toggle", () => {
        if (!row.open || loaded) return;
        loaded = true;
        const full = node("div", undefined, "json-line json-full-value"); full.append(jsonToken(value), punctuation(comma)); row.append(full);
      });
    } else line.append(jsonToken(value), punctuation(comma));
    if (expandable) row.prepend(line);
    return row;
  }
  function renderContent(text) {
    $("inspect-json").replaceChildren(); $("inspect-text").textContent = "";
    let value;
    try { value = JSON.parse(text); } catch {
      $("inspect-json").hidden = true; $("inspect-text").hidden = false; $("inspect-text").textContent = text; return;
    }
    $("inspect-text").hidden = true; $("inspect-json").hidden = false;
    $("inspect-json").append(jsonNode(value, undefined, "", true));
  }
  function inspectRow(parts) {
    selectedParts = parts;
    $("inspect-parts").hidden = parts.length < 2;
    $("inspect-parts").replaceChildren(...parts.map((block, index) => { const option = node("option", `${index + 1}. ${block.title} · ~${number(block.tokens)}`); option.value = String(index); return option; }));
    inspect(parts[0]);
  }
  function inspect(block) {
    following = false; selectedBlock = block;
    $("overview").hidden = true; $("inspector").hidden = false;
    $("inspect-title").textContent = block.title; $("inspect-kind").style.setProperty("--tone", tones[kindOf(block)]);
    $("inspect-tokens").textContent = block.kind === "media" ? "媒体不计入估算" : "~" + number(block.tokens) + " tokens";
    $("inspect-source").textContent = block.source + " · " + time(snapshot.at); renderContent(block.text);
    $("inspect-note").hidden = !block.truncated;
    $("inspect-note").textContent = "此段过长，展示保留的开头部分；用量按截断前文本估算。";
  }
  async function pick(id) {
    const version = generation, request = ++picking;
    const next = await loopra.request("detail", { id });
    if (version !== generation || request !== picking) return;
    const changed = snapshot?.id !== next.id; snapshot = next;
    if (changed) { filter = ""; expanded = false; back(); }
    $("empty").hidden = true; if (!selectedBlock) $("overview").hidden = false;
    const historical = next.origin === "history";
    $("model").textContent = next.model || next.agent || "模型未知"; $("model").title = next.model || next.agent || "";
    $("capture-note").textContent = (historical ? "会话历史 · 不代表当时的完整模型请求" : "发送前快照 · 分类用量为文本估算，未计媒体与协议开销") + (next.truncated ? " · 部分内容已截断" : "");
    renderMetrics(); renderMap(); renderSession(); renderBlocks();
  }
  async function refresh(force = false) {
    if (pending && !force) return;
    const version = generation, request = ++pending;
    try {
      const data = await loopra.request("list"); if (version !== generation) return;
      status(data.warning || "", !!data.warning); records = data.records;
      const usageChanged = JSON.stringify(usage) !== JSON.stringify(data.usage || null); usage = data.usage || null;
      if (!records.length) { showEmpty(); return; }
      const selected = following || !records.some(record => record.id === snapshot?.id) ? records[0].id : snapshot.id;
      document.querySelector(".live-dot").classList.toggle("paused", !following || records.find(record => record.id === selected)?.origin === "history");
      if (selected !== snapshot?.id) await pick(selected);
      else { if (usageChanged) { renderMetrics(); renderMap(); } renderSession(); }
    } catch (error) { if (version === generation) status(error.message || String(error), true); }
    finally { if (version === generation && pending === request) pending = 0; }
  }
  $("show-all").onclick = () => { expanded = !expanded; renderBlocks(); };
  $("back").onclick = back;
  $("inspect-parts").onchange = () => inspect(selectedParts[Number($("inspect-parts").value)]);
  $("empty-refresh").onclick = () => refresh(true);
  window.addEventListener("resize", () => { if (snapshot && !$("overview").hidden) renderBlocks(); });
  loopra.ready.then(() => {
    const update = context => {
      const next = JSON.stringify([context.workspaceHash || "", context.sessionId || ""]); if (next === scope) return;
      scope = next; generation++; pending = 0; following = true; status(); showEmpty(); void refresh(true);
    };
    loopra.onContext(update); update(loopra.context);
    setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 2000);
  }).catch(error => status(error.message, true));
})();
