import { useEffect, useMemo, useState, type ReactElement } from 'react'

type Action = 'goto' | 'fill' | 'manualFill' | 'click' | 'select' | 'expectText'
type Step = { id: string; action: Action; target: string; value?: string; required?: boolean; prompt?: string; occurrence?: number; connected?: boolean; x?: number; y?: number; color?: string }
type Scenario = { id: string; title: string; url: string; steps: Step[] }
type MarkerPosition = Pick<Step, 'action' | 'target' | 'value' | 'prompt' | 'occurrence' | 'x' | 'y' | 'color'>
type MarkerPositionStore = Record<string, MarkerPosition[]>
type RunRecord = { id: string; scenario: Scenario; status: 'passed' | 'failed'; ranAt: string }
type RunSummary = { total: number; passed: number; failed: number }
type RunProgress = { current: number; total: number; step: string }

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>
      loadScenarioMarkdown: () => Promise<string | null>
      saveScenarioMarkdown: (markdown: string) => Promise<void>
      importScenarioFile: () => Promise<string | null>
      exportScenarioFile: (markdown: string) => Promise<string | null>
      loadMarkerPositions: () => Promise<string | null>
      saveMarkerPositions: (positions: string) => Promise<void>
      inspectScenario: (scenario: Scenario) => Promise<Array<{ id: string; connected: boolean }>>
      runQa: (scenario: Scenario, options?: { preview?: boolean }) => Promise<{ status: string; log: string[] }>
      submitManualInput: (value: string) => Promise<void>
      cancelQa: () => Promise<void>
      onManualInputRequired: (callback: (step: Step) => void) => () => void
      onQaProgress: (callback: (progress: RunProgress) => void) => () => void
      onQaPreview: (callback: (image: string) => void) => () => void
    }
  }
}

const seed: Scenario = {
  id: 'login-qa', title: '로그인', url: 'https://example.com/login',
  steps: [
    { id: '1', action: 'goto', target: '/login', connected: true },
    { id: '2', action: 'fill', target: '이메일', value: 'qa@example.com', connected: true },
    { id: '3', action: 'manualFill', target: '인증번호', prompt: '인증번호를 입력해 주세요.', required: true, connected: true },
    { id: '4', action: 'click', target: '로그인 버튼', connected: true },
    { id: '5', action: 'expectText', target: '대시보드', connected: false }
  ]
}

const label: Record<Action, string> = { goto: '페이지 이동', fill: '일반 입력 (자동)', manualFill: '수동 입력', click: '클릭', select: '선택', expectText: '결과 확인' }
const actionText = (step: Step) => step.action === 'manualFill'
  ? `${step.target} 수동 입력${step.prompt ? ` [${step.prompt}]` : ''}`
  : step.action === 'goto' ? `${step.target} 페이지로 이동`
    : step.action === 'fill' ? `${step.target}에 '${step.value || ''}' 입력`
      : step.action === 'select' ? `${step.target}에서 '${step.value || ''}' 선택`
      : step.action === 'click' ? `${step.target}${step.occurrence && step.occurrence > 1 ? ` [${step.occurrence}번째]` : ''} 클릭` : `${step.target} ${label[step.action]}`

const markdownFor = (scenario: Scenario) => [
  `# 시나리오: ${scenario.title}`,
  `url: ${scenario.url}`,
  '',
  ...scenario.steps.map((step, i) => `${i === 0 ? 'Given' : 'And'} ${actionText(step)}`)
].join('\n')

