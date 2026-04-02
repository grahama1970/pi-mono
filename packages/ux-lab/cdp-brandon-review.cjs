/**
 * CDP-based Brandon Bailey persona review — with smart crops.
 * Takes per-region screenshots, processes via vlm_image.py, sends to VLM.
 */
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CDP_URL = "http://127.0.0.1:9222";
const SCILLM_URL = "http://127.0.0.1:4001/v1/chat/completions";
const SCILLM_KEY = "sk-dev-proxy-123";
const CAPTURES_DIR = path.join(__dirname, "captures", "persona-reviews");
const VLM_IMAGE_PY = path.join(__dirname, "../../.pi/skills/common/vlm_image.py");

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(CDP_URL + "/json", (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

/**
 * Process raw screenshot bytes through vlm_image.py for VLM readability.
 * Crops, upscales to 1200px, sharpens text, compresses.
 */
function processForVlm(inputPath, outputPath) {
  try {
    execSync(
      `python3 -c "
import sys; sys.path.insert(0, '${path.dirname(VLM_IMAGE_PY)}')
from vlm_image import prepare_for_vlm
data = open('${inputPath}', 'rb').read()
processed = prepare_for_vlm(data, min_width=1400, max_height=2000)
open('${outputPath}', 'wb').write(processed)
print(f'Processed: {len(data)} -> {len(processed)} bytes')
"`,
      { stdio: "pipe" }
    );
    return true;
  } catch (e) {
    console.error("vlm_image.py failed:", e.message?.slice(0, 200));
    return false;
  }
}

async function run() {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });

  const targets = await getTargets();
  const target = targets.find((t) => t.type === "page" && t.url.includes("embry-terminal"));
  if (!target) { console.error("No embry-terminal page"); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 1;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = msgId++;
      ws.on("message", function handler(raw) {
        const msg = JSON.parse(raw);
        if (msg.id === id) { ws.removeListener("message", handler); resolve(msg.result); }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((r) => ws.on("open", r));
  console.log("Connected to CDP");

  // Navigate and wait for render
  await send("Page.navigate", { url: "http://localhost:3002/#embry-terminal" });
  await new Promise((r) => setTimeout(r, 2000));
  await send("Runtime.evaluate", {
    expression: '(() => { const btn = document.querySelector(\'[data-testid="tab-final-site"]\'); if (btn) btn.click(); })()',
  });
  await new Promise((r) => setTimeout(r, 8000));

  // Helper: crop a specific element by data-qid
  async function cropElement(qid, filename, expandPx = 20) {
    const { result } = await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector('[data-qid="${qid}"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.x - ${expandPx}), y: Math.max(0, r.y - ${expandPx}), width: r.width + ${expandPx * 2}, height: r.height + ${expandPx * 2} };
      })()`,
      returnByValue: true,
    });
    if (!result?.value) {
      console.log(`  [SKIP] ${qid} not found`);
      return null;
    }
    const clip = result.value;
    clip.scale = 2; // 2x for retina-quality text
    const { data } = await send("Page.captureScreenshot", { format: "png", clip });
    const rawPath = path.join(CAPTURES_DIR, `raw-${filename}`);
    const procPath = path.join(CAPTURES_DIR, filename);
    fs.writeFileSync(rawPath, Buffer.from(data, "base64"));

    if (processForVlm(rawPath, procPath)) {
      console.log(`  [OK] ${filename} (${qid})`);
      return procPath;
    }
    // Fallback: use raw
    fs.copyFileSync(rawPath, procPath);
    return procPath;
  }

  console.log("\n=== Taking targeted crops ===\n");

  // 1. Full page (for context)
  const { data: fullPage } = await send("Page.captureScreenshot", { format: "png" });
  const fullPath = path.join(CAPTURES_DIR, "01-full-page.png");
  fs.writeFileSync(fullPath, Buffer.from(fullPage, "base64"));
  console.log("  [OK] 01-full-page.png");

  // 2. Thinking label (collapsed)
  const thinkingCrop = await cropElement("reasoning-chain-summary", "02-thinking-label.png", 8);

  // 3. User message bubble (to show blue tint)
  const userCrop = await cropElement("chat:message:seed-1", "03-user-bubble.png", 12);

  // 4. Expand reasoning and crop
  await send("Runtime.evaluate", {
    expression: '(() => { const s = document.querySelector(\'[data-qid="reasoning-chain-summary"]\'); if (s) s.click(); })()',
  });
  await new Promise((r) => setTimeout(r, 500));
  const chainCrop = await cropElement("reasoning-chain", "04-reasoning-expanded.png", 8);

  // 5. Expand nested steps and crop
  await send("Runtime.evaluate", {
    expression: '(() => { const t = document.querySelector(\'[data-qid^="step-children-toggle:"]\'); if (t) t.click(); })()',
  });
  await new Promise((r) => setTimeout(r, 300));
  const nestedCrop = await cropElement("reasoning-chain", "05-nested-steps.png", 8);

  // 6. Open sidebar and crop
  await send("Runtime.evaluate", {
    expression: '(() => { const t = document.querySelector(\'[data-qid="topbar:sidebar:toggle"]\'); if (t) t.click(); })()',
  });
  await new Promise((r) => setTimeout(r, 1000));
  const { data: sidebarFull } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 300, height: 800, scale: 2 } });
  const sidebarPath = path.join(CAPTURES_DIR, "raw-06-sidebar.png");
  const sidebarProc = path.join(CAPTURES_DIR, "06-sidebar.png");
  fs.writeFileSync(sidebarPath, Buffer.from(sidebarFull, "base64"));
  processForVlm(sidebarPath, sidebarProc);
  console.log("  [OK] 06-sidebar.png");

  ws.close();

  // Collect all processed screenshots
  const screenshots = [
    { path: fullPath, label: "Full page — overview showing user question (blue bubble), collapsed Thinking block, response text" },
    thinkingCrop && { path: thinkingCrop, label: "CROPPED: Thinking label — shows agent name (claude), step count, duration, and confidence percentage" },
    userCrop && { path: userCrop, label: "CROPPED: User message bubble — blue-tinted background distinguishing user input from agent output" },
    chainCrop && { path: chainCrop, label: "CROPPED: Reasoning chain expanded — vertical timeline with status dots, skill badges, durations, confidence per step" },
    nestedCrop && { path: nestedCrop, label: "CROPPED: Nested sub-steps — /dogpile expanded showing brave, arxiv, github sub-operations with individual timings" },
    { path: sidebarProc, label: "CROPPED: Sidebar — project list with 29 projects, presence indicator area at top" },
  ].filter(Boolean);

  console.log(`\nSending ${screenshots.length} images to VLM...\n`);

  const imageContent = screenshots.map((ss) => {
    const b64 = fs.readFileSync(ss.path).toString("base64");
    return [
      { type: "text", text: `[${ss.label}]` },
      { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
    ];
  }).flat();

  const prompt = `You are Brandon Bailey, Principal Director of Cyber Assessments at Aerospace Corporation. You manage SPARTA security assessments across 29+ projects.

Review these CROPPED and UPSCALED screenshots of the Embry Terminal agent control surface. Each crop focuses on a specific UI feature so you can see the detail clearly.

REVIEW EACH FEATURE:

1. **THINKING LABEL** (crop 2): The collapsed reasoning header shows "▸ [title] · [agent badge] · [N steps] · [duration] · [confidence %]". Is the agent attribution (which model ran this), step count, timing, and confidence percentage visible and useful? Rate 1-10.

2. **USER BUBBLE** (crop 3): User messages have a blue-tinted background to visually distinguish them from agent responses. Is the color differentiation effective? Rate 1-10.

3. **REASONING CHAIN** (crop 4): When expanded, shows vertical timeline with status dots (✓/●/✗), skill badges (/memory, /dogpile, /extract-controls), durations, and confidence scores per step. The entire block has a gray-tinted background with left border to separate it from the response. Rate 1-10.

4. **NESTED SUB-STEPS** (crop 5): /dogpile shows collapsible children (brave, arxiv, github) with their own status dots, badges, and timings. The "▸ 3 sub-steps" toggle collapses/expands them independently. Rate 1-10.

5. **SIDEBAR** (crop 6): Lists 29 registered projects. Area at top will show presence indicators (who's connected). Rate 1-10.

6. **OVERALL COHESION**: Looking at the full page (crop 1), can you clearly distinguish: user question (blue bubble) → agent reasoning (gray process block) → final response (clean text below)? Rate 1-10.

Give an OVERALL SCORE 1-10 where 8+ means production-ready for your assessment team. Be specific about what works and what still needs fixing.`;

  const resp = await fetch(SCILLM_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SCILLM_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "vlm",
      messages: [{ role: "user", content: [...imageContent, { type: "text", text: prompt }] }],
      max_tokens: 2000,
    }),
  });

  const data = await resp.json();
  const review = data.choices?.[0]?.message?.content || "No review generated";
  console.log("=== BRANDON BAILEY REVIEW (with smart crops) ===\n");
  console.log(review);
  console.log("\n=== END REVIEW ===");

  fs.writeFileSync(
    path.join(CAPTURES_DIR, "brandon-collab-review.md"),
    `# Brandon Bailey — Collaboration Features Review (Smart Crops)\n\nDate: ${new Date().toISOString()}\n\n${review}\n`
  );
  console.log("\nSaved to captures/persona-reviews/brandon-collab-review.md");
  process.exit(0);
}

run().catch((e) => { console.error(e.message); process.exit(1); });
