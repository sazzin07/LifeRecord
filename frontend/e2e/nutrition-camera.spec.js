import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "./fixtures";

// The barcode camera. The browser's fake camera plays back a generated EAN-13 barcode, so the whole chain runs for real:
// getUserMedia -> ZXing decoding in the page -> product lookup -> portion step. (The product database lookup itself is stubbed.)
async function foodByName(api, q, startsWith) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=30`)).json();
  return res.find((f) => f.name.toLowerCase().startsWith(startsWith)) || res[0];
}

const CODE = "5901234123457";
function ean13Y4M(code, file) {
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const R = L.map((p) => p.split("").map((b) => (b === "1" ? "0" : "1")).join(""));   // R is the complement of L
  const G = R.map((p) => p.split("").reverse().join(""));                                 // G is R read backwards
  const parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];   // by the first digit
  const d = code.split("").map(Number);
  let bits = "101";
  for (let i = 0; i < 6; i += 1) bits += (parity[d[0]][i] === "L" ? L : G)[d[i + 1]];
  bits += "01010";
  for (let i = 0; i < 6; i += 1) bits += R[d[i + 7]];
  bits += "101";
  const W = 640, H = 480, module = 5, left = Math.floor((W - bits.length * module) / 2);
  const y = Buffer.alloc(W * H, 255);
  for (let row = 140; row < 340; row += 1) for (let i = 0; i < bits.length; i += 1) if (bits[i] === "1") y.fill(0, row * W + left + i * module, row * W + left + (i + 1) * module);
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), ...Array.from({ length: 30 }, () => frame)]));
}
const VIDEO = path.join(os.tmpdir(), `lr-ean13-${process.pid}.y4m`);
ean13Y4M(CODE, VIDEO);

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${VIDEO}`] } });

test.describe("Nutrition barcode camera", () => {
  test.use({ permissions: ["camera"] });

  test("the camera reads a barcode and opens that product", async ({ authenticatedPage: page, apiContext }) => {
    const oats = await foodByName(apiContext, "oats", "oats");
    const detail = await (await apiContext.get(`/api/nutrition/foods/${oats.id}`)).json();
    let asked = null;
    await page.route("**/api/nutrition/foods/barcode/*", async (route) => {   // the product database itself is not under test here
      asked = route.request().url().split("/").pop();
      await route.fulfill({ json: detail });
    });
    await page.goto("/nutrition");
    await page.getByTestId("header-add-food").click();
    await page.getByTestId("food-scan").click();
    await expect(page.getByTestId("barcode-scanner")).toBeVisible();
    await expect(page.getByTestId("food-portion")).toBeVisible({ timeout: 20000 });   // decoded -> looked up -> portion step
    expect(asked).toBe(CODE);
    await expect(page.getByTestId("barcode-scanner")).toHaveCount(0);                  // the camera dialog closed itself
    await page.getByTestId("food-save").waitFor();
    await page.keyboard.press("Escape");
  });
});

test.describe("Nutrition barcode camera without a camera", () => {
  test.use({ permissions: [] });

  test("says why, in plain words, and leaves typing the barcode available", async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => { // a browser with no camera at all
      Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" })) }, configurable: true });
    });
    await page.goto("/nutrition");
    await page.getByTestId("header-add-food").click();
    await page.getByTestId("food-scan").click();
    await expect(page.getByTestId("scanner-status")).toContainText("No camera was found");
    await expect(page.getByTestId("scanner-status")).toHaveAttribute("role", "alert");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("food-barcode")).toBeVisible();
  });
});
