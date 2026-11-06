import { ipcRenderer } from 'electron'
import { subscribe } from '../subscribe'
import type { AiTcCase, AiTcDecision, AiTcPrepared, AiTcRunPlan, AiTcRunState, AiTcVerdict, AiTcWorkbook } from './model'
import type { PrepareCase } from './prepare'
import type { ModelUsage } from './ai'

export const aiTcBridge = {
  importWorkbook: (): Promise<{ workbook?: AiTcWorkbook; error?: string } | null> => ipcRenderer.invoke('ai-tc:import'),
  pickUpload: (): Promise<{ token: string; name: string } | null> => ipcRenderer.invoke('ai-tc:pick-upload'),
  prepare: (input: { tool: "claude" | "codex"; cases: PrepareCase[] }): Promise<AiTcPrepared[]> => ipcRenderer.invoke("ai-tc:prepare", input),
  onPrepareUsage: (callback: (value: { tool: "claude" | "codex"; usage?: ModelUsage }) => void): (() => void) => subscribe('ai-tc:prepare-usage', callback),
  tools: (): Promise<Array<{ tool: 'claude' | 'codex'; version: string }>> => ipcRenderer.invoke('ai-tc:tools'),
  start: (plan: AiTcRunPlan): Promise<AiTcRunState> => ipcRenderer.invoke('ai-tc:start', plan),
  replay: (runId: string, assisted = false): Promise<AiTcRunState> => ipcRenderer.invoke('ai-tc:replay', runId, assisted),
  replaySaved: (plan: AiTcRunPlan, assisted = false): Promise<AiTcRunState> => ipcRenderer.invoke('ai-tc:replay-saved', plan, assisted),
  savedNeeds: (plan: AiTcRunPlan): Promise<Array<{ key: string; labels: string[] }>> => ipcRenderer.invoke('ai-tc:saved-needs', plan),
  decide: (runId: string, decision: AiTcDecision, reply?: string): Promise<void> => ipcRenderer.invoke('ai-tc:decide', runId, decision, reply),
  browserEvent: (runId: string, event: { type: "click"; x: number; y: number } | { type: "wheel"; deltaY: number } | { type: "text"; text: string } | { type: "key"; key: string } | { type: "back" | "forward" | "reload" }): Promise<void> => ipcRenderer.invoke('ai-tc:browser-event', runId, event),
  cancel: (runId: string): Promise<void> => ipcRenderer.invoke('ai-tc:cancel', runId),
  review: (input: { runId: string; caseKey: string; expectedId: string; verdict: AiTcVerdict | null; note: string }): Promise<AiTcRunState | null> => ipcRenderer.invoke('ai-tc:review', input),
  approveAssertion: (input: { runId: string; caseKey: string; expectedId: string; approved: boolean }): Promise<AiTcRunState | null> => ipcRenderer.invoke('ai-tc:approve-assertion', input),
  applyRepair: (input: { runId: string; caseKey: string }): Promise<AiTcRunState | null> => ipcRenderer.invoke('ai-tc:apply-repair', input),
  capture: (runId: string, captureId: string): Promise<string | null> => ipcRenderer.invoke('ai-tc:capture', runId, captureId),
  current: (): Promise<AiTcRunState | null> => ipcRenderer.invoke('ai-tc:current'),
  exportResult: (runId: string): Promise<string | null> => ipcRenderer.invoke('ai-tc:export', runId),
  downloadVideo: (runId: string): Promise<string | null> => ipcRenderer.invoke('ai-tc:download-video', runId),
  openFolder: (runId: string): Promise<void> => ipcRenderer.invoke('ai-tc:open-folder', runId),
  onState: (callback: (state: AiTcRunState) => void): (() => void) => subscribe('ai-tc:state', callback),
  onPreview: (callback: (preview: { runId: string; image: string }) => void): (() => void) => subscribe('ai-tc:preview', callback),
}

export type AiTcBridge = typeof aiTcBridge
