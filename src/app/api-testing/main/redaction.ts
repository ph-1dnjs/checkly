import type { Json } from "../shared/scenario";

const sensitiveKey = /authorization|cookie|password|token|secret|api.?key|otp/i;

/** Keeps secrets in main only. Apply after all steps so later discoveries mask earlier traces too. */
export class ApiRedactor {
  private secrets = new Set<string>();

  add(value: unknown) {
    if (value && typeof value === "object") Object.values(value).forEach(v => this.add(v));
    else if (typeof value === "string" && value) {
      this.secrets.add(value);
      if (/^Bearer\s+/i.test(value)) this.secrets.add(value.replace(/^Bearer\s+/i, ""));
    }
  }

  discover(value: unknown, key = "") {
    if (sensitiveKey.test(key)) this.add(value);
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => this.discover(v, k));
  }

  mask(value: Json, key = ""): Json {
    if (sensitiveKey.test(key)) return "***";
    if (Array.isArray(value)) return value.map(v => this.mask(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.mask(v, k)]));
    if (typeof value === "string") {
      return [...this.secrets].sort((a, b) => b.length - a.length).reduce((text, secret) => text.split(secret).join("***"), value);
    }
    return value;
  }
}
