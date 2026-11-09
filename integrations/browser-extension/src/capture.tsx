import React from 'react';
import {createRoot} from 'react-dom/client';
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
  const dataUrl = (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.remove(key);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw Error('캡처가 만료되었거나 이미 열렸습니다.');
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  root.render(<ScreenshotEditor capture={{dataUrl,size:{width:image.naturalWidth,height:image.naturalHeight}}}
    onCancel={() => window.close()}
    onCopy={async result => {
      try {
        const blob = await (await fetch(result)).blob();
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
        window.close();
      } catch (error) {
        alert(`클립보드 복사에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
      }
    }} />);
}
start().catch(error => { root.render(<p>화면 캡처를 열지 못했습니다: {String(error.message)}</p>); });