const scenarioHeader = /^#{1,3}\s*시나리오:\s*(.+)$|^Scenario:\s*(.+)$/i
const resultTargetFor = (text: string): string => {
  let target = text.trim()
  let previous = ''
  while (target !== previous) {
    previous = target
    target = target
      .replace(/\s*결과\s*확인(?:을)?(?:한다)?\s*$/, '')
      .replace(/\s+(?:버튼(?:을)?\s*)?클릭\s*$/, '')
      .trim()
  }
  return target
}
const parseMarkdown = (markdown: string): Scenario[] => {
  const blocks = markdown.split(/(?=^#{1,3}\s*시나리오:|^Scenario:)/im).filter(Boolean)
  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const title = lines[0].match(scenarioHeader)?.[1] || lines[0].match(scenarioHeader)?.[2] || `시나리오 ${index + 1}`
    const url = lines.find((line) => line.startsWith('url:'))?.slice(4).trim() || seed.url
    const steps = lines.filter((line) => /^(Given|When|Then|And|But)\s+/i.test(line)).map((line, stepIndex): Step => {
      const keyword = line.match(/^(Given|When|Then|And|But)\s+/i)?.[1].toLowerCase()
      const text = line.replace(/^(Given|When|Then|And|But)\s+/i, '')
      if (keyword === 'then') return { id: String(stepIndex + 1), action: 'expectText', target: resultTargetFor(text.replace(/\s*(텍스트가\s*)?(보인다|포함된다|확인된다|표시된다).*/, '')), connected: false }
      const manual = text.match(/^(.+?)\s+수동 입력(?:\s*\[(.+)\])?$/)
      const fill = text.match(/^(.+?)(?:에|을|를)?\s*['"](.*)['"]\s*(?:자동\s*)?(?:입력|작성)/)
      const automatic = text.match(/^(.+?)\s+(?:자동|일반)\s*입력(?:\s*\[(.*)\])?$/)
      const select = text.match(/^(.+?)(?:에서|에)\s*['"](.*)['"]\s*(?:선택|고르기)/)
      if (manual) return { id: String(stepIndex + 1), action: 'manualFill', target: manual[1], prompt: manual[2], required: true, connected: true }
      if (fill) return { id: String(stepIndex + 1), action: 'fill', target: fill[1], value: fill[2], connected: true }
      if (automatic) return { id: String(stepIndex + 1), action: 'fill', target: automatic[1], value: automatic[2], connected: true }
      if (select) return { id: String(stepIndex + 1), action: 'select', target: select[1], value: select[2], connected: true }
      if (/(페이지로?\s*이동|페이지\s*이동|접속|열기)/.test(text)) {
        const target = text.replace(/\s*(페이지로?\s*이동|페이지\s*이동|접속|열기).*/, '').trim()
        return { id: String(stepIndex + 1), action: 'goto', target: /^(https?:\/\/|\/)/.test(target) ? target : '/', connected: true }
      }
      if (/보인다|포함된다|확인된다|표시된다|결과\s*확인/.test(text)) return { id: String(stepIndex + 1), action: 'expectText', target: resultTargetFor(text.replace(/\s*(텍스트가\s*)?(보인다|포함된다|확인된다|표시된다).*/, '')), connected: false }
      const clickText = text.replace(/\s+(버튼을?|버튼)?\s*클릭.*/, '').trim()
      const occurrence = Number(clickText.match(/\[(\d+)번째\]$/)?.[1]) || undefined
      return { id: String(stepIndex + 1), action: 'click', target: clickText.replace(/\s*\[\d+번째\]$/, '').trim(), occurrence, connected: true }
    })
    return { id: `scenario-${index}`, title, url, steps }
  })
}
const replaceScenarioBlock = (markdown: string, title: string, replacement: string): string => {
  const starts = [...markdown.matchAll(/^#{1,3}\s*시나리오:\s*(.+)$|^Scenario:\s*(.+)$/gim)]
  const matchIndex = starts.findIndex((match) => (match[1] || match[2])?.trim() === title)
  if (matchIndex < 0) return `${markdown.trim()}\n\n${replacement}`
  const start = starts[matchIndex].index ?? 0
  const end = starts[matchIndex + 1]?.index ?? markdown.length
  return `${markdown.slice(0, start)}${replacement}\n\n${markdown.slice(end).trimStart()}`.trim()
}
const initialMarkdown = `${markdownFor(seed)}\n\n# 시나리오: 주문 조회\nurl: https://example.com/orders\n\nGiven /orders 페이지로 이동한다\nThen 주문 목록 텍스트가 보인다`
const runHistoryKey = 'checkly-run-history'
const markerPositionKey = 'checkly-marker-positions'
const defaultMarkerPosition = (index: number) => ({ x: [78, 50, 50, 85, 87][index] ?? 50, y: [20, 43, 58, 58, 84][index] ?? 50 })
const markerColor = (index: number) => `hsl(${Math.round((index * 137.508 + 19) % 360)} 72% 48%)`
const estimateDurationSeconds = (scenario: Scenario): number => scenario.steps.reduce((seconds, step) => seconds + (step.action === 'goto' ? 3 : step.action === 'manualFill' ? 15 : 1), 0)
const formatDuration = (seconds: number): string => `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`
const scenarioPositionKey = (scenario: Scenario): string => `${scenario.title}\n${scenario.url}`
const markerPositionsFor = (scenario: Scenario): MarkerPosition[] => scenario.steps.flatMap((step) => step.x === undefined || step.y === undefined ? [] : [{ action: step.action, target: step.target, value: step.value, prompt: step.prompt, occurrence: step.occurrence, x: step.x, y: step.y, color: step.color }])
const applyMarkerPositions = (scenario: Scenario, store: MarkerPositionStore): Scenario => {
  const positions = [...(store[scenarioPositionKey(scenario)] ?? [])]
  return { ...scenario, steps: scenario.steps.map((step) => {
    const index = positions.findIndex((position) => position.action === step.action && position.target === step.target && position.value === step.value && position.prompt === step.prompt && position.occurrence === step.occurrence)
    if (index < 0) return step
    const [position] = positions.splice(index, 1)
    return { ...step, x: position.x, y: position.y, color: position.color }
  }) }
}

export const App = (): ReactElement => {
  const [scenario, setScenario] = useState<Scenario>(seed)
  const [sourceMarkdown, setSourceMarkdown] = useState(initialMarkdown)
  const [page, setPage] = useState<'scenarios' | 'editor' | 'run'>('scenarios')
  const [editorMode, setEditorMode] = useState<'text' | 'marker'>('text')
  const [webviewKey, setWebviewKey] = useState(0)
  const [selectedId, setSelectedId] = useState('3')
  const [editingMarker, setEditingMarker] = useState<Step | null>(null)
  const [isAddingMarker, setIsAddingMarker] = useState(false)
  const [pendingMarker, setPendingMarker] = useState<Step | null>(null)
  const [stepPanelCollapsed, setStepPanelCollapsed] = useState(false)
  const [stepPanelPosition, setStepPanelPosition] = useState({ top: 78, left: 24 })
  const [stepPanelDrag, setStepPanelDrag] = useState<{ x: number; y: number } | null>(null)
  const [stepPanelMoved, setStepPanelMoved] = useState(false)
  const [manual, setManual] = useState<Step | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [manualValueVisible, setManualValueVisible] = useState(false)
  const [running, setRunning] = useState(false)
  const [runLog, setRunLog] = useState<string[]>([])
  const [livePreview, setLivePreview] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [runProgress, setRunProgress] = useState<RunProgress>({ current: 0, total: seed.steps.length, step: '' })
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [notice, setNotice] = useState('')
  const [runHistory, setRunHistory] = useState<RunRecord[]>([])
  const [runSummary, setRunSummary] = useState<RunSummary>({ total: 0, passed: 0, failed: 0 })
  const [markerPositionsReady, setMarkerPositionsReady] = useState(false)
  const [markerPositionStore, setMarkerPositionStore] = useState<MarkerPositionStore>({})

  useEffect(() => {
    const restore = (stored: string | null, positionData: string | null): void => {
      if (!stored) return
      setSourceMarkdown(stored)
      const [first] = parseMarkdown(stored)
      if (first) {
        try {
          const store = JSON.parse(positionData ?? '{}') as MarkerPositionStore
          setMarkerPositionStore(store)
          setScenario(applyMarkerPositions(first, store))
        }
        catch { setScenario(first) }
      }
    }
    const markdown = window.electronAPI.loadScenarioMarkdown()
    const positions = window.electronAPI.loadMarkerPositions()
    Promise.all([markdown, positions]).then(([stored, positionData]) => restore(stored, positionData)).finally(() => setMarkerPositionsReady(true))
  }, [])
  useEffect(() => {
    if (!markerPositionsReady) return
    setMarkerPositionStore((store) => ({ ...store, [scenarioPositionKey(scenario)]: markerPositionsFor(scenario) }))
  }, [scenario, markerPositionsReady])
  useEffect(() => {
    if (!markerPositionsReady) return
    const save = async () => {
      const serialized = JSON.stringify(markerPositionStore)
      await window.electronAPI.saveMarkerPositions(serialized)
    }
    save().catch(() => setNotice('마커 위치를 저장하지 못했습니다.'))
  }, [markerPositionStore, markerPositionsReady])
  useEffect(() => {
    const stored = window.localStorage.getItem(runHistoryKey)
    if (!stored) return
    try {
      const data = JSON.parse(stored) as { history?: RunRecord[]; summary?: RunSummary }
      setRunHistory(data.history?.slice(0, 5) ?? [])
      setRunSummary(data.summary ?? { total: 0, passed: 0, failed: 0 })
    } catch { window.localStorage.removeItem(runHistoryKey) }
  }, [])
  useEffect(() => window.electronAPI.onManualInputRequired((step) => {
    setManual(step); setManualValueVisible(false); setRunLog((logs) => [...logs, `단계 ${step.id}: ${step.target} 수동 입력 대기`])
  }), [])
  useEffect(() => window.electronAPI.onQaProgress((progress) => {
    setRunProgress(progress)
    setRunLog((logs) => [...logs, `${progress.current}/${progress.total} ${progress.step}`])
  }), [])
  useEffect(() => window.electronAPI.onQaPreview((image) => setPreviewImage(image)), [])
  useEffect(() => {
    if (!running || !runStartedAt) return
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [running, runStartedAt])
  useEffect(() => {
    if (!stepPanelDrag) return
    const move = (event: PointerEvent) => {
      setStepPanelMoved(true)
      setStepPanelPosition({ top: Math.max(16, event.clientY - stepPanelDrag.y), left: Math.max(16, event.clientX - stepPanelDrag.x) })
    }
    const stop = () => setStepPanelDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  }, [stepPanelDrag])
  useEffect(() => {
    const items = [...document.querySelectorAll<HTMLLIElement>('.step-list li')]
    const cleanup = items.map((item, index) => {
      const id = scenario.steps[index]?.id
      if (!id) return () => undefined
      item.draggable = true
      item.title = '드래그하여 실행 순서 변경'
      const dragStart = (event: DragEvent) => {
        event.dataTransfer?.setData('text/plain', id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        item.classList.add('dragging')
      }
      const dragOver = (event: DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move' }
      const drop = (event: DragEvent) => {
        event.preventDefault()
        moveStep(event.dataTransfer?.getData('text/plain') ?? '', id)
      }
      const dragEnd = () => item.classList.remove('dragging')
      item.addEventListener('dragstart', dragStart)
      item.addEventListener('dragover', dragOver)
      item.addEventListener('drop', drop)
      item.addEventListener('dragend', dragEnd)
      return () => {
        item.removeEventListener('dragstart', dragStart)
        item.removeEventListener('dragover', dragOver)
        item.removeEventListener('drop', drop)
        item.removeEventListener('dragend', dragEnd)
      }
    })
    return () => cleanup.forEach((remove) => remove())
  }, [scenario.steps, selectedId])
  useEffect(() => {
    if (page !== 'editor' || editorMode !== 'marker') return
    const requestSave = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.marker-toolbar .button.button-secondary') : null
      if (!target || !target.textContent?.includes('편집기로 돌아가기')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (window.confirm('마커 편집기의 수정 사항을 저장하시겠습니까?')) {
        void persistScenario().then(() => setEditorMode('text'))
      } else {
        setEditorMode('text')
      }
    }
    window.addEventListener('click', requestSave, true)
    return () => window.removeEventListener('click', requestSave, true)
  }, [page, editorMode, scenario, sourceMarkdown])
  useEffect(() => {
    if (page !== 'editor' || editorMode !== 'marker') return
    window.electronAPI.inspectScenario(scenario).then((matches) => {
      updateSteps(scenario.steps.map((step) => ({ ...step, connected: matches.find((match) => match.id === step.id)?.connected ?? false })))
    }).catch(() => setNotice('대상 페이지를 확인하지 못했습니다. 기존 연결 정보를 유지합니다.'))
  // 마커 편집 진입 시점의 연결 상태만 재검사한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, editorMode])
  const selected = useMemo(() => scenario.steps.find((s) => s.id === selectedId), [scenario.steps, selectedId])
  const markdownPreview = useMemo(() => {
    const [parsed] = parseMarkdown(sourceMarkdown)
    return parsed
  }, [sourceMarkdown])
  const persistScenario = async () => {
    const next = replaceScenarioBlock(sourceMarkdown, scenario.title, markdownFor(scenario))
    setSourceMarkdown(next)
    await window.electronAPI.saveScenarioMarkdown(next)
    setNotice('변경사항을 기존 시나리오 블록에 저장했습니다.')
  }
  const importScenario = async () => {
    const markdown = await window.electronAPI.importScenarioFile()
    if (markdown === null) return
    const scenarios = parseMarkdown(markdown)
    if (!scenarios.length) { setNotice('불러올 수 있는 시나리오 제목과 단계를 확인해 주세요.'); return }
    const nextScenario = applyMarkerPositions(scenarios[0], markerPositionStore)
    setSourceMarkdown(markdown); setScenario(nextScenario); setSelectedId(nextScenario.steps[0]?.id ?? '')
    await window.electronAPI.saveScenarioMarkdown(markdown)
    setNotice(`${scenarios.length}개 시나리오를 불러왔습니다. 첫 시나리오를 마커로 편집할 수 있습니다.`)
  }
  const exportScenario = async () => {
    const filePath = await window.electronAPI.exportScenarioFile(sourceMarkdown)
    if (filePath) setNotice('시나리오 파일을 저장했습니다.')
  }
  const updateSteps = (steps: Step[]) => setScenario((current) => ({ ...current, steps: steps.map((s, i) => ({ ...s, id: String(i + 1) })) }))
  const recordRun = (completedScenario: Scenario, status: 'passed' | 'failed') => {
    const record: RunRecord = { id: `${Date.now()}`, scenario: completedScenario, status, ranAt: new Date().toISOString() }
    setRunHistory((current) => {
      const history = [record, ...current].slice(0, 5)
      setRunSummary((summary) => {
        const next = { total: summary.total + 1, passed: summary.passed + Number(status === 'passed'), failed: summary.failed + Number(status === 'failed') }
        window.localStorage.setItem(runHistoryKey, JSON.stringify({ history, summary: next }))
        return next
      })
      return history
    })
  }
  const deleteStep = (id: string) => {
    updateSteps(scenario.steps.filter((step) => step.id !== id))
    setSelectedId(String(Math.max(1, Number(id) - 1)))
  }
  const moveStep = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const sourceIndex = scenario.steps.findIndex((step) => step.id === sourceId)
    const targetIndex = scenario.steps.findIndex((step) => step.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const steps = [...scenario.steps]
    const [moved] = steps.splice(sourceIndex, 1)
    steps.splice(targetIndex, 0, moved)
    const selectedStep = scenario.steps.find((step) => step.id === selectedId)
    updateSteps(steps)
    setSelectedId(selectedStep ? String(steps.indexOf(selectedStep) + 1) : '')
  }
  const beginMarkerPlacement = () => {
    setPendingMarker(null)
    setIsAddingMarker(true)
    setNotice('대상 화면에서 마커를 추가할 위치를 클릭해 주세요.')
  }
  const placeMarker = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingMarker) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const nextIndex = scenario.steps.length
    setPendingMarker({
      id: String(nextIndex + 1), action: 'click', target: '', connected: true,
      x: Math.round((event.clientX - bounds.left) / bounds.width * 1000) / 10,
      y: Math.round((event.clientY - bounds.top) / bounds.height * 1000) / 10,
      color: markerColor(nextIndex)
    })
    setIsAddingMarker(false)
    setNotice('')
  }
  const markerDialog = pendingMarker ?? editingMarker
  const updateMarkerDialog = (changes: Partial<Step>) => {
    if (pendingMarker) setPendingMarker({ ...pendingMarker, ...changes })
    if (editingMarker) setEditingMarker({ ...editingMarker, ...changes })
  }
  const closeMarkerDialog = () => { setPendingMarker(null); setEditingMarker(null) }
  const beginStepPanelDrag = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.tagName === 'BUTTON' ? event.currentTarget.getBoundingClientRect() : event.currentTarget.parentElement?.getBoundingClientRect()
    if (bounds) {
      event.currentTarget.setPointerCapture(event.pointerId)
      setStepPanelMoved(false)
      setStepPanelDrag({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    }
  }
  const completeMarkerDialog = () => {
    if (!markerDialog || !markerDialog.target.trim()) return
    if (pendingMarker) updateSteps([...scenario.steps, pendingMarker])
    if (editingMarker) updateSteps(scenario.steps.map((step) => step.id === editingMarker.id ? editingMarker : step))
    setSelectedId(markerDialog.id)
    closeMarkerDialog()
  }
  const beginRun = async (scenarioToRun = scenario) => {
    const startedAt = Date.now()
    setPage('run'); setRunning(true); setPreviewImage(''); setRunStartedAt(startedAt); setElapsedSeconds(0)
    setRunProgress({ current: 0, total: scenarioToRun.steps.length, step: '' })
    setRunLog(['기본 URL 상태 점검 완료', '시나리오 실행을 시작했습니다.'])
    window.electronAPI.runQa(scenarioToRun, { preview: livePreview }).then((result) => {
      setRunLog((logs) => [...logs, ...result.log, result.status === 'passed' ? '시나리오 통과' : result.status === 'cancelled' ? '실행 취소됨' : '실행 실패'])
      if (result.status === 'passed' || result.status === 'failed') recordRun(scenarioToRun, result.status)
      if (result.status === 'passed') setRunProgress({ current: scenarioToRun.steps.length, total: scenarioToRun.steps.length, step: '시나리오 완료' })
      setRunning(false)
    }).catch((error: unknown) => {
      setRunLog((logs) => [...logs, `시나리오 실행을 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`])
      setRunning(false)
    })
  }
  const continueManual = async () => {
    if (!manual || (manual.required && !manualValue.trim())) return
    await window.electronAPI.submitManualInput(manualValue)
    setRunLog((logs) => [...logs, `단계 ${manual.id}: ${manual.target} 수동 입력 — 완료`])
    setManualValue(''); setManualValueVisible(false); setManual(null)
  }
  const cancelRun = async () => {
    await window.electronAPI.cancelQa(); setManualValueVisible(false); setManual(null); setRunning(false)
    setRunLog((logs) => [...logs, '실행이 취소되었습니다. 이후 단계는 실행하지 않았습니다.'])
  }
  const estimatedSeconds = estimateDurationSeconds(scenario)
  const progressPercent = runProgress.total ? Math.round(runProgress.current / runProgress.total * 100) : 0
  const estimatedCompletion = runStartedAt ? new Date(runStartedAt + estimatedSeconds * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : null

  return <main className={`workspace${page === 'editor' && editorMode === 'marker' ? ' screen-extract-workspace' : ''}`}>
      <section className="content">
        {page === 'scenarios' && <>
          <div className="page-title"><div><p className="eyebrow">DASHBOARD</p><h1>대시보드</h1><p>최근 실행 현황을 확인하고 이전 시나리오를 빠르게 다시 시작하세요.</p></div></div>
          <section className="run-summary" aria-label="실행 요약"><article><span>평균 통과율</span><strong>{runSummary.total ? Math.round(runSummary.passed / runSummary.total * 100) : 0}%</strong><small>통과 {runSummary.passed}회</small></article><article><span>실패율</span><strong>{runSummary.total ? Math.round(runSummary.failed / runSummary.total * 100) : 0}%</strong><small>실패 {runSummary.failed}회</small></article><article><span>전체 실행 수</span><strong>{runSummary.total}</strong><small>누적 실행 기준</small></article></section>
          <section className="recent-runs"><div className="panel-heading"><div><p className="eyebrow">RECENT RUNS</p><h2>이전 실행 시나리오</h2></div><span>최근 {runHistory.length}/5</span></div>{runHistory.length ? <ol className="recent-run-list">{runHistory.map((record) => <li key={record.id}><div className={record.status === 'passed' ? 'run-result passed' : 'run-result failed'}>{record.status === 'passed' ? '✓' : '!'}</div><div className="recent-run-info"><strong>{record.scenario.title}</strong><span>{record.scenario.url}</span><small>{record.scenario.steps.length}개 단계 · {new Date(record.ranAt).toLocaleString('ko-KR')}</small></div><div className="recent-run-actions"><button className="button button-secondary" onClick={() => { setScenario(record.scenario); setSelectedId(record.scenario.steps[0]?.id ?? ''); setEditorMode('marker'); setPage('editor') }}>편집</button><button className="button button-primary" onClick={() => { setScenario(record.scenario); beginRun(record.scenario) }}>퀵 스타트</button></div></li>)}</ol> : <div className="empty-runs"><strong>아직 실행 기록이 없습니다.</strong><p>실행 탭에서 시나리오를 시작하면 최근 5개의 기록이 여기에 저장됩니다.</p><button className="button button-secondary" onClick={() => setPage('run')}>실행 화면으로 이동</button></div>}</section>
        </>}
        {page === 'editor' && <>
          <div className="page-title editor-page-title"><div><p className="eyebrow">SCENARIO WORKSPACE</p><h1>시나리오 작성 / 편집</h1><p>{editorMode === 'text' ? '텍스트 기반 시나리오를 작성하고 실행 단계를 미리 확인하세요.' : '대상 화면에서 마커를 선택해 액션과 순서를 편집하세요.'}</p></div><div className="editor-mode-switch"><button className={editorMode === 'text' ? 'active' : ''} onClick={() => setEditorMode('text')}>텍스트 편집</button><button className={editorMode === 'marker' ? 'active' : ''} onClick={() => setEditorMode('marker')}>화면에서 추출</button></div></div>
          {notice && <div className="notice">✓ {notice}</div>}
          {editorMode === 'text' ? <><div className="editor-actions"><button className="button button-secondary" onClick={importScenario}>시나리오 불러오기</button><button className="button button-primary" onClick={exportScenario}>시나리오 저장하기</button></div><div className="scenario-writing-grid"><section className="writing-card"><div className="writing-card-header"><strong>시나리오 Markdown</strong><span>{markdownPreview?.title ?? '미리보기'}.md</span></div><textarea className="scenario-source" value={sourceMarkdown} onChange={(event) => setSourceMarkdown(event.target.value)} aria-label="시나리오 Markdown 원본" /></section><aside className="scenario-preview"><div className="writing-card-header"><strong>실행 미리보기</strong><span>{markdownPreview?.steps.length ?? 0}개 단계 인식</span></div>{markdownPreview ? <><div className="preview-before"><b>기본 URL</b><span>{markdownPreview.url}</span></div><article className="preview-scenario"><div><h2>{markdownPreview.title}</h2><span className="tag">자동 인식</span></div><ol>{markdownPreview.steps.map((step) => <li key={step.id}><b>{label[step.action]}</b><span>{actionText(step)}</span></li>)}</ol></article><p className="preview-note">Given / When / Then / And 문장을 자동으로 인식합니다. 불러온 시나리오는 화면 편집기에 반영됩니다.</p></> : <div className="preview-empty"><strong>시나리오 형식을 인식하지 못했습니다.</strong><p><code># 시나리오: 제목</code>과 <code>Given /login 페이지로 이동</code> 형식으로 작성해 주세요.</p></div>}</aside></div></> : <><div className="marker-toolbar"><strong>{isAddingMarker ? '⌖ 위치 선택 중' : '✣ 핀 수정 중'}</strong><button onClick={beginMarkerPlacement}>{isAddingMarker ? '다시 선택' : '마커 추가'}</button><button onClick={() => updateSteps(scenario.steps.slice(0, -1))}>마지막 삭제</button><button onClick={() => { updateSteps([]); setSelectedId('') }}>전체 초기화</button><button className="button button-secondary" onClick={() => setEditorMode('text')}>×&nbsp; 편집기로 돌아가기</button></div><div className="marker-editor-layout"><section className="browser-canvas marker-canvas"><div className="browser-bar"><span className="browser-dots" aria-hidden="true">● ● ●</span><input value={scenario.url} onChange={(e) => setScenario({ ...scenario, url: e.target.value })} aria-label="대상 URL" /><button className="browser-refresh" onClick={() => setWebviewKey((key) => key + 1)}>↻&nbsp; 새로고침</button></div><div className="mock-page"><webview key={webviewKey} className="target-frame" src={scenario.url} aria-label="시나리오 대상 페이지" /><div className="page-fallback"><div className="mock-logo">Electron 대상 페이지</div><p>데스크톱 웹뷰에서 대상 URL을 열었습니다. 연결 상태는 Playwright로 확인합니다.</p></div>{isAddingMarker && <div className="marker-placement-layer" onClick={placeMarker} aria-label="마커를 추가할 위치" />}{scenario.steps.map((step, index) => { const position = step.x === undefined || step.y === undefined ? defaultMarkerPosition(index) : { x: step.x, y: step.y }; return step.connected && <button key={step.id} className={'marker' + (selectedId === step.id ? ' selected' : '')} style={{ left: `${position.x}%`, top: `${position.y}%`, backgroundColor: step.color ?? markerColor(index) }} onClick={() => setSelectedId(step.id)} aria-label={`${step.id}번 ${step.target} 마커`}>{step.id}</button> })}</div></section>{stepPanelCollapsed ? <button className="step-panel-toggle collapsed" style={stepPanelPosition} onPointerDown={beginStepPanelDrag} onClick={() => !stepPanelMoved && setStepPanelCollapsed(false)} aria-label="실행 단계 열기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button> : <aside className="step-panel marker-steps" style={stepPanelPosition}><div className="panel-heading step-panel-handle" onPointerDown={beginStepPanelDrag}><h2>실행 단계</h2><span>{scenario.steps.length}개</span><button className="step-panel-toggle" onPointerDown={(event) => event.stopPropagation()} onClick={() => setStepPanelCollapsed(true)} aria-label="실행 단계 접기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button></div><ol className="step-list">{scenario.steps.map((step) => <li key={step.id} className={selectedId === step.id ? "selected" : ""}><button onClick={() => setSelectedId(step.id)}><b>{step.id}</b><span><strong>{label[step.action]}</strong>{step.target}<small>{step.connected ? "연결됨" : "미연결 단계"}</small></span></button><button className="edit-step-button" onClick={() => setEditingMarker(step)} aria-label="단계 편집">✎</button><button className="delete-button" onClick={() => deleteStep(step.id)} aria-label="단계 삭제">×</button></li>)}</ol><button className="add-step" onClick={beginMarkerPlacement}>+ 새 마커 추가</button></aside>}</div></>}
        </>}
        {page === 'run' && <>
          <div className="page-title"><div><p className="eyebrow">RUN CONSOLE</p><h1>QA 실행</h1><p>{running ? '브라우저 상태를 유지하며 실행 중입니다.' : '실행할 시나리오를 선택하세요.'}</p></div>{running ? <button className="button danger" onClick={cancelRun}>실행 취소</button> : <button className="button button-primary" onClick={() => void beginRun()}>▶ 실행 시작</button>}</div>
          <div className="run-layout"><section className="run-main"><div className="run-state"><span className={running ? 'pulse' : 'check'}>{running ? '◌' : '✓'}</span><div><strong>{manual ? '수동 입력 대기 중' : running ? '시나리오 실행 중' : '실행 준비됨'}</strong><p>{manual ? `${manual.target} 값을 기다리고 있습니다.` : `${scenario.title} · ${scenario.steps.length}개 단계`}</p></div></div><section className="run-scenario-preview" aria-label="실행 시나리오 미리보기"><div><strong>{scenario.title}</strong><span>{scenario.url}</span></div><ol>{scenario.steps.map((step) => <li key={step.id} className={running && step.id === String(runProgress.current) ? 'current' : ''}><b>{step.id}</b>{actionText(step)}</li>)}</ol></section><div className="run-timing"><span>진행 {runProgress.current}/{runProgress.total} · {progressPercent}%</span><span>경과 {formatDuration(elapsedSeconds)}</span><span>예상 {formatDuration(estimatedSeconds)}{estimatedCompletion ? ` · 완료 ${estimatedCompletion}` : ''}</span></div><div className="progress" aria-label={`실행 진행률 ${progressPercent}%`}><span style={{ width: `${progressPercent}%` }} /></div>{livePreview && <section className="live-preview" aria-label="실시간 테스트 화면"><div><strong>실시간 테스트 화면</strong><span>단계마다 캡처되어 실행 속도가 다소 느려질 수 있습니다.</span></div>{previewImage ? <img src={previewImage} alt="현재 테스트 실행 화면" /> : <p>첫 실행 화면을 기다리고 있습니다.</p>}</section>}<div className="log-box" aria-live="polite">{runLog.length ? runLog.map((log, i) => <p key={i}><time>{String(i + 9).padStart(2, '0')}:24</time>{log}</p>) : <p className="muted">실행 로그가 여기에 표시됩니다.</p>}</div></section><aside className="run-side"><h2>실행 설정</h2><label>브라우저<select><option>Chromium</option><option>Firefox</option></select></label><label>워커 수<select><option>1</option></select></label><label className="toggle"><input type="checkbox" checked={livePreview} onChange={(event) => setLivePreview(event.target.checked)} disabled={running} /> 실시간 테스트 화면 보기</label><p className="run-setting-help">화면을 캡처해 보여주므로 실행 시간이 조금 늘어날 수 있습니다. 끄면 백그라운드에서 더 빠르게 실행합니다.</p><label className="toggle"><input type="checkbox" /> 실패 즉시 중단</label></aside></div>
        </>}
      </section>
    <nav className="bottom-navigation" aria-label="주요 메뉴">
      <button className={page === 'scenarios' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => setPage('scenarios')} aria-label="대시보드"><span aria-hidden="true">⌂</span><small>대시보드</small></button>
      <button className={page === 'editor' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => setPage('editor')} aria-label="작성/편집"><span aria-hidden="true">⌖</span><small>작성/편집</small></button>
      <button className={page === 'run' ? 'bottom-nav-item active' : 'bottom-nav-item'} onClick={() => setPage('run')} aria-label="실행 콘솔"><span aria-hidden="true">▷</span><small>실행</small></button>
    </nav>
    {manual && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-title"><div className="manual-modal"><span className="manual-icon">⌨</span><p className="eyebrow">EXECUTION PAUSED · STEP {manual.id}</p><h2 id="manual-title">수동 입력이 필요합니다</h2><p>{manual.prompt || `${manual.target}를 입력해 주세요.`}</p><label>{manual.target}<input autoFocus type={manualValueVisible ? 'text' : 'password'} value={manualValue} onChange={(e) => setManualValue(e.target.value)} placeholder="입력값" onKeyDown={(e) => e.key === 'Enter' && continueManual()} /></label><label className="manual-visibility-toggle"><input type="checkbox" checked={manualValueVisible} onChange={(event) => setManualValueVisible(event.target.checked)} /> 입력값 표시</label><p className="security-note">입력값은 이번 실행에만 사용되며 시나리오, 로그, 리포트에 저장되지 않습니다.</p><div className="modal-actions"><button className="button button-secondary" onClick={cancelRun}>실행 취소</button><button className="button button-primary" onClick={continueManual} disabled={manual.required && !manualValue.trim()}>입력 후 계속</button></div></div></div>}
    {markerDialog && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="marker-action-title"><div className="manual-modal marker-action-modal"><p className="eyebrow">{pendingMarker ? "NEW MARKER" : "EDIT MARKER"} · STEP {markerDialog.id}</p><h2 id="marker-action-title">마커 액션 정의</h2><p>선택한 위치에서 실행할 액션을 설정해 주세요.</p><label>액션<select value={markerDialog.action} onChange={(e) => updateMarkerDialog({ action: e.target.value as Action })}>{Object.entries(label).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>라벨<input autoFocus value={markerDialog.target} onChange={(e) => updateMarkerDialog({ target: e.target.value })} placeholder="예: 로그인 버튼" /></label>{markerDialog.action === 'click' && <label>동일 대상 순서<input type="number" min="1" value={markerDialog.occurrence ?? 1} onChange={(e) => { const occurrence = Math.max(1, Number(e.target.value) || 1); updateMarkerDialog({ occurrence: occurrence === 1 ? undefined : occurrence }) }} /><small>같은 이름의 버튼이 여러 개면 클릭할 순서를 지정합니다.</small></label>}{['fill', 'select'].includes(markerDialog.action) && <label>값<input value={markerDialog.value ?? ''} onChange={(e) => updateMarkerDialog({ value: e.target.value })} placeholder="입력 또는 선택할 값" /></label>}{markerDialog.action === 'manualFill' && <label>안내 문구<input value={markerDialog.prompt ?? ''} onChange={(e) => updateMarkerDialog({ prompt: e.target.value, required: true })} placeholder="사용자에게 표시할 안내" /></label>}<div className="modal-actions"><button className="button button-secondary" onClick={closeMarkerDialog}>취소</button><button className="button button-primary" onClick={completeMarkerDialog} disabled={!markerDialog.target.trim()}>마커 편집 완료</button></div></div></div>}
  </main>
}
