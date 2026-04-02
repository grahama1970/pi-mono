const http = require("http"), WS = require("ws"), fs = require("fs"), { execSync } = require("child_process"), path = require("path");
const CAPS = path.join(__dirname, "captures", "persona-reviews");
const VLM_PY = path.join(__dirname, "../../.pi/skills/common/vlm_image.py");

(async () => {
  const targets = await new Promise((r, j) => http.get("http://127.0.0.1:9222/json", res => { let d = ""; res.on("data", c => d += c); res.on("end", () => r(JSON.parse(d))); }).on("error", j));
  const t = targets.find(t => t.type === "page" && t.url.includes("embry"));
  if (!t) { console.error("No page"); process.exit(1); }
  const ws = new WS(t.webSocketDebuggerUrl);
  let id = 1;
  const send = (m, p = {}) => new Promise(r => { const i = id++; ws.on("message", function h(raw) { const msg = JSON.parse(raw); if (msg.id === i) { ws.removeListener("message", h); r(msg.result); } }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.on("open", r));
  await new Promise(r => setTimeout(r, 5000));
  fs.mkdirSync(CAPS, { recursive: true });

  async function crop(qid, file, expand = 12) {
    const { result } = await send("Runtime.evaluate", {
      expression: `(()=>{const e=document.querySelector('[data-qid="${qid}"]');if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,r.x-${expand}),y:Math.max(0,r.y-${expand}),width:r.width+${expand * 2},height:r.height+${expand * 2}};})()`,
      returnByValue: true
    });
    if (!result?.value) { console.log("  SKIP:", qid); return null; }
    const { data } = await send("Page.captureScreenshot", { format: "png", clip: { ...result.value, scale: 2 } });
    const rawPath = path.join(CAPS, "raw-" + file);
    const procPath = path.join(CAPS, file);
    fs.writeFileSync(rawPath, Buffer.from(data, "base64"));
    try {
      execSync(`python3 -c "
import sys; sys.path.insert(0, '${path.dirname(VLM_PY)}')
from vlm_image import prepare_for_vlm
d = open('${rawPath}', 'rb').read()
p = prepare_for_vlm(d, min_width=1400)
open('${procPath}', 'wb').write(p)
"`);
    } catch { fs.copyFileSync(rawPath, procPath); }
    console.log("  OK:", file);
    return procPath;
  }

  console.log("Cropping...");
  const p1 = await crop("reasoning-chain-summary", "g-01-label.png", 8);

  // Expand chain with retry — HMR can reset state
  for (let attempt = 0; attempt < 3; attempt++) {
    await send("Runtime.evaluate", { expression: 'document.querySelector("[data-qid=reasoning-chain-summary]")?.click()' });
    await new Promise(r => setTimeout(r, 1500));
    const { result: h } = await send("Runtime.evaluate", {
      expression: 'document.querySelector("[data-qid=reasoning-chain]")?.getBoundingClientRect()?.height || 0',
      returnByValue: true,
    });
    console.log(`  Chain height after expand (attempt ${attempt + 1}):`, h?.value);
    if (h?.value > 100) break; // expanded
    await new Promise(r => setTimeout(r, 2000)); // wait for HMR to settle
  }
  // Expand nested steps
  await send("Runtime.evaluate", { expression: 'document.querySelector("[data-qid^=step-children-toggle]")?.click()' });
  await new Promise(r => setTimeout(r, 800));
  // Scroll chain into view
  await send("Runtime.evaluate", { expression: 'document.querySelector("[data-qid=reasoning-chain]")?.scrollIntoView({behavior:"instant"})' });
  await new Promise(r => setTimeout(r, 500));
  const p2 = await crop("reasoning-chain", "g-02-chain.png", 8);
  // Scroll to bottom to show input bar
  await send("Runtime.evaluate", { expression: 'document.querySelector("[data-qid=input:compose]")?.scrollIntoView({behavior:"instant"})' });
  await new Promise(r => setTimeout(r, 300));
  // Crop the entire composer area (input + status bar below it)
  const p3 = await crop("input:compose", "g-03-input.png", 40);
  ws.close();

  console.log("Stitching...");
  const crops = [p1, p2, p3].filter(Boolean);
  execSync(`python3 -c "
import sys; sys.path.insert(0, '${path.dirname(VLM_PY)}')
from vlm_image import stitch_vertical
imgs = [open(p, 'rb').read() for p in [${crops.map(c => `'${c}'`).join(",")}]]
s = stitch_vertical(imgs, max_total_height=2800)
open('${path.join(CAPS, "g-stitched.png")}', 'wb').write(s)
"`);
  console.log("  Stitched");

  console.log("Sending to Gemini Flash...\n");
  const b64 = fs.readFileSync(path.join(CAPS, "g-stitched.png")).toString("base64");
  const prompt = `You are a brutal senior UX reviewer for aerospace defense tools. No flattery. Find every flaw. If something works, say so briefly and move on. Spend your time on problems.

This stitched image shows 3 CROPPED+UPSCALED regions of an agent control surface for CMMC security assessments (iPad over Tailscale):

TOP: Collapsed reasoning header
MIDDLE: Expanded reasoning chain with skill steps and nested sub-operations
BOTTOM: User input bubble

For each region:
1. Describe EXACTLY what text, colors, badges, and icons you see
2. Rate readability 1-10 (can a tired assessor at 11pm parse this?)
3. Rate information completeness 1-10 (all necessary metadata present?)
4. Name specific adoption blockers

Overall score 1-10 where 8+ = deploy to defense team. Be harsh.`;

  const resp = await fetch("http://localhost:4001/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer sk-dev-proxy-123", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "text-gemini",
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: "data:image/png;base64," + b64 } }
      ] }],
      max_tokens: 1500,
    }),
  });

  const data = await resp.json();
  const review = data.choices?.[0]?.message?.content || "No review";
  console.log("=== GEMINI FLASH ADVERSARIAL REVIEW ===\n");
  console.log(review);
  console.log("\n=== END ===");
  fs.writeFileSync(path.join(CAPS, "brandon-gemini-v3.md"), "# Gemini Flash Review v3\n\n" + review + "\n");
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
