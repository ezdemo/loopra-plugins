(() => {
  const $ = id => document.getElementById(id);
  const tones = { system: "#8b5cf6", tools: "#0ea5e9", file: "#10b981", result: "#f45b0b", chat: "#5546ef", media: "#9ca3af", free: "var(--track)" };
  const labels = { system: "系统提示词", tools: "工具", file: "文件", result: "工具结果", chat: "会话内容", media: "媒体", free: "剩余空间" };
  let records = [], usage = null, snapshot = null, selectedBlock = null, selectedParts = [], filter = "", view = "grid", expanded = false;
  let following = true, generation = 0, pending = 0, picking = 0, scope = "", dirty = false, saving = false, rule = { note: "", folded: [] };
  const number = value => {
    value = Math.max(0, Number(value) || 0);
    const unit = value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
    return (unit === 1 ? String(Math.round(value)) : (value / unit).toFixed(value / unit < 10 ? 2 : 1).replace(/\.?0+$/, "")) + (unit === 1e6 ? "M" : unit === 1e3 ? "K" : "");
  };
  const time = value => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const keyOf = record => JSON.stringify([record.app || "", record.session || ""]);
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); if (className) el.className = className; return el; }
  function status(text = "", error = false) { $("status").hidden = !text; $("status").textContent = text; $("status").className = error ? "error" : ""; }
  function action(task) { return async () => { try { await task(); } catch (error) { status(error.message || String(error), true); } }; }
  function showEmpty() {
    snapshot = null; selectedBlock = null; selectedParts = []; usage = null;
    $("empty").hidden = false; $("overview").hidden = true; $("inspector").hidden = true;
    $("blocks").replaceChildren(); $("map").replaceChildren(); $("requests").replaceChildren();
    $("empty-text").textContent = "选择一段已有消息的会话，即可查看上下文。";
  }
  function back() { selectedBlock = null; $("inspector").hidden = true; $("overview").hidden = false; }
  function syncRule(next) {
    rule = { note: typeof next?.note === "string" ? next.note : "", folded: Array.isArray(next?.folded) ? next.folded : [] };
    if (!dirty) $("pin-note").value = rule.note;
    $("pin-indicator").textContent = rule.note ? "已固定" : "";
    $("pin-count").textContent = $("pin-note").value.length + " / 2000";
    if (selectedBlock) renderFold();
  }
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
  function split(items, x, y, width, height, output = []) {
    if (!items.length) return output;
    if (items.length === 1) { output.push({ item: items[0], x, y, width, height }); return output; }
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let sum = 0, at = 1, best = Infinity;
    for (let i = 1; i < items.length; i++) { sum += items[i - 1].weight; const distance = Math.abs(total / 2 - sum); if (distance < best) { best = distance; at = i; } }
    const ratio = items.slice(0, at).reduce((sum, item) => sum + item.weight, 0) / total;
    if (width >= height) { split(items.slice(0, at), x, y, width * ratio, height, output); split(items.slice(at), x + width * ratio, y, width * (1 - ratio), height, output); }
    else { split(items.slice(0, at), x, y, width, height * ratio, output); split(items.slice(at), x, y + height * ratio, width, height * (1 - ratio), output); }
    return output;
  }
  function setFilter(kind) { filter = filter === kind ? "" : kind; expanded = false; renderMap(); renderBlocks(); }
  function renderMap() {
    if (!snapshot) return;
    const map = $("map"), legend = $("legend"); map.replaceChildren(); legend.replaceChildren(); map.className = "context-map " + view;
    const groups = composition(), total = groups.reduce((sum, group) => sum + group.weight, 0);
    if (view === "grid") {
      // Largest-remainder allocation keeps all 400 cells proportional, including free space.
      const shares = groups.map(group => { const exact = total ? group.weight / total * 400 : 0; return { group, count: Math.floor(exact), fraction: exact % 1 }; });
      let remaining = 400 - shares.reduce((sum, share) => sum + share.count, 0);
      const ranked = [...shares].sort((a, b) => b.fraction - a.fraction);
      for (let i = 0; i < remaining && ranked.length; i++) ranked[i % ranked.length].count++;
      shares.forEach(({ group, count }) => {
        for (let i = 0; i < count; i++) {
          const cell = node("span", undefined, `grid-cell${filter && group.kind !== filter ? " dimmed" : ""}`);
          cell.style.setProperty("--tone", tones[group.kind]); cell.setAttribute("aria-hidden", "true"); cell.title = `${group.label} ${number(group.tokens)}`;
          cell.onclick = () => { if (group.kind !== "free") setFilter(group.kind); }; map.append(cell);
        }
      });
      if (!total) for (let i = 0; i < 400; i++) map.append(node("span", undefined, "grid-cell"));
    } else {
      split(groups.filter(group => group.weight > 0), 0, 0, 100, 40).forEach(({ item, x, y, width, height }) => {
        const cell = node("button", undefined, `map-cell${width < 25 || height < 15 ? " small" : ""}${width < 12 || height < 8 ? " tiny" : ""}${filter === item.kind ? " active" : ""}`);
        cell.type = "button"; cell.style.cssText = `left:${x}%;top:${y / 40 * 100}%;width:${width}%;height:${height / 40 * 100}%;--tone:${tones[item.kind]}`;
        cell.setAttribute("aria-label", `${item.label}，约 ${number(item.tokens)} tokens`); cell.title = cell.getAttribute("aria-label");
        cell.setAttribute("aria-pressed", String(filter === item.kind)); cell.append(node("strong", item.label), node("span", number(item.tokens)));
        cell.onclick = () => { if (item.kind !== "free") setFilter(item.kind); }; map.append(cell);
      });
    }
    groups.forEach(group => {
      const button = node("button"); button.type = "button"; button.style.setProperty("--tone", tones[group.kind]);
      button.setAttribute("aria-label", `${group.label}，${number(group.tokens)} tokens`); button.setAttribute("aria-pressed", String(filter === group.kind));
      button.append(node("i"), node("span", group.label), node("span", number(group.tokens), "legend-value"));
      if (group.kind === "free") button.disabled = true; else button.onclick = () => setFilter(group.kind); legend.append(button);
    });
    $("view-grid").setAttribute("aria-pressed", String(view === "grid")); $("view-tree").setAttribute("aria-pressed", String(view === "tree"));
  }
  function rows() {
    const grouped = new Map(); let turn = 0;
    snapshot.blocks.forEach(block => {
      const kind = kindOf(block);
      if (block.kind === "user") turn++;
      const round = block.turn || turn || 1;
      const filePath = block.filePath || (kind === "file" ? block.title.split(" · ").slice(1).join(" · ") : "");
      const parts = filePath.replace(/\\/g, "/").split("/");
      const title = kind === "file" ? parts.pop() : kind === "chat" ? `第 ${round} 轮` : block.title;
      const path = kind === "file" ? parts.join("/") : "";
      const key = JSON.stringify([kind, title, path]);
      if (!grouped.has(key)) grouped.set(key, { kind, title, path, tokens: 0, blocks: [] });
      const row = grouped.get(key); row.tokens += block.tokens; row.blocks.push(block);
    });
    return [...grouped.values()].sort((a, b) => b.tokens - a.tokens);
  }
  function renderBlocks() {
    if (!snapshot) return;
    const query = $("search").value.toLocaleLowerCase().trim();
    const items = rows().filter(row => (!filter || row.kind === filter) && (!query || row.blocks.some(block => `${block.title} ${block.source} ${block.text}`.toLocaleLowerCase().includes(query))));
    $("blocks").replaceChildren(); $("filters").replaceChildren();
    ["", ...Object.keys(labels).filter(kind => kind !== "free" && (kind !== "media" || snapshot.media))].forEach(kind => {
      const button = node("button", kind ? labels[kind] : "全部"); button.type = "button"; button.dataset.kind = kind;
      button.setAttribute("aria-pressed", String(filter === kind)); button.onclick = () => { filter = kind; expanded = false; renderMap(); renderBlocks(); }; $("filters").append(button);
    });
    $("no-results").hidden = !!items.length;
    const max = Math.max(1, ...items.map(row => row.tokens));
    (expanded ? items : items.slice(0, 8)).forEach(row => {
      const button = node("button", undefined, "block"); button.type = "button"; button.style.setProperty("--tone", tones[row.kind]);
      const identity = node("span", undefined, "block-identity"); identity.append(node("i", undefined, "kind-mark"), node("strong", row.title));
      if (row.path) identity.append(node("span", row.path, "block-path"));
      const tag = node("span", undefined, "block-tag"); if (row.kind === "file" || row.kind === "result") tag.append(node("code", row.kind === "file" ? "read" : "result"));
      const bar = node("span", undefined, "block-bar"); bar.style.setProperty("--fill", row.tokens / max * 100 + "%"); bar.append(node("i"));
      button.append(identity, node("span", row.blocks.length > 1 ? "×" + row.blocks.length : "", "block-count"), tag, bar, node("span", row.kind === "media" ? "未计入" : number(row.tokens), "block-tokens"));
      button.title = row.blocks.map(block => block.title + (block.folded ? " · 已折叠" : "")).join("\n");
      button.onclick = () => inspectRow(row.blocks); $("blocks").append(button);
    });
    $("show-all").hidden = items.length <= 8;
    $("show-all").textContent = expanded ? "收起" : `显示全部 ${items.length} 项`;
  }
  function renderSession() {
    const context = loopra.context || {};
    const workspace = (context.workspaceDir || snapshot.app || "会话").replace(/\\/g, "/").split("/").filter(Boolean).pop();
    $("breadcrumb").replaceChildren(node("span", "Loopra"), node("span", "›"), node("span", workspace), node("span", "›"), node("span", snapshot.session));
    $("breadcrumb").title = [context.workspaceDir || snapshot.app, snapshot.session].join(" / ");
    $("round-count").textContent = `${snapshot.rounds ?? snapshot.blocks.filter(block => block.kind === "user").length} 轮`;
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
  function renderFold() {
    const folded = rule.folded.includes(selectedBlock.callId);
    $("fold-block").hidden = !selectedBlock.foldable;
    $("fold-block").textContent = folded ? "恢复下次发送原文" : "下次折叠此结果";
    $("fold-block").disabled = saving; $("pin-block").hidden = snapshot.native === false;
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
    $("inspect-source").textContent = block.source + " · " + time(snapshot.at); $("inspect-text").textContent = block.text;
    $("inspect-note").hidden = !block.truncated && !block.folded;
    $("inspect-note").textContent = block.truncated ? "此段过长，展示保留的开头部分；用量按截断前文本估算。" : "这份请求中的结果已经折叠。恢复发送原文将在下一次请求生效。";
    renderFold();
  }
  async function pick(id) {
    const version = generation, request = ++picking;
    const next = await loopra.request("detail", { id });
    if (version !== generation || request !== picking) return;
    const changed = snapshot?.id !== next.id; snapshot = next;
    if (changed) { dirty = false; filter = ""; expanded = false; $("search").value = ""; back(); }
    $("empty").hidden = true; if (!selectedBlock) $("overview").hidden = false;
    $("requests").value = next.id; $("time").textContent = time(next.at);
    const historical = next.origin === "history";
    $("model").textContent = next.model || next.agent || "模型未知"; $("model").title = next.model || next.agent || "";
    $("pin-editor").hidden = next.native === false; $("clear").hidden = historical;
    $("capture-note").textContent = (historical ? "会话历史 · 不代表当时的完整模型请求" : "发送前快照 · 分类用量为文本估算，未计媒体与协议开销") + (next.truncated ? " · 部分内容已截断" : "");
    renderMetrics(); renderMap(); renderBlocks(); renderSession();
    const config = await loopra.config.get();
    if (version !== generation || snapshot?.id !== next.id) return;
    syncRule((Array.isArray(config.rules) ? config.rules : []).find(item => item.key === keyOf(next)));
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
      $("requests").replaceChildren(...records.map((record, index) => {
        const option = node("option", `${record.origin === "history" ? "会话历史 · " : ""}${time(record.at)}${index === 0 && record.origin !== "history" ? " · 最新请求" : ""} · ~${number(record.tokens)}`); option.value = record.id; return option;
      }));
      $("requests").value = selected;
      document.querySelector(".live-dot").classList.toggle("paused", !following || records.find(record => record.id === selected)?.origin === "history");
      if (selected !== snapshot?.id) await pick(selected);
      else { if (usageChanged) { renderMetrics(); renderMap(); } renderSession(); }
    } catch (error) { if (version === generation) status(error.message || String(error), true); }
    finally { if (version === generation && pending === request) pending = 0; }
  }
  async function saveRule(change) {
    if (!snapshot || saving) return;
    const target = snapshot, version = generation;
    saving = true; $("pin-save").disabled = true; if (selectedBlock) renderFold();
    try {
      const config = await loopra.config.get(); if (version !== generation) return;
      const rules = Array.isArray(config.rules) ? config.rules : [];
      const old = rules.find(item => item.key === keyOf(target)) || { note: "", folded: [] };
      const next = { ...old, ...change, key: keyOf(target) };
      if (next.note.length > 2000 || next.folded.length > 64) throw new Error("每段会话最多固定 2000 字符、折叠 64 条结果");
      await loopra.config.set({ ...config, rules: [...rules.filter(item => item.key !== next.key).slice(-11), next] });
      if (version !== generation) return;
      dirty = false; syncRule(next); status("已保存，将在这段会话的下一次模型请求生效。");
    } finally { saving = false; $("pin-save").disabled = false; if (selectedBlock) renderFold(); }
  }
  $("requests").onchange = action(async () => { following = false; await pick($("requests").value); });
  $("latest").onclick = action(async () => { following = true; back(); await refresh(true); });
  $("view-tree").onclick = () => { view = "tree"; renderMap(); }; $("view-grid").onclick = () => { view = "grid"; renderMap(); };
  $("collapse").onclick = () => { $("window-body").hidden = !$("window-body").hidden; $("collapse").setAttribute("aria-expanded", String(!$("window-body").hidden)); };
  $("show-all").onclick = () => { expanded = !expanded; renderBlocks(); };
  $("search").oninput = () => { expanded = false; renderBlocks(); };
  $("search-toggle").onclick = () => { $("search").hidden = !$("search").hidden; $("search-toggle").setAttribute("aria-expanded", String(!$("search").hidden)); if (!$("search").hidden) $("search").focus(); else { $("search").value = ""; renderBlocks(); } };
  $("back").onclick = back;
  $("inspect-parts").onchange = () => inspect(selectedParts[Number($("inspect-parts").value)]);
  $("pin-note").oninput = () => { dirty = true; following = false; $("pin-count").textContent = $("pin-note").value.length + " / 2000"; };
  $("pin-save").onclick = action(() => saveRule({ note: $("pin-note").value.trim() }));
  $("fold-block").onclick = action(() => saveRule({ folded: rule.folded.includes(selectedBlock.callId) ? rule.folded.filter(id => id !== selectedBlock.callId) : [...rule.folded, selectedBlock.callId] }));
  $("pin-block").onclick = () => {
    const text = selectedBlock.text; back(); document.querySelector(".options").open = true; $("pin-editor").open = true; $("pin-note").value = text.slice(0, 2000); dirty = true;
    $("pin-note").oninput(); $("pin-note").focus(); if (text.length > 2000) status("已截取前 2000 字符，可编辑后保存。");
  };
  $("empty-refresh").onclick = () => refresh(true);
  $("clear").onclick = action(async () => { await loopra.request("clear"); await refresh(true); });
  loopra.ready.then(() => {
    const update = context => {
      const next = JSON.stringify([context.workspaceHash || "", context.sessionId || ""]); if (next === scope) return;
      scope = next; generation++; pending = 0; dirty = false; following = true; status(); showEmpty(); void refresh(true);
    };
    loopra.onContext(update); update(loopra.context);
    setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 2000);
  }).catch(error => status(error.message, true));
})();
