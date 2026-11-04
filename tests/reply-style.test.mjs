import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as plugin from '../plugins/reply-style/plugin.js';

const html = await readFile(new URL('../plugins/reply-style/ui/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../plugins/reply-style/ui/app.js', import.meta.url), 'utf8');
const page = html
  .replace('<script src="_loopra/bridge.js"></script>', '')
  .replace('<script src="app.js"></script>', () => `<script>${script}</script>`);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setup({ config = {}, enabled = true } = {}) {
  let stored = { ...config };
  const requests = [];
  const dom = new JSDOM(page, { runScripts: 'dangerously', url: 'https://plugin.test/', beforeParse(window) {
    window.loopra = {
      ready: Promise.resolve(),
      config: {
        get: async () => ({ ...stored }),
        set: async value => { stored = { ...stored, ...value }; return { ...stored }; },
      },
      request: async (action, value) => {
        requests.push({ action, value });
        if (!enabled) throw new Error('插件未启用');
        return plugin.onRequest({ action, value, config: stored });
      },
    };
  } });
  const { window } = dom;
  return { dom, window, document: window.document, requests, stored: () => ({ ...stored }), close: () => dom.window.close() };
}

test('reply-style appends the chosen preset and custom rules to the system prompt', () => {
  const input = { app: 'project', config: { preset: 'concise', custom: '  代码块之外不要用列表。\n\n', scope: 'all' } };
  const result = plugin.systemPrompt(input);
  assert.match(result.append, /## 回复风格/);
  assert.match(result.append, /直接给答案/);
  assert.match(result.append, /代码块之外不要用列表。$/m);
  assert.ok(!result.append.includes('\n\n\n'));
  assert.ok(result.append.endsWith('以它们为准。'));
});

test('reply-style leaves the prompt untouched when nothing is configured', () => {
  assert.deepEqual(plugin.systemPrompt({ app: 'project', config: {} }), {});
  assert.deepEqual(plugin.systemPrompt({ app: 'project', config: { preset: 'nope', custom: '   ' } }), {});
  assert.deepEqual(plugin.systemPrompt(undefined), {});
});

test('reply-style honors the selected scope and runs after other personas', () => {
  const chat = { preset: 'formal', scope: 'chat' };
  assert.deepEqual(plugin.systemPrompt({ app: 'project', config: chat }), {});
  assert.match(plugin.systemPrompt({ app: '__loopra_chat__', config: chat }).append, /中性、克制的书面语/);
  const project = { preset: 'formal', scope: 'project' };
  assert.match(plugin.systemPrompt({ app: 'project', config: project }).append, /中性、克制的书面语/);
  assert.deepEqual(plugin.systemPrompt({ app: '__loopra_chat__', config: project }), {});
  assert.match(plugin.systemPrompt({ app: 'project', config: { preset: 'concise', scope: 'all' } }).append, /直接给答案/);
  assert.equal(plugin.meta.hookPriority.systemPrompt, 10);
  const customOnly = plugin.systemPrompt({ app: 'project', config: { custom: 'x'.repeat(5000) } }).append;
  assert.ok(customOnly.includes('x'.repeat(2000)) && !customOnly.includes('x'.repeat(2001)), 'custom text is capped');
});

test('reply-style works with a preset only, custom only, or both', () => {
  const presetOnly = plugin.systemPrompt({ app: 'project', config: { preset: 'casual' } }).append;
  assert.match(presetOnly, /用日常口语/);
  assert.ok(!presetOnly.includes('最多两层列表。'));
  const customOnly = plugin.systemPrompt({ app: 'project', config: { custom: '最多两层列表。' } }).append;
  assert.match(customOnly, /最多两层列表。/);
  assert.ok(!customOnly.includes('用日常口语'));
  const both = plugin.systemPrompt({ app: 'project', config: { preset: 'casual', custom: '最多两层列表。' } }).append;
  assert.ok(both.indexOf('用日常口语') < both.indexOf('最多两层列表。'), 'custom rules come after the preset');
  assert.ok(both.indexOf('最多两层列表。') < both.indexOf('只改变表达方式'), 'safety clause stays last');
  const preview = plugin.onRequest({ action: 'preview', value: { preset: 'casual', custom: '最多两层列表。' } });
  assert.equal(preview.text, both, 'preview matches what is actually appended');
});

test('reply-style page loads, previews and saves settings', async () => {
  const ui = setup({ config: { preset: 'conclusion', custom: '先说要改哪个文件。', scope: 'chat' } });
  try {
    await settle();
    const d = ui.document;
    assert.equal(d.querySelector('#custom').value, '先说要改哪个文件。');
    assert.equal(d.querySelector('#scope').value, 'chat');
    const chips = [...d.querySelectorAll('.chip')];
    assert.equal(chips[0].textContent, '不选预设');
    assert.equal(chips.find(chip => chip.textContent === '结论先行').getAttribute('aria-checked'), 'true');

    chips.find(chip => chip.textContent === '要点式').click();
    assert.equal(chips.find(chip => chip.textContent === '结论先行').getAttribute('aria-checked'), 'false');
    d.querySelector('#custom').value = '最多两层列表。';
    d.querySelector('#custom').dispatchEvent(new ui.window.Event('input'));
    d.querySelector('#scope').value = 'project';
    d.querySelector('#scope').dispatchEvent(new ui.window.Event('change'));
    d.querySelector('#save').click();
    await settle();

    assert.deepEqual(ui.stored(), { preset: 'outline', custom: '最多两层列表。', scope: 'project' });
    assert.equal(d.querySelector('#status').className, 'ok');
    assert.match(d.querySelector('#status').textContent, /下一轮对话生效/);
    assert.match(d.querySelector('#preview').textContent, /用短句和列表组织内容/);
    assert.match(d.querySelector('#counter').textContent, /^7 \/ 2000$/);
    assert.ok(ui.requests.some(item => item.action === 'preview'));
  } finally { ui.close(); }
});

test('reply-style page clears settings and falls back when the plugin is disabled', async () => {
  const ui = setup({ config: { preset: 'casual', custom: '少用术语。', scope: 'all' } });
  try {
    await settle();
    const d = ui.document;
    d.querySelector('#clear').click();
    await settle();
    assert.equal(d.querySelector('#custom').value, '');
    assert.equal(d.querySelector('.chip.on').textContent, '不选预设');
    assert.match(d.querySelector('#status').textContent, /保存/);
    d.querySelector('#save').click();
    await settle();
    assert.deepEqual(ui.stored(), { preset: '', custom: '', scope: 'all' });
    assert.match(d.querySelector('#status').textContent, /保持原样/);
    assert.match(d.querySelector('#preview').textContent, /保持原样/);
  } finally { ui.close(); }

  const off = setup({ enabled: false });
  try {
    await settle();
    const d = off.document;
    assert.equal(d.querySelectorAll('.chip').length, 1, 'only the "no preset" chip remains');
    assert.equal(d.querySelector('#presets-note').hidden, false);
    assert.match(d.querySelector('#presets-note').textContent, /插件未启用/);
    d.querySelector('#custom').value = '只回答问到的内容。';
    d.querySelector('#custom').dispatchEvent(new off.window.Event('input'));
    await wait(200);
    await settle();
    assert.match(d.querySelector('#preview').textContent, /未启用/);
  } finally { off.close(); }
});
