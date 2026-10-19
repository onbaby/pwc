/**
 * Browser smoke test (spec 11): three screens + backup load without console errors at 1920x1080 and 1280x720, and the
 * hotkeys are ignored while an input is focused. Uses the installed Google Chrome (no browser download).
 * Usage: pnpm smoke   (builds nothing: run `pnpm build:web` first)
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PORT = 8791;
const server = spawn("pnpm", ["exec", "tsx", "apps/server/src/main.ts"], { env: { ...process.env, CHANNEL: "replay", PORT: String(PORT), NO_NETWORK: "1" }, stdio: "pipe" });
let ready = false;
server.stdout.on("data", (d) => {
  if (String(d).includes("Right on Time")) ready = true;
});
for (let i = 0; i < 100 && !ready; i++) await new Promise((r) => setTimeout(r, 100));
if (!ready) throw new Error("server did not start");

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath: chrome, headless: true });
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures++;
};

for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await fetch(`http://localhost:${PORT}/api/reset`, { method: "POST" });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("h1");
  const stepText = async () => (await page.locator("text=/step \\d+\\/15/").first().textContent()) ?? "";
  const titles = new Set<string>();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((n) => document.body.innerText.includes(`step ${n}/15`), i + 2);
    titles.add((await page.locator("h1").textContent()) ?? "");
    await page.waitForTimeout(80);
  }
  check(titles.size >= 3, `${w}x${h}: three screens reached (${[...titles].join(" | ")})`);
  check((await stepText()).includes("15/15"), `${w}x${h}: arrived at step 15`);
  await fetch(`http://localhost:${PORT}/api/goto`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: 1 }) });
  await page.reload();
  await page.waitForSelector("input[aria-label^='Reply as']");
  await page.focus("input[aria-label^='Reply as']");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("x ");
  await page.waitForTimeout(200);
  check((await stepText()).includes("2/15"), `${w}x${h}: arrows and letters ignored while the phone input is focused`);
  await page.goto(`http://localhost:${PORT}/backup`);
  for (let k = 1; k <= 8; k++) {
    await page.keyboard.press(String(k));
    await page.waitForTimeout(120);
    const text = await page.locator("main").innerText();
    check(text.length > 80, `${w}x${h}: backup tile ${k} renders`);
  }
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check(!hscroll, `${w}x${h}: no horizontal overflow`);
  check(errors.length === 0, `${w}x${h}: no console errors ${errors.join(" ; ")}`);
  await page.close();
}
await browser.close();
server.kill();
if (failures) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("smoke passed");
