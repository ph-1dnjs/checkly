import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import { MjpegDecoder } from "./mjpeg";
import type { SimulatorApp, SimulatorDevice, SimulatorFrame, SimulatorInput, SimulatorStatus } from "./nativeInspectorTypes";

const execute = promisify(execFile);
const validUdid = (value: string) => {
  if (typeof value !== "string" || !/^[A-Fa-f0-9-]{36}$/.test(value)) throw new Error("시뮬레이터를 선택해 주세요.");
  return value;
};
const commandEnv = () => ({ ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}` });

export class SimulatorService {
  private stream?: ChildProcess;
  private generation = 0;
  private status: SimulatorStatus = { udid: null, streaming: false, error: "" };
  private width = 0;
  private height = 0;
  private density = 1;
  private inputQueue: Promise<void> = Promise.resolve();
  private queuedInputs = 0;

  snapshot(): SimulatorStatus { return { ...this.status }; }

  private async idbPath(): Promise<string> {
    for (const file of ["/opt/homebrew/bin/idb", "/usr/local/bin/idb"]) {
      try { await access(file, constants.X_OK); return file; } catch { /* Try the other Homebrew prefix. */ }
    }
    throw new Error("idb가 필요합니다. 터미널에서 brew install facebook/fb/idb 를 실행한 뒤 다시 연결해 주세요.");
  }

  private async runIdb(args: string[], timeout = 20000): Promise<string> {
    const { stdout } = await execute(await this.idbPath(), args, { env: commandEnv(), timeout, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  }

  async devices(): Promise<SimulatorDevice[]> {
    if (process.platform !== "darwin") throw new Error("iOS 시뮬레이터는 Xcode가 설치된 Mac에서 사용할 수 있습니다.");
    const { stdout } = await execute("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "-j"], { timeout: 15000 });
    const data = JSON.parse(stdout) as { devices: Record<string, Array<{ udid: string; name: string; state: string }>> };
    return Object.entries(data.devices).flatMap(([runtime, devices]) => runtime.includes("iOS")
      ? devices.map(device => ({ udid: device.udid, name: device.name, state: device.state, runtime: runtime.split("SimRuntime.")[1] || runtime })) : []);
  }

  async apps(udid: string): Promise<SimulatorApp[]> {
    const text = await this.runIdb(["list-apps", "--udid", validUdid(udid), "--json"]);
    // idb's list commands emit one JSON object per line.
    return text.split("\n").filter(line => line.trim().startsWith("{")).map(line => JSON.parse(line))
      .filter(app => app.install_type === "user" || app.install_type === "User")
      .map(app => ({ bundleId: String(app.bundle_id), name: String(app.name || app.bundle_id) }));
  }

  async connect(udid: string, emit: (frame: SimulatorFrame) => void): Promise<SimulatorStatus> {
    validUdid(udid);
    this.disconnect();
    const generation = this.generation;
    this.status = { udid, streaming: false, error: "" };
    try {
      const binary = await this.idbPath();
      const device = (await this.devices()).find(item => item.udid === udid);
      if (!device) throw new Error("선택한 iOS 시뮬레이터를 찾지 못했습니다.");
      if (device.state !== "Booted") {
        await execute("/usr/bin/xcrun", ["simctl", "boot", udid], { timeout: 30000 });
        await execute("/usr/bin/xcrun", ["simctl", "bootstatus", udid, "-b"], { timeout: 120000 });
      }
      const info = JSON.parse(await this.runIdb(["describe", "--udid", udid, "--json"], 60000));
      if (generation !== this.generation) return this.snapshot();
      this.density = Number(info.screen_dimensions?.density) || 1;
      const decoder = new MjpegDecoder();
      const stream = spawn(binary, ["video-stream", "--udid", udid, "--format", "mjpeg", "--fps", "15", "--compression-quality", "0.65"],
        { env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] });
      this.stream = stream;
      let stderr = "";
      let lastFrame = 0;
      const fail = (message: string) => {
        if (generation !== this.generation) return;
        this.status = { udid, streaming: false, error: message.slice(-1500) };
        stream.kill("SIGTERM");
      };
      const firstFrameTimeout = setTimeout(() => { if (!lastFrame) fail("시뮬레이터 화면을 받지 못했습니다. 기기 상태를 확인하고 다시 연결해 주세요."); }, 15000);
      firstFrameTimeout.unref();
      stream.once("close", () => clearTimeout(firstFrameTimeout));
      stream.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
      stream.on("error", error => fail(error.message));
      stream.on("close", code => {
        if (generation === this.generation) this.status = { udid, streaming: false, error: this.status.error || stderr || `화면 연결이 종료되었습니다 (${code}). 다시 연결해 주세요.` };
      });
      stream.stdout?.on("data", (chunk: Buffer) => {
        if (generation !== this.generation) return;
        try {
          const frames = decoder.push(chunk);
          const frame = frames.at(-1);
          if (!frame || Date.now() - lastFrame < 60) return;
          lastFrame = Date.now();
          clearTimeout(firstFrameTimeout);
          const size = nativeImage.createFromBuffer(frame).getSize();
          if (!size.width || !size.height) return;
          this.width = size.width / this.density;
          this.height = size.height / this.density;
          this.status = { udid, streaming: true, error: "" };
          emit({ udid, dataUrl: `data:image/jpeg;base64,${frame.toString("base64")}`, width: size.width, height: size.height });
        } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      });
      return this.snapshot();
    } catch (error) {
      if (generation === this.generation) this.status = { udid, streaming: false, error: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }

  disconnect(): void {
    this.generation += 1;
    const stream = this.stream;
    this.stream = undefined;
    if (stream) {
      stream.kill("SIGTERM");
      const timer = setTimeout(() => { if (stream.exitCode === null) stream.kill("SIGKILL"); }, 2000);
      timer.unref();
      stream.once("close", () => clearTimeout(timer));
    }
    this.width = this.height = 0;
    this.status = { udid: null, streaming: false, error: "" };
  }

  async launch(udid: string, bundleId: string, restart = false): Promise<void> {
    if (typeof bundleId !== "string" || !/^[\w.-]{1,200}$/.test(bundleId)) throw new Error("앱을 선택해 주세요.");
    await execute("/usr/bin/xcrun", ["simctl", "launch", ...(restart ? ["--terminate-running-process"] : []), validUdid(udid), bundleId], { timeout: 20000 });
  }

  input(udid: string, input: SimulatorInput): Promise<void> {
    validUdid(udid);
    const generation = this.generation;
    if (udid !== this.status.udid || !this.status.streaming) return Promise.reject(new Error("화면을 먼저 연결해 주세요."));
    if (this.queuedInputs >= 10) return Promise.reject(new Error("입력 처리 중입니다. 잠시 뒤 다시 시도해 주세요."));
    const point = (value: number, dimension: number) => {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("잘못된 터치 위치입니다.");
      return String(Math.round(value * Math.max(0, dimension - 1)));
    };
    let args: string[];
    if (input.type === "tap") args = ["ui", "tap", point(input.x, this.width), point(input.y, this.height)];
    else if (input.type === "swipe") args = ["ui", "swipe", point(input.x, this.width), point(input.y, this.height), point(input.endX, this.width), point(input.endY, this.height), "--duration", "0.3"];
    else if (input.type === "text") {
      if (typeof input.text !== "string" || input.text.length > 2000) throw new Error("텍스트는 2000자까지 입력할 수 있습니다.");
      args = ["ui", "text", input.text];
    } else if (input.type === "key" && ["ENTER", "BACKSPACE", "HOME"].includes(input.key)) {
      args = input.key === "HOME" ? ["ui", "button", "HOME"] : ["ui", "key", input.key === "ENTER" ? "40" : "42"];
    } else return Promise.reject(new Error("지원하지 않는 입력입니다."));
    this.queuedInputs += 1;
    const next = this.inputQueue.then(async () => {
      if (generation !== this.generation) return;
      if (input.type === "text") {
        // idb text synthesizes a US keyboard and cannot type Korean. Paste into the
        // simulator's clipboard instead; arguments never pass through a shell.
        await new Promise<void>((resolve, reject) => {
          const child = execFile("/usr/bin/xcrun", ["simctl", "pbcopy", udid], { timeout: 5000 }, error => error ? reject(error) : resolve());
          child.stdin?.on("error", reject);
          child.stdin?.end(input.text);
        });
        if (generation === this.generation) await this.runIdb(["ui", "key", "25", "--command", "--udid", udid]);
      } else await this.runIdb([...args, "--udid", udid]);
    });
    this.inputQueue = next.catch(() => {}).finally(() => { this.queuedInputs -= 1; });
    return next;
  }
}
