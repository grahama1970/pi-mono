const WebSocket = require('ws');
const fs = require('fs');

const WS_URL = 'ws://127.0.0.1:9253/devtools/page/0DDE0736E5ADE870D8D73A7E8BC40405';
const OUT_DIR = '/home/node/workspace/packages/ux-lab/captures/binary-explorer';
const TABS = [
  { name: 'mockups', label: 'MOCKUPS', file: 'mockups-tab.png' },
  { name: 'components', label: 'COMPONENTS', file: 'components-tab.png' },
  { name: 'testing', label: 'TESTING', file: 'testing-tab.png' },
];

async function run() {
  const ws = new WebSocket(WS_URL);
  let id = 1;
  const pending = {};

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      pending[msgId] = resolve;
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) {
      pending[msg.id](msg);
      delete pending[msg.id];
    }
  });

  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');

  // Navigate to binary-explorer base route first
  console.log('Navigating to binary-explorer...');
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/#binary-explorer' });
  await new Promise(r => setTimeout(r, 4000));

  // First, dump what nav buttons exist
  const navCheck = await send('Runtime.evaluate', {
    expression: `
      (function() {
        const btns = document.querySelectorAll('nav button, [role="tablist"] button, button[data-tab]');
        const all = Array.from(btns).map(b => b.textContent.trim());
        // Also check for tab-like elements
        const tabs = Array.from(document.querySelectorAll('[class*="tab"], [class*="Tab"]')).map(el => el.textContent.trim().substring(0, 50));
        return JSON.stringify({ navBtns: all, tabEls: tabs.slice(0, 20) });
      })()
    `,
    returnByValue: true
  });
  console.log('Nav/tab elements found:', navCheck?.result?.result?.value);

  for (const tab of TABS) {
    console.log(`\nClicking tab: ${tab.label}`);

    // Find the button by text content (case-insensitive)
    const coordResult = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const label = '${tab.label}';
          // Try various selectors
          const selectors = [
            'nav button',
            '[role="tablist"] button',
            '[role="tab"]',
            'button',
          ];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              if (el.textContent.trim().toUpperCase() === label || el.textContent.trim() === label) {
                const rect = el.getBoundingClientRect();
                return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, tag: el.tagName, text: el.textContent.trim() });
              }
            }
          }
          // Fallback: partial match
          const allBtns = document.querySelectorAll('button');
          for (const btn of allBtns) {
            if (btn.textContent.trim().toUpperCase().includes(label)) {
              const rect = btn.getBoundingClientRect();
              return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, tag: btn.tagName, text: btn.textContent.trim(), partial: true });
            }
          }
          return null;
        })()
      `,
      returnByValue: true
    });

    const coordVal = coordResult?.result?.result?.value;
    console.log(`  Coord result:`, coordVal);

    if (coordVal) {
      const { x, y } = JSON.parse(coordVal);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      console.log(`  Clicked at (${x}, ${y})`);
    } else {
      console.log(`  Button "${tab.label}" not found, taking screenshot anyway`);
    }

    await new Promise(r => setTimeout(r, 2500));

    const result = await send('Page.captureScreenshot', { format: 'png' });
    if (result?.result?.data) {
      const buf = Buffer.from(result.result.data, 'base64');
      const outPath = `${OUT_DIR}/${tab.file}`;
      fs.writeFileSync(outPath, buf);
      console.log(`  Saved: ${outPath} (${buf.length} bytes)`);
    } else {
      console.log(`  Screenshot failed for ${tab.label}`);
    }
  }

  ws.close();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
