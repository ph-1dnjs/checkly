import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Browser } from "@playwright/test";
import type { FileSpec } from "./prepare";

/**
 * 업로드 테스트용 임시 파일을 명세대로 만든다. 이미지는 headless Chromium 캔버스로 정확한 크기에 그리고,
 * maxKB가 있으면 JPEG 품질을 낮춰 맞춘다(PNG는 단색 위주라 대개 작다). PDF도 Chromium으로 만든다.
 */

const safe = (text: string) => text.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "file";

const imagePage = (spec: FileSpec, width: number, height: number) => `<!doctype html><html><body style="margin:0">
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
const c = document.getElementById('c'), x = c.getContext('2d');
const g = x.createLinearGradient(0, 0, ${width}, ${height});
g.addColorStop(0, '#3d8ce0'); g.addColorStop(1, '#0e8a5f');
x.fillStyle = g; x.fillRect(0, 0, ${width}, ${height});
x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
const size = Math.max(10, Math.min(${width}, ${height}) / 8);
x.font = 'bold ' + size + 'px sans-serif';
x.fillText(${JSON.stringify(spec.label.slice(0, 30))}, ${width} / 2, ${height} / 2 - size * 0.6);
x.font = size * 0.7 + 'px sans-serif';
x.fillText('${width}x${height} · Checkly test', ${width} / 2, ${height} / 2 + size * 0.6);
</script></body></html>`;

export class FixtureMaker {
  private browser?: Browser;

  constructor(private dir: string, private executablePath?: string) {}

  private async page() {
    this.browser ??= await chromium.launch({ headless: true, ...(this.executablePath ? { executablePath: this.executablePath } : {}) });
    return this.browser.newPage();
  }

  /** 파일을 만들고 경로와 화면에 보일 이름을 돌려준다. */
  async make(spec: FileSpec, prefix: string): Promise<{ filePath: string; name: string; bytes: number }> {
    await mkdir(this.dir, { recursive: true });
    const width = spec.width ?? 800, height = spec.height ?? 600;
    const image = spec.type === "png" || spec.type === "jpg";
    const name = `${prefix}_${safe(spec.label)}${image ? `_${width}x${height}` : ""}.${spec.type}`;
    const filePath = path.join(this.dir, name);
    let content: Buffer;
    if (image) {
      const page = await this.page();
      try {
        await page.setViewportSize({ width, height });
        await page.setContent(imagePage(spec, width, height));
        const canvas = page.locator("#c");
        if (spec.type === "png") content = await canvas.screenshot({ type: "png" });
        else {
          content = await canvas.screenshot({ type: "jpeg", quality: 85 });
          for (let quality = 70; spec.maxKB && content.length > spec.maxKB * 1024 && quality >= 10; quality -= 15) content = await canvas.screenshot({ type: "jpeg", quality });
        }
      } finally { await page.close(); }
    } else if (spec.type === "pdf") {
      const page = await this.page();
      try {
        await page.setContent(`<html><body style="font-family:sans-serif;padding:40px"><h1>${escapeHtml(spec.label)}</h1><p>${escapeHtml(spec.text ?? "Checkly 테스트 업로드 문서")}</p></body></html>`);
        content = await page.pdf({ format: "A4" });
      } finally { await page.close(); }
    } else if (spec.type === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("data");
      for (const line of (spec.text ?? "항목,값\n테스트,1").split("\n")) sheet.addRow(line.split(","));
      content = Buffer.from(await workbook.xlsx.writeBuffer());
    } else {
      content = Buffer.from(spec.text ?? (spec.type === "csv" ? "항목,값\n테스트,1\n" : "Checkly 테스트 업로드 파일\n"), "utf8");
    }
    await writeFile(filePath, content);
    return { filePath, name, bytes: content.length };
  }

  async close() { const browser = this.browser; this.browser = undefined; await browser?.close().catch(() => undefined); }
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
