import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildSnapshot, buildHistory, PIN_START, PIN_END } from '../plugins/context-lens/snapshot.js';
import { llmRequest } from '../plugins/context-lens/plugin.js';

const body = { model: 'fixture-model', messages: [
  { role: 'system', content: 'PROJECT RULES\n\n可用技能（先使用 skillread 读取完整规约）：\n- audit: inspect changes' },
  { role: 'user', content: 'Check the project' },
  { role: 'assistant', tool_calls: [{ id: 'read-1', function: { name: 'read', arguments: '{"path":"main.go"}' } }] },
  { role: 'tool', tool_call_id: 'read-1', content: '<script>malicious()</script>\n' + 'real tool output\n'.repeat(100) },
], tools: [{ type: 'function', function: { name: 'read', description: 'Read project files', parameters: { type: 'object' } } }] };
const snapshot = buildSnapshot({ app: 'project', sessionId: 'one', body, protocol: 'chat_completions', foldableCalls: ['read-1'] }, '1');

test('lens projects actual protocol fields, distinguishes skill listings and omits media payloads', () => {
  assert.equal(snapshot.blocks.filter(block => block.kind === 'result').length, 1);
  assert.ok(snapshot.blocks.some(block => block.title === '技能目录'));
  assert.ok(snapshot.blocks.find(block => block.kind === 'result').foldable);
  assert.equal(snapshot.groups.reduce((sum, group) => sum + group.tokens, 0), snapshot.tokens);
  const anthropic = buildSnapshot({ body: { model: 'claude', system: 'RULES', messages: [{ role: 'user', content: [
    { type: 'tool_result', tool_use_id: 't1', content: 'RESULT' }, { type: 'image', source: { type: 'base64', data: 'SECRET_BINARY' } },
  ] }] }, foldableCalls: ['t1'] }, '2');
  assert.ok(anthropic.media);
  assert.ok(anthropic.blocks.some(block => block.kind === 'result' && block.text === 'RESULT'));
  assert.ok(!JSON.stringify(anthropic).includes('SECRET_BINARY'));
  const responses = buildSnapshot({ body: { instructions: 'BASE' + PIN_START + 'PINNED' + PIN_END, input: [
    { type: 'function_call_output', call_id: 'r1', output: 'RESPONSE' }, { role: 'user', content: [{ type: 'input_text', text: 'question' }] },
  ] } }, '3');
  assert.ok(responses.blocks.some(block => block.kind === 'pin' && block.text === 'PINNED'));
  assert.ok(responses.blocks.some(block => block.kind === 'result' && block.text === 'RESPONSE'));
  const opaque = buildSnapshot({body:{input:[{type:'reasoning', summary:[], encrypted_content:'OPAQUE_PAYLOAD'}]}}, 'opaque');
  assert.equal(opaque.tokens, 0);
  assert.ok(!JSON.stringify(opaque).includes('OPAQUE_PAYLOAD'));
  const long = buildSnapshot({ body: { messages: [{ role: 'user', content: 'x'.repeat(100000) }] } }, '4');
  assert.equal(long.blocks[0].text.length, 96000);
  assert.equal(long.blocks[0].tokens, 25000);
  assert.ok(long.truncated);
});

const html = await readFile(new URL('../plugins/context-lens/ui/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../plugins/context-lens/ui/app.js', import.meta.url), 'utf8');
const page = html.replace('<script src="_loopra/bridge.js"></script>', '').replace('<script src="app.js"></script>', () => `<script>${script}</script>`);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup({ holdDetail = false, recorded = snapshot, usage = null, summaries = null } = {}) {
  let config = {}, release, context = { workspaceHash: 'project', sessionId: 'project/one' };
  const listeners = [], requests = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(window) {
    window.loopra = { ready: Promise.resolve(), context, onContext: fn => listeners.push(fn),
      config: { get: async () => structuredClone(config), set: async value => { config = JSON.parse(JSON.stringify(value)); return config; } },
      request: async (action, value) => {
        requests.push({ action, value });
        if (action === 'list') return { records: context.workspaceHash === 'project' ? summaries || [{ ...recorded, blocks: undefined }] : [], usage };
        if (action === 'detail') { if (holdDetail) await new Promise(resolve => { release = resolve; }); return recorded; }
        if (action === 'clear') return { ok: true };
        throw new Error(action);
      },
    };
  } });
  return { window: dom.window, document: dom.window.document, get config() { return config; }, requests,
    release: () => release?.(), change: next => { context = next; listeners.forEach(fn => fn(next)); }, close: () => dom.window.close() };
}

