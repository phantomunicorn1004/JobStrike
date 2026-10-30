/* Regression tests for response completion and JSON extraction. Run: node tests/test-extraction.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(rootPath, file), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(read('autogen-json-extract.js'), ctx);
const pick = (s) => vm.runInContext(`autogenPickResumeJson(${JSON.stringify(s)})`, ctx);
const resume = (company, description='Worked on systems') => ({
  resume_template: 'default', job_title: 'Engineer', company_name: company,
  job_description: description, work_experience: [{ title: 'Engineer' }],
});
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('plain JSON parsed', () => assert.equal(pick(JSON.stringify(resume('Acme'))).obj.company_name, 'Acme'));
test('markdown fenced JSON parsed', () => assert.equal(pick('```json\n' + JSON.stringify(resume('Acme')) + '\n```').obj.company_name, 'Acme'));
test('valid curly quotes inside string are not corrupted', () => {
  const value = 'Used \u201cAgile\u201d, and \u201cScrum\u201d at work';
  const result = pick(JSON.stringify(resume('Acme', value)));
  assert.equal(result.obj.job_description, value);
});
test('best-effort repair of unescaped quotes in generated prose', () => {
  const invalid = '{"resume_template":"default","job_title":"Engineer","company_name":"Acme","job_description":"Worked with "React" and "Node""}';
  assert.equal(pick(invalid).obj.job_description, 'Worked with "React" and "Node"');
});
test('last generated JSON selected over earlier valid example', () => {
  const text = 'Example:\n' + JSON.stringify(resume('Example')) + '\nGenerated:\n' + JSON.stringify(resume('Actual'));
  assert.equal(pick(text).obj.company_name, 'Actual');
});
test('invalid final output does not silently select earlier valid sample', () => {
  const text = 'Example:\n' + JSON.stringify(resume('Example')) + '\nGenerated:\n{"resume_template":"default","job_title":"Engineer","company_name":"Actual", "job_description":';
  assert.equal(pick(text), null);
});
test('invalid final output with unclosed quote does not select sample', () => {
  const text = 'Example:\n' + JSON.stringify(resume('Example')) + '\nGenerated:\n{"resume_template":"default","job_title":"Engineer","company_name":"Actual", "job_description":"unfinished';
  assert.equal(pick(text), null);
});
test('unrelated JSON is not mistaken for resume', () => assert.equal(pick('{"ok":true}'), null));
test('unbalanced braces are rejected', () => assert.equal(pick('{"resume_template":"default","job_title":"Eng"'), null));
test('malformed bracket nesting is rejected', () => assert.equal(pick('{"resume_template":"default","skills":[1,2}}'), null));
test('job description braces inside strings are preserved', () => {
  const payload = resume('Acme', 'Migrated {API} to [v2]');
  assert.equal(pick(JSON.stringify(payload)).obj.job_description, payload.job_description);
});
test('parses object with resume content but no job metadata', () => {
  const payload={resume_template:'default',work_experience:[{role:'Developer'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(pick(JSON.stringify(payload)).obj)),payload);
});
test('newly completed JSON outranks earlier longer sample', () => {
  const text=JSON.stringify(resume('Example','X'.repeat(100)))+'\n'+JSON.stringify(resume('Real','short'));
  assert.equal(pick(text).obj.company_name,'Real');
});

// Minimal fake ChatGPT DOM to validate status state transitions without Chrome.
let responseText = '';
let stopVisible = false;
const assistant = {
  cloneNode() { return { textContent: responseText, querySelectorAll() { return []; } }; },
};
const contentCtx = vm.createContext({
  chrome: { runtime: { onMessage: { addListener() {} } } },
  document: {
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') return responseText ? [assistant] : [];
      return [];
    },
    querySelector() { return null; },
  },
  window: {},
});
vm.runInContext(read('chatgpt-content.js'), contentCtx);
const runContent = (expr) => vm.runInContext(expr,contentCtx);
test('content status returns malformed completed answer after DOM settles', () => {
  responseText = '{"resume_template": "X", "job_title": "Engineer"'; // no closing brace
  runContent('autogenGenerationStarted = true; autogenStopObserved = true; autogenAnswerBaseline = ""; autogenAnswerBaselineRoot = null; autogenPendingStableAnswer = null');
  assert.equal(runContent('autogenCheckStatus().state'), 'thinking');
  runContent('autogenPendingStableSince = Date.now() - 4000');
  const status = runContent('autogenCheckStatus()');
  assert.equal(status.state,'done');
  assert.equal(status.answer,responseText);
});
test('content status waits if raw response is still changing', () => {
  responseText = '{"resume_template":"X"}';
  runContent('autogenGenerationStarted=true; autogenStopObserved=true; autogenPendingStableAnswer=null;');
  assert.equal(runContent('autogenCheckStatus().state'), 'thinking');
  responseText += ', more characters';
  assert.equal(runContent('autogenCheckStatus().state'), 'thinking');
  runContent('autogenPendingStableSince = Date.now()-3500');
  assert.equal(runContent('autogenCheckStatus().state'), 'done');
});
test('content status without observed Stop requires longer quiet time', () => {
  responseText = '{"resume_template":"X"}';
  runContent('autogenGenerationStarted=true; autogenStopObserved=false; autogenPendingStableAnswer=null;');
  assert.equal(runContent('autogenCheckStatus().state'), 'thinking');
  runContent('autogenPendingStableSince = Date.now()-5000');
  assert.equal(runContent('autogenCheckStatus().state'), 'thinking');
  runContent('autogenPendingStableSince = Date.now()-13000');
  assert.equal(runContent('autogenCheckStatus().state'), 'done');
});
test('last assistant root prioritizes encompassing assistant wrapper', () => {
  const outer={ kind:'complete-assistant' }, inner={ kind:'first-fragment' };
  const turn={querySelector(sel) {
    if(sel==='[data-message-author-role="assistant"]') return outer;
    if(sel==='[data-markdown-text-style="assistant-message"]') return inner;
    return null;
  }};
  contentCtx.document.querySelectorAll=(sel) => {
    if (sel==='[data-turn-key]') return [turn];
    return [];
  };
  assert.equal(runContent('autogenFindLastAssistantRoot()'),outer);
});
test('on-demand injection includes all content script dependencies', () => {
  const source=read('background.js');
  assert.match(source, /files:\s*\["autogen-mode-detector\.js", "autogen-json-extract\.js", "autogen-model-adapter\.js", "chatgpt-content\.js"\]/);
});
test('disabled send button fails instead of faking Enter', () => {
  const source=read('chatgpt-content.js');
  assert.match(source, /Send button stayed disabled; prompt was not sent/);
  assert.doesNotMatch(source, /sent: "enter"/);
});

// Blocked-page detection: a fake page of text nodes, each inside the chrome or a message.
function blockPage(nodes, { selectors = {} } = {}) {
  const textNodes = nodes.map(([text, where]) => ({
    nodeValue: text,
    parentElement: { closest: (sel) => (where === 'message' && /data-message-author-role/.test(sel) ? {} : null) },
  }));
  const ctx = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: {
      body: {},
      querySelectorAll() { return []; },
      querySelector(sel) { return Object.keys(selectors).some((k) => sel.includes(k)) ? {} : null; },
      createTreeWalker(_root, _show, filter) {
        const accepted = textNodes.filter((n) => filter.acceptNode(n) === 1);
        let i = -1;
        return { get currentNode() { return accepted[i]; }, nextNode() { i += 1; return i < accepted.length; } };
      },
    },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  });
  vm.runInContext(read('chatgpt-content.js'), ctx);
  return vm.runInContext('autogenDetectBlock()', ctx);
}
test('usage limit banner blocks', () => {
  assert.equal(blockPage([["You've reached your GPT-5 limit. Try again later.", 'chrome']]), 'usage limit reached');
});
test('too many requests banner blocks', () => {
  assert.equal(blockPage([['Too many requests in 1 hour. Try again later.', 'chrome']]), 'too many requests');
});
test('the same words inside a chat message do not block', () => {
  assert.equal(
    blockPage([["Handle 'too many requests' errors; you've reached the limit of retries", 'message']]),
    '',
  );
});
test('a verification iframe blocks', () => {
  assert.equal(blockPage([], { selectors: { 'challenges.cloudflare.com': true } }), 'human verification required');
});
test('a normal page does not block', () => {
  assert.equal(blockPage([['New chat', 'chrome'], ['Temporary Chat', 'chrome']]), '');
});
test('typed disregard-previous note is gone (each job gets a fresh chat)', () => {
  assert.doesNotMatch(read('chatgpt-content.js'), /Please disregard all previous/);
  assert.match(read('autogen-api.js'), /startChatMode: "temporary"/);
});

let failures = 0;
for(const {name,run} of tests) {
  try { run(); console.log('PASS', name); }
  catch(e) { failures++; console.error('FAIL', name, e.message); }
}
console.log(`${tests.length-failures}/${tests.length} passed`);
process.exitCode = failures ? 1 : 0;
