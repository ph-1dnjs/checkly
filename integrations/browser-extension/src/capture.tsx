import {createRoot} from 'react-dom/client';
import {closeCaptureEditor} from './capture-focus.js';
import {ScreenshotEditor} from '../../../src/renderer/pages/form-automation/ScreenshotEditor';
import '../../../src/renderer/styles/controls.css';
import '../../../src/renderer/styles/form-automation.css';
import './capture.css';

const root = createRoot(document.getElementById('root')!);
async function start() {
  const id = location.hash.slice(1);
  if (id === 'capture-failed') throw Error('현재 탭을 캡처하지 못했습니다. Chrome의 제한 페이지인지 확인하고 다시 시도하세요.');
  if (!/^[\da-f-]{36}$/i.test(id)) throw Error('캡처 정보를 찾을 수 없습니다.');
  const key = `capture:${id}`;
  const saved = (await chrome.storage.session.get(key))[key];
  // Captures opened by a previous version stored only the image string.
  const dataUrl = typeof saved === 'string' ? saved : saved?.dataUrl;
  const source = typeof saved === 'string' ? null : saved;
  await chrome.storage.session.remove(key);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw Error('캡처가 만료되었거나 이미 열렸습니다.');
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const overlay = new URLSearchParams(location.search).get('overlay') === '1' && window.parent !== window;
  const closeEditor = () => {
    if (overlay) window.parent.postMessage({type:'checkly-capture-close', token:id}, '*');
    else void closeCaptureEditor(source, chrome.tabs, () => window.close());
  };
  root.render(<ScreenshotEditor recorder capture={{dataUrl,size:{width:image.naturalWidth,height:image.naturalHeight}}}
    onCancel={closeEditor}
    onCopy={async result => {
      try {
        const blob = await (await fetch(result)).blob();
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
        closeEditor();
      } catch (error) {
        alert(`클립보드 복사에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
      }
    }} />);
}
start().catch(error => {
  const overlay = new URLSearchParams(location.search).get('overlay') === '1' && window.parent !== window;
  const close = () => { if (overlay) window.parent.postMessage({type:'checkly-capture-close', token:location.hash.slice(1)}, '*'); else window.close(); };
  root.render(<div className="capture-error"><p>화면 캡처를 열지 못했습니다: {String(error.message)}</p><button type="button" onClick={close}>닫기</button></div>);
});
