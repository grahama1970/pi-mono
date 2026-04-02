const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");

async function run() {
  const targets = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });

  const target = targets.find(
    (t) => t.type === "page" && t.url.includes("embry-terminal")
  );
  if (!target) {
    console.error("No embry-terminal page found");
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 1;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = msgId++;
      ws.on("message", function handler(raw) {
        const msg = JSON.parse(raw);
        if (msg.id === id) {
          ws.removeListener("message", handler);
          resolve(msg.result);
        }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((r) => ws.on("open", r));
  console.log("Connected to CDP");
  await new Promise((r) => setTimeout(r, 5000));

  // Check messages rendered
  const { result: msgCount } = await send("Runtime.evaluate", {
    expression:
      'document.querySelectorAll(\'[data-qid^="chat:message"]\').length',
  });
  console.log("Messages rendered:", msgCount?.value);

  // Check reasoning chain
  const { result: reasoning } = await send("Runtime.evaluate", {
    expression:
      '!!document.querySelector(\'[data-qid="reasoning-chain"]\')',
  });
  console.log("ReasoningChain found:", reasoning?.value);

  // Check thinking label
  const { result: label } = await send("Runtime.evaluate", {
    expression:
      'document.querySelector(\'[data-qid="reasoning-chain-summary"]\')?.textContent?.trim().slice(0, 80)',
  });
  console.log("Think label:", label?.value);

  // Check for console errors
  await send("Console.enable");
  const { result: errorCount } = await send("Runtime.evaluate", {
    expression: "window.__consoleErrors?.length || 0",
  });
  console.log("Console errors:", errorCount?.value || 0);

  // Screenshot
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    "captures/embry-collaboration-v1.png",
    Buffer.from(data, "base64")
  );
  console.log("Screenshot saved to captures/embry-collaboration-v1.png");

  ws.close();
  process.exit(0);
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
