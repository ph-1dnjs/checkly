import template from "./run-report.template.md?raw";
import type { RunRecord } from "../model/scenario";
import { buildRunReportMarkdown } from "./run-report";

export { runReportFileName } from "./run-report";

export const createRunReportMarkdown = (record: RunRecord): string =>
  buildRunReportMarkdown(record, template);