test('lens UI filters real blocks, inspects inert text, and saves scoped pin/fold controls', async () => {
  const ui = setup();
  try {
    await settle(); await settle();
    const d = ui.document;
    assert.equal(d.querySelector('#overview').hidden, false);
    assert.equal(d.querySelectorAll('.grid-cell').length, 400);
    d.querySelector('#filters [data-kind="file"]').click();
    assert.equal(d.querySelectorAll('.block').length, 1);
    d.querySelector('.block').click();
    assert.equal(d.querySelector('#inspector').hidden, false);
    assert.match(d.querySelector('#inspect-text').textContent, /malicious/);
    assert.equal(d.querySelector('#inspect-text script'), null);
    d.querySelector('#fold-block').click(); await settle();
    assert.deepEqual(ui.config.rules[0].folded, ['read-1']);
    assert.equal(ui.config.rules[0].key, '["project","one"]');
    d.querySelector('#pin-block').click();
    d.querySelector('#pin-note').value = 'Remember the migration constraint';
    d.querySelector('#pin-note').dispatchEvent(new ui.window.Event('input'));
    d.querySelector('#pin-save').click(); await settle();
    const rewritten = llmRequest({ app: 'project', sessionId: 'one', system: 'BASE', config: ui.config });
    assert.match(rewritten.system, /Remember the migration constraint/);
    assert.deepEqual(rewritten.foldToolResults, ['read-1']);
    assert.deepEqual(llmRequest({ app: 'project', sessionId: 'two', system: 'BASE', config: ui.config }), {});
    assert.match(d.querySelector('#status').textContent, /下一次模型请求/);
  } finally { ui.close(); }
});

test('historical sessions project saved reasoning and calls without inventing request fields', () => {
  const record = buildHistory({ messages: [...body.messages.slice(1), { role: 'assistant', content: 'DONE', reasoning_content: 'PERSISTED THOUGHT' }], at: 123, revision: 'r1', agentId: 'pi', native: false }, { app: 'project', session: 'one' });
  assert.equal(record.origin, 'history');
  assert.equal(record.at, 123);
  assert.equal(record.native, false);
  assert.equal(record.model, '');
  assert.ok(record.blocks.every(block => block.source.startsWith('history[')));
  assert.ok(record.blocks.some(block => block.title === '已保存的思考记录' && block.text === 'PERSISTED THOUGHT'));
  assert.ok(record.blocks.some(block => block.title === 'read · main.go'));
  assert.ok(record.blocks.every(block => !block.foldable));
  assert.ok(!record.groups.some(group => ['tools', 'system'].includes(group.kind)));
});

test('external history is labelled and hides controls that only work on native requests', async () => {
  const recorded = buildHistory({ messages: body.messages.slice(1), at: 123, revision: 'r1', agentId: 'pi', native: false, truncated: true }, { app: 'project', session: 'one' });
  const ui = setup({ recorded });
  try {
    await settle(); await settle();
    const d = ui.document;
    assert.equal(d.querySelector('#overview').hidden, false);
    assert.match(d.querySelector('#measurement-label').textContent, /历史估算/);
    assert.match(d.querySelector('#capture-note').textContent, /不代表当时的完整模型请求.*截断/);
    assert.equal(d.querySelector('#pin-editor').hidden, true);
    d.querySelector('#legend [aria-label^="文件"]').click();
    d.querySelector('.block').click();
    assert.equal(d.querySelector('#fold-block').hidden, true);
    assert.equal(d.querySelector('#pin-block').hidden, true);
    assert.match(d.querySelector('#inspect-text').textContent, /real tool output/);
  } finally { ui.close(); }
});

test('long historical sessions retain the most recent blocks with unique identities', () => {
  const record = buildHistory({ messages: Array.from({ length: 810 }, (_, i) => ({ role: 'user', content: `message-${i}` })), revision: 'long' }, { app: 'project', session: 'one' });
  assert.equal(record.blocks.length, 800);
  assert.equal(record.blocks[0].text, 'message-10');
  assert.equal(record.blocks.at(-1).text, 'message-809');
  assert.equal(new Set(record.blocks.map(block => block.id)).size, 800);
  assert.equal(record.omitted, 10);
  assert.equal(record.truncated, true);
});

test('a late detail response cannot show the previous workspace snapshot', async () => {
  const ui = setup({ holdDetail: true });
  try {
    await settle();
    ui.change({ workspaceHash: 'other', sessionId: 'other/two' });
    await settle(); ui.release(); await settle();
    assert.equal(ui.document.querySelector('#overview').hidden, true);
    assert.equal(ui.document.querySelector('#empty').hidden, false);
    assert.equal(ui.document.querySelectorAll('.block').length, 0);
  } finally { ui.close(); }
});

