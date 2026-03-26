const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const CDP_PORT = 9252;
const URL = 'http://localhost:3001/#binary-explorer/droid';

async function run() {
  const pages = await new Promise(r => {
    http.get(`http://localhost:${CDP_PORT}/json`, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => r(JSON.parse(d)));
    });
  });

  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = id++;
    const h = raw => { const m = JSON.parse(raw.toString()); if (m.id === mid) { ws.off('message', h); resolve(m); } };
    ws.on('message', h);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  const eval_ = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      return 'ERROR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    }
    return r.result?.result?.value;
  };

  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`/tmp/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log(`  Screenshot: /tmp/${name}.png`);
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(6000);

  console.log('=== CDP VERIFICATION ===\n');

  // 1. Body text
  const text = await eval_('document.body.innerText.substring(0, 300)');
  console.log('1. Body text length:', typeof text === 'string' ? text.length : 'FAILED');
  console.log('   Preview:', typeof text === 'string' ? text.substring(0, 100) : text);

  // 2. Buttons
  const buttons = await eval_("[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>t.length>0).join(' | ')");
  console.log('2. Buttons:', buttons);

  // 3. Screenshot
  await screenshot('cdp_01_initial');
  console.log('3. Screenshot taken');

  // 4. EMPTY SCENE check
  const hasEmpty = await eval_("document.body.innerText.includes('EMPTY SCENE')");
  console.log('4. EMPTY SCENE visible:', hasEmpty);

  // 5. Data panel
  const hasNS = await eval_("document.body.innerText.includes('NAMESPACES')");
  const hasTF = await eval_("document.body.innerText.includes('TOP FEATURES')");
  console.log('5. Data panel: NAMESPACES=' + hasNS + ' TOP_FEATURES=' + hasTF);

  // 6. Click Seed Namespaces
  await eval_("document.querySelectorAll('button').forEach(b=>{if(b.textContent.includes('Seed: Namespaces'))b.click()})");
  await sleep(3000);
  const nodes = await eval_("document.querySelectorAll('g.nodes g').length");
  console.log('6. After Seed: ' + nodes + ' nodes');
  await screenshot('cdp_02_seeded');

  // 7. Click first node
  await eval_("document.querySelectorAll('g.nodes g')[0] && document.querySelectorAll('g.nodes g')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await sleep(2000);
  const hasCon = await eval_("document.body.innerText.includes('Connections')");
  console.log('7. After click: data panel has Connections=' + hasCon);
  await screenshot('cdp_03_clicked');

  // 8. Scene counter
  const scene = await eval_("(document.body.innerText.match(/\\d+\\/\\d+ in scene/) || ['none'])[0]");
  console.log('8. Scene counter: ' + scene);

  // 9. Type in chat
  await eval_("var inp = document.querySelector('input[type=\"text\"],input[placeholder]'); if(inp){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,'test'); inp.dispatchEvent(new Event('input',{bubbles:true}));}");
  const val = await eval_("(document.querySelector('input[type=\"text\"],input[placeholder]') || {}).value || 'NONE'");
  console.log('9. Chat input: ' + JSON.stringify(val));

  console.log('\n=== VERDICT: CDP ' + (typeof text === 'string' && text.length > 50 ? 'WORKS ✓' : 'BROKEN ✗') + ' ===');

  ws.close();
  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
