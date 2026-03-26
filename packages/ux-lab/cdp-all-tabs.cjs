const WebSocket = require('ws');
const fs = require('fs');

const WS_URL = 'ws://127.0.0.1:9222/devtools/page/C10A50AB7CC7A5BC5F3491E449777DB6';
const OUT_DIR = '/home/graham/workspace/experiments/pi-mono/packages/ux-lab/captures/classifier-lab/e2e-test';
const TABS = ['research', 'data', 'tune', 'train', 'benchmark', 'evaluate', 'promote'];

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
  await send('DOM.enable');
  
  // Navigate fresh
  await send('Page.navigate', { url: 'http://localhost:3001/#classifier-lab' });
  await new Promise(r => setTimeout(r, 5000));

  for (const tab of TABS) {
    // Get the button coordinates and use Input.dispatchMouseEvent for proper React event handling
    const coordResult = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const btns = document.querySelectorAll('nav button');
          for (const b of btns) {
            if (b.textContent.trim().toLowerCase() === '${tab}') {
              const rect = b.getBoundingClientRect();
              return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
            }
          }
          return null;
        })()
      `
    });
    
    const coords = coordResult?.result?.result?.value;
    if (coords) {
      const { x, y } = JSON.parse(coords);
      // Mouse click via CDP Input domain — this triggers React synthetic events
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } else {
      console.log(`${tab}: button not found`);
      continue;
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    const result = await send('Page.captureScreenshot', { format: 'png' });
    if (result?.result?.data) {
      const buf = Buffer.from(result.result.data, 'base64');
      fs.writeFileSync(`${OUT_DIR}/tab-${tab}.png`, buf);
      console.log(`${tab}: ${buf.length} bytes`);
    }
  }
  
  ws.close();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