test('capacity grid uses reported context, real cache statistics, and preserves view filters', async () => {
  const usage = { model: snapshot.model, at: snapshot.at + 1, lastPromptTokens: 2500, maxContextTokens: 10000, promptTokens: 10000, cacheHit: 3400 };
  const ui = setup({ usage });
  try {
    await settle(); await settle();
    const d = ui.document;
    assert.equal(d.querySelector('#total').textContent, '2.5K');
    assert.equal(d.querySelector('#capacity').textContent, '/ 10K token');
    assert.equal(d.querySelector('#measurement-label').textContent, '已计数');
    assert.equal(d.querySelector('#cache-rate').textContent, '34%');
    assert.equal(d.querySelector('#cache-bar').getAttribute('aria-valuenow'), '34');
    assert.equal(d.querySelector('#cache-fill').style.width, '34%');
    assert.match(d.querySelector('#cache-note').textContent, /3.4K.*6.6K/);
    assert.equal(d.querySelectorAll('.grid-cell').length, 400);
    assert.equal([...d.querySelectorAll('.grid-cell')].filter(cell => cell.title.startsWith('剩余空间')).length, 300);
    d.querySelector('#legend [aria-label^="文件"]').click();
    assert.equal(d.querySelectorAll('.block').length, 1);
    d.querySelector('#view-tree').click();
    assert.ok(d.querySelectorAll('.map-cell').length >= 4);
    assert.equal(d.querySelector('#view-tree').getAttribute('aria-pressed'), 'true');
    assert.equal(d.querySelector('#filters [data-kind="file"]').getAttribute('aria-pressed'), 'true');
    d.querySelector('#view-grid').click();
    assert.equal(d.querySelectorAll('.grid-cell').length, 400);
  } finally { ui.close(); }
});

test('missing usage and stale or mismatched model counts retain honest estimates', async () => {
  for (const usage of [null, { model: snapshot.model, at: snapshot.at - 1, lastPromptTokens: 9999 }, { model: 'other-model', at: snapshot.at + 1, lastPromptTokens: 9999, maxContextTokens: 10000 }]) {
    const ui = setup({ usage });
    try {
      await settle(); await settle();
      const d = ui.document;
      assert.match(d.querySelector('#total').textContent, /^~/);
      assert.equal(d.querySelector('#measurement-label').textContent, '估算');
      assert.equal(d.querySelector('#cache-rate').textContent, '—');
      assert.equal(d.querySelector('#cache-bar').hasAttribute('aria-valuenow'), false);
      assert.equal(d.querySelector('#capacity').textContent, '/ 未知窗口');
      assert.equal(d.querySelector('#health').hidden, true);
      assert.equal(d.querySelectorAll('.grid-cell').length, 400);
    } finally { ui.close(); }
  }
});

test('grouped tool results retain individual source and fold identity; expansion works', async () => {
  const recorded = buildSnapshot({ app: 'project', sessionId: 'one', protocol: 'chat_completions', body: { messages: [
    { role: 'user', content: 'inspect' },
    ...Array.from({ length: 2 }, (_, i) => ({ role: 'tool', name: 'powershell', tool_call_id: 'shell-' + i, content: 'output-' + i })),
  ], tools: Array.from({ length: 12 }, (_, i) => ({ name: 'tool-' + i })) }, foldableCalls: ['shell-0', 'shell-1'] }, 'grouped');
  const ui = setup({ recorded });
  try {
    await settle(); await settle();
    const d = ui.document;
    assert.equal(d.querySelectorAll('.block').length, 8);
    d.querySelector('#show-all').click();
    assert.equal(d.querySelectorAll('.block').length, 14);
    d.querySelector('#filters [data-kind="result"]').click();
    assert.equal(d.querySelectorAll('.block').length, 1);
    assert.match(d.querySelector('.block').textContent, /×2/);
    d.querySelector('.block').click();
    const select = d.querySelector('#inspect-parts');
    assert.equal(select.hidden, false);
    select.value = '1'; select.dispatchEvent(new ui.window.Event('change'));
    assert.equal(d.querySelector('#inspect-text').textContent, 'output-1');
    d.querySelector('#fold-block').click(); await settle();
    assert.deepEqual(ui.config.rules[0].folded, ['shell-1']);
    d.querySelector('#back').click();
    d.querySelector('#filters [data-kind=""]').click();
    assert.equal(d.querySelectorAll('.block').length, 8);
  } finally { ui.close(); }
});

test('Anthropic file reads use the same call metadata without counting tool results as user turns', () => {
  const record = buildSnapshot({ protocol: 'anthropic', body: { messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read the actor' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'read-a', name: 'read', input: { file_path: '/scripts/actor.gd' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-a', content: 'class_name Actor' }] },
  ] } }, 'anthropic-file');
  const file = record.blocks.find(block => block.kind === 'result');
  assert.equal(file.filePath, '/scripts/actor.gd');
  assert.equal(file.name, 'read');
  assert.equal(record.rounds, 1);
  assert.equal(file.turn, 1);
});
