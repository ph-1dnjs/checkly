# React Native 개발 앱 연결

Checkly의 **폼 자동 완성 → 모바일 앱**에서 iOS 시뮬레이터 화면과 해당 RN 앱의 `fetch` 요청·응답을 확인합니다. 화면은 idb의 MJPEG 스트림이며 터치, 드래그, 홈, Enter, Backspace와 텍스트 입력을 전달합니다. Simulator 창을 직접 열 필요는 없지만 Mac에 Xcode와 iOS 런타임이 설치되어 있어야 합니다.

## 준비

1. Xcode에서 iOS 런타임을 설치하고 개발 앱을 한 번 빌드·설치합니다. Checkly는 설치된 앱을 실행하며 앱 빌드나 Metro 실행을 대신하지 않습니다.
2. [idb 공식 설치 안내](https://fbidb.io/idb/installation/)에 따라 `brew install facebook/fb/idb`를 실행합니다. 검증 환경은 Apple Silicon, Xcode 26.2, iOS 26.2, idb 1.7.6입니다. Homebrew에서 신뢰 확인을 요구하면 해당 공식 formula 및 필수 formula만 신뢰합니다.
3. 프로젝트에서 Metro를 실행합니다 (`npm start`).
4. Checkly에서 기기를 선택하고 **연결**을 누릅니다. 꺼진 기기는 백그라운드에서 부팅합니다. 앱 선택 후 **앱 열기**를 누릅니다.

## 개발용 연결 모듈

이 폴더의 `checkly.js`를 RN 프로젝트의 `index.js` 옆에 복사합니다. Checkly의 **React Native 연결 안내 → 연결 모듈 저장**으로도 저장할 수 있습니다. 프로젝트에 아래 `checklySetup.js`를 추가합니다.

```js
if (__DEV__) {
  require('./checkly').installCheckly({
    enabled: true,
    clientId: 'com.example.myapp', // 앱별로 고유한 ID. iOS bundle ID 권장
    name: '내 개발 앱',
  });
}
```

`index.js`에서 앱을 import하기 전에 초기화합니다.

```js
import './checklySetup';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
AppRegistry.registerComponent(appName, () => App);
```

앱을 새로고침하면 Checkly에 연결된 앱 이름이 나타납니다. 배포 빌드에서는 `__DEV__` 조건이 false여서 설치 함수가 호출되지 않습니다. 초기화 코드는 **초기화 코드 복사** 버튼으로도 만들 수 있습니다.

## 네트워크와 오버라이드

- RN의 전역 `fetch`를 관찰합니다. `fetch`를 사용하는 HTTP 클라이언트도 포함되지만 직접 XHR, Axios의 XHR 어댑터, 네이티브 SDK, WebSocket은 지원하지 않습니다.
- 네트워크에서 실제 응답을 선택하고 **응답 오버라이드**로 복제합니다. 처음에는 비활성 규칙입니다.
- JSON·상태 코드·주소를 수정하고 **저장 및 적용** 후 앱에서 요청을 다시 실행합니다. 응답을 자동으로 다시 요청하지 않으므로 POST 등의 부수효과를 반복하지 않습니다.
- 규칙은 앱 ID, HTTP 메서드, origin(프로토콜·호스트·포트), pathname이 일치할 때 적용됩니다. query/hash 및 끝의 `/`는 무시합니다. 적용된 요청은 서버로 전송하지 않습니다.
- 원본으로 돌아가려면 규칙을 끄거나 초기화합니다. 연결 해제·Checkly 종료·브리지 오류 시 다음 요청은 원본 `fetch`로 처리합니다.
- 요청 전에 규칙 동기화를 기다리며 연결 시도 제한 시간은 700ms입니다. 앱 동작에 네트워크 검사 지연이 추가되므로 개발 빌드에서만 사용합니다.
- 규칙은 `checkly-form-native-overrides`에 저장하며 웹뷰용 규칙과 분리합니다. 사용자·기기별로 규칙을 나누려면 고유한 `clientId`를 사용합니다.
- 최근 로그는 최대 300건·약 2MiB를 메모리에 유지합니다. **다운로드**로 현재 앱의 JSON 로그를 저장할 수 있습니다. 전체 삭제는 모바일 로그 전체를 지웁니다.
- 텍스트 본문은 24,000자까지만 기록합니다. 바이너리·SSE·명시적으로 큰 본문은 생략합니다. 인증 헤더는 수집하지 않지만 본문과 URL은 앱의 실제 데이터를 포함합니다.

## 실행 경계

브리지는 `127.0.0.1:4319`에서만 수신합니다. 브라우저 Origin 요청, 잘못된 Host, 전용 헤더가 없는 요청은 거부합니다. 별도의 인증 서버는 없으며 같은 Mac의 로컬 프로세스를 신뢰하는 개발 전용 기능입니다. 포트가 이미 사용 중이면 오류를 표시하고 다른 서버를 종료하지 않습니다.

모바일 화면을 나가거나 연결을 해제하면 화면 스트림과 네트워크 브리지를 종료합니다. 기존 앱·Metro·시뮬레이터 자체는 종료하지 않습니다. 텍스트 입력은 한글을 지원하기 위해 시뮬레이터 클립보드에 복사한 후 붙여넣기를 전달합니다.

Android 화면 통합·실기기·원격 Mac은 현재 지원 범위가 아닙니다.
