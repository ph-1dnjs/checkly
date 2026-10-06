import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Remarkable } from "remarkable";
import { Button } from "../shared/ui/Button";
import type { RunRecord } from "../shared/model/scenario";
import {
  createRunReportMarkdown,
  runReportFileName,
} from "../shared/report";

type Props = {
  record: RunRecord | null;
  onClose: () => void;
  onDownload: (markdown: string, fileName: string) => void;
};

const markdownRenderer = new Remarkable({ html: false, breaks: false });

export const RunReportViewer = ({ record, onClose, onDownload }: Props) => {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const markdown = useMemo(
    () => (record ? createRunReportMarkdown(record) : ""),
    [record],
  );
  const html = useMemo(
    () => DOMPurify.sanitize(markdownRenderer.render(markdown)),
    [markdown],
  );
  if (!record) return null;
  const fileName = runReportFileName(record);

  return (
    <div
      className="run-report-drawer run-report-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="실행 리포트"
    >
      <Button
        className="run-report-drawer-backdrop"
        aria-label="리포트 닫기"
        onClick={onClose}
      />
      <div className="run-report-drawer-panel">
        <div className="run-report-drawer-head">
          <strong>실행 리포트</strong>
          <span className="run-report-viewer-file" title={fileName}>
            {fileName}
          </span>
          <div className="run-report-viewer-actions">
            <div className="run-report-viewer-mode" role="tablist">
              <Button
                role="tab"
                aria-selected={mode === "preview"}
                className={mode === "preview" ? "selected" : ""}
                onClick={() => setMode("preview")}
              >
                미리보기
              </Button>
              <Button
                role="tab"
                aria-selected={mode === "source"}
                className={mode === "source" ? "selected" : ""}
                onClick={() => setMode("source")}
              >
                Markdown
              </Button>
            </div>
            <Button
              variant="primary"
              onClick={() => onDownload(markdown, fileName)}
            >
              <span className="msi">download</span>
              다운로드 (.md)
            </Button>
          </div>
          <Button
            className="run-report-drawer-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </Button>
        </div>
        {mode === "preview" ? (
          <article
            className="run-report-viewer-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="run-report-viewer-source">{markdown}</pre>
        )}
      </div>
    </div>
  );
};
