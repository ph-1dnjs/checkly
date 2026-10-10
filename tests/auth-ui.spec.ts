import { expect, test, type Page } from '@playwright/test'
import { authCalls, installAuthStub, owner } from './fixtures/auth-stub'

const loginForm = (page: Page) => page.locator('[data-screen-label="시작 · 로그인"]')
const dock = (page: Page) => page.getByRole('navigation', { name: '주요 메뉴' })

async function openSettings(page: Page) {
  await dock(page).getByRole('button', { name: '설정' }).click()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
}

test.describe('팀 프로젝트 로그인 꺼짐', () => {
  test('enabled=false면 로그인 없이 앱과 예전 PROJECT 설정을 그대로 보여준다', async ({ page }) => {
    await installAuthStub(page, { enabled: false })
    await page.goto('/')
    await expect(page.getByText('대시보드', { exact: true })).toBeVisible()
    await expect(loginForm(page)).toHaveCount(0)
    await openSettings(page)
    await expect(page.getByText('기본 URL')).toBeVisible()
    await expect(page.getByRole('region', { name: '계정' })).toHaveCount(0)
  })

  test('auth bridge가 없으면(웹 개발 shim·기존 테스트) 지금처럼 바로 앱을 연다', async ({ page }) => {
    await installAuthStub(page, { enabled: 'missing' })
    await page.goto('/')
    await expect(page.getByText('대시보드', { exact: true })).toBeVisible()
    await expect(loginForm(page)).toHaveCount(0)
  })
})

test('세션 확인이 실패하면(오프라인) 이유와 다시 시도를 보여주고, 다시 시도하면 로그인 화면으로 간다', async ({ page }) => {
  await installAuthStub(page, { enabled: true, offlineSessionChecks: 2 })
  await page.goto('/')
  const screen = page.locator('[data-screen-label="시작 · 연결 실패"]')
  await expect(screen.getByRole('alert')).toHaveText(/서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요./)
  await expect(loginForm(page)).toHaveCount(0)
  await expect(dock(page)).toHaveCount(0)
  await page.getByRole('button', { name: '다시 시도' }).click()
  // 두 번째도 실패하면 같은 화면에 머문다.
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeEnabled()
  await expect(screen).toBeVisible()
  await page.getByRole('button', { name: '다시 시도' }).click()
  await expect(loginForm(page)).toBeVisible()
  await expect(screen).toHaveCount(0)
})

test.describe('로그인', () => {
  test('내보내져 로그아웃됐으면 로그인 화면에 이유를 보여주고, 입력을 시작하면 지운다', async ({ page }) => {
    const notice = '프로젝트에서 내보내져 로그아웃되었습니다. 다시 참여하려면 관리자에게 초대코드를 받아 새로 가입하세요.'
    await installAuthStub(page, { enabled: true, signOutNotice: notice })
    await page.goto('/')
    await expect(loginForm(page).getByRole('alert')).toContainText(notice)
    await page.getByLabel('프로젝트 코드').fill('checkly-team')
    await expect(loginForm(page).getByRole('alert')).toHaveCount(0)
  })

  test('잘못된 비밀번호는 main의 문장을 그대로 보여주고, 맞으면 앱으로 들어간다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, remembered: { projectCode: 'checkly-team', nickname: 'minsu' } })
    await page.goto('/')
    await expect(loginForm(page)).toBeVisible()
    await expect(dock(page)).toHaveCount(0)

    // 기억한 프로젝트 코드·닉네임을 미리 채운다.
    await expect(page.getByLabel('프로젝트 코드')).toHaveValue('checkly-team')
    await expect(page.getByLabel('닉네임')).toHaveValue('minsu')
    await expect(page.getByRole('checkbox', { name: '기억하기' })).toBeChecked()

    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('프로젝트 코드, 닉네임, 비밀번호를 모두 입력하세요.')

    await page.getByLabel('비밀번호', { exact: true }).fill('wrong')
    await page.getByRole('button', { name: '비밀번호 표시' }).click()
    await expect(page.getByLabel('비밀번호', { exact: true })).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('프로젝트 코드, 닉네임 또는 비밀번호가 올바르지 않습니다.')
    await expect(dock(page)).toHaveCount(0)

    await page.getByLabel('비밀번호', { exact: true }).fill('secret1')
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(dock(page)).toBeVisible()
    await expect(page.getByText('대시보드', { exact: true })).toBeVisible()
    expect((await authCalls(page)).filter(([name]) => name === 'signIn').at(-1)?.[1]).toEqual({
      projectCode: 'checkly-team', nickname: 'minsu', password: 'secret1', remember: true,
    })
  })
})

test('초대코드 가입 4단계', async ({ page }) => {
  await installAuthStub(page, { enabled: true })
  await page.goto('/')
  await page.getByRole('button', { name: '초대코드로 가입' }).click()
  const flow = page.locator('[data-screen-label="시작 · 초대코드 가입"]')
  await expect(flow.getByRole('heading', { name: '초대코드 입력' })).toBeVisible()
  await expect(flow.locator('li[aria-current="step"]')).toContainText('초대코드')

  const invite = page.getByLabel('초대코드')
  await expect(invite).toHaveAttribute('placeholder', 'XXX-XXXXXX')
  await invite.fill('zzz-zzzzzz')
  await expect(invite).toHaveValue('ZZZ-ZZZZZZ')
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByRole('alert')).toContainText('유효하지 않은 초대코드입니다.')

  // 공백·소문자·하이픈 없이 넣어도 맞춰 준다.
  await invite.fill(' chk7q2m3x ')
  await expect(invite).toHaveValue('CHK7Q2M3X')
  await page.getByRole('button', { name: '다음' }).click()

  await expect(flow.getByRole('heading', { name: '프로젝트 확인' })).toBeVisible()
  const preview = page.getByLabel('가입할 프로젝트')
  await expect(preview).toContainText('checkly-team')
  await expect(preview).toContainText('minsu')
  await expect(preview).toContainText('3명')
  await expect(preview).toContainText('2026. 3. 4.')
  await page.getByRole('button', { name: '이 프로젝트에 가입' }).click()

  await expect(flow.getByRole('heading', { name: '계정 설정' })).toBeVisible()
  const nickname = page.getByLabel('닉네임')
  await nickname.fill('Hy')
  await expect(page.locator('.auth-field-check')).toHaveText('영문 소문자로 시작 · 영문·숫자·_ 3–20자')
  await nickname.fill('hyewon')
  await expect(page.locator('.auth-field-check')).toHaveText('이 프로젝트에서 이미 쓰는 닉네임입니다')
  await nickname.fill('seoyeon')
  await expect(page.locator('.auth-field-check')).toHaveText('사용할 수 있는 닉네임입니다')
  await expect(page.getByLabel('비밀번호', { exact: true })).toHaveAttribute('placeholder', '6자 이상')
  await page.getByLabel('비밀번호', { exact: true }).fill('12345')
  await page.getByLabel('비밀번호 확인').fill('12345')
  await page.getByRole('button', { name: '가입하기' }).click()
  await expect(page.getByRole('alert')).toContainText('비밀번호는 6자 이상이어야 합니다.')
  await page.getByLabel('비밀번호', { exact: true }).fill('secret1')
  await page.getByLabel('비밀번호 확인').fill('secret2')
  await page.getByRole('button', { name: '가입하기' }).click()
  await expect(page.getByRole('alert')).toContainText('비밀번호가 일치하지 않습니다.')
  await page.getByLabel('비밀번호 확인').fill('secret1')
  await page.getByRole('button', { name: '가입하기' }).click()

  // joinProject가 로그인까지 해도 완료 화면을 먼저 보여준다.
  await expect(flow.getByRole('heading', { name: '가입 완료' })).toBeVisible()
  await expect(dock(page)).toHaveCount(0)
  await expect(page.getByLabel('로그인 정보')).toContainText('seoyeon')
  expect((await authCalls(page)).find(([name]) => name === 'joinProject')?.[1]).toEqual({
    inviteCode: 'CHK-7Q2M3X', nickname: 'seoyeon', password: 'secret1',
  })
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(dock(page)).toBeVisible()
})

test('새 프로젝트 2단계와 초대코드 복사', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await installAuthStub(page, { enabled: true })
  await page.goto('/')
  await page.getByRole('button', { name: '새 프로젝트 만들기' }).click()
  const flow = page.locator('[data-screen-label="시작 · 새 프로젝트"]')
  await expect(flow.getByRole('heading', { name: '새 프로젝트 만들기' })).toBeVisible()

  const code = page.getByLabel('프로젝트 코드')
  await code.fill('Checkly-Team')
  await expect(code).toHaveValue('checkly-team')
  await expect(flow.locator('.auth-field-check').first()).toHaveText('이미 사용 중인 프로젝트 코드입니다')
  await code.fill('qa-squad')
  await expect(flow.locator('.auth-field-check').first()).toHaveText('사용할 수 있는 코드입니다')
  await page.getByLabel('닉네임').fill('dain')
  await page.getByLabel('비밀번호', { exact: true }).fill('secret1')
  await page.getByLabel('비밀번호 확인').fill('secret1')

  // 생성 코드: 비우면 제출 전에 막고, 가림/표시를 바꿀 수 있고, 틀리면 서버 문장을 그대로 보여준다.
  const createCode = page.getByLabel('생성 코드', { exact: true })
  await expect(createCode).toHaveAttribute('type', 'password')
  await expect(flow).toContainText('운영자에게 받은 코드')
  await page.getByRole('button', { name: '프로젝트 만들기' }).click()
  await expect(flow.getByRole('alert')).toHaveText(/생성 코드를 입력하세요\./)
  expect((await authCalls(page)).some(([name]) => name === 'createProject')).toBe(false)
  await createCode.fill('WRONG-1')
  await page.getByRole('button', { name: '생성 코드 표시' }).click()
  await expect(createCode).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: '프로젝트 만들기' }).click()
  await expect(flow.getByRole('alert')).toHaveText(/생성 코드가 올바르지 않습니다\. 운영자에게 문의하세요\./)
  await expect(flow.getByRole('heading', { name: '새 프로젝트 만들기' })).toBeVisible()
  await createCode.fill('OPS-2026')
  await expect(flow.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '프로젝트 만들기' }).click()

  await expect(flow.getByRole('heading', { name: '프로젝트를 만들었습니다' })).toBeVisible()
  expect((await authCalls(page)).filter(([name]) => name === 'createProject').at(-1)?.[1]).toEqual({
    code: 'qa-squad', nickname: 'dain', password: 'secret1', createCode: 'OPS-2026',
  })
  await expect(flow.locator('li[aria-current="step"]')).toContainText('초대코드 공유')
  await expect(flow.locator('.auth-invite-code')).toHaveText('NEW-4K8P2Z')
  await expect(page.getByLabel('만든 프로젝트')).toContainText('관리자')
  await page.getByRole('button', { name: '초대코드 복사' }).click()
  await expect(page.getByRole('button', { name: '초대코드 복사됨' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('NEW-4K8P2Z')
  // 완료 단계에서는 이미 로그인됐으므로 뒤로 가기를 숨긴다.
  await expect(page.getByRole('button', { name: /돌아가기/ })).toHaveCount(0)

  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(dock(page)).toBeVisible()
})

test.describe('설정 · 계정과 프로젝트', () => {
  test('PROJECT의 비밀값도 팀에 공유: 기본 켬, 끌 때는 확인 후 끄고 바꾼 사람이 보인다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner, teamSettings: true })
    await page.goto('/')
    await openSettings(page)
    const toggle = page.getByRole('switch', { name: '비밀값도 팀에 공유' })
    const row = page.locator('.settings-row').filter({ has: toggle })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(row).toContainText('개발용 계정·토큰을 팀원과 같이 씁니다. 운영 계정을 넣는 프로젝트라면 끄세요.')
    await toggle.click()
    const dialog = page.getByRole('dialog', { name: '비밀값 공유를 끌까요?' })
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await dialog.getByRole('button', { name: '끄기' }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(row).toContainText('minsu님이 2026. 10. 9.에 바꿈')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect((await authCalls(page)).filter(([name]) => name === 'setShareSecrets').map(([, on]) => on)).toEqual([false, true])
  })

  test('apiTesting bridge가 없으면 비밀값 공유 행을 보여주지 않는다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner })
    await page.goto('/')
    await openSettings(page)
    await expect(page.locator('.settings-invite-code')).toHaveText('CHK-7Q2M3X')
    await expect(page.getByRole('switch', { name: '비밀값도 팀에 공유' })).toHaveCount(0)
  })

  test('계정 카드, 멤버, 엔드포인트 × 환경 저장과 충돌 안내', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner, conflictOnSecondSave: true })
    await page.goto('/')
    await expect(dock(page)).toBeVisible()
    await openSettings(page)

    const card = page.getByRole('region', { name: '계정' })
    await expect(card).toContainText('minsu')
    await expect(card).toContainText('관리자')
    await expect(card).toContainText('팀원 3명 · 생성 2026. 3. 4.')
    await expect(card.locator('.account-code')).toHaveText('checkly-team')
    await expect(page.getByText('기본 URL')).toHaveCount(0)

    await expect(page.locator('.settings-invite-code')).toHaveText('CHK-7Q2M3X')
    const members = page.getByRole('list', { name: '멤버 목록' })
    await expect(members.getByRole('listitem')).toHaveCount(3)
    await members.getByRole('button', { name: 'jiho 내보내기' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '내보내기' }).click()
    await expect(members.getByRole('listitem')).toHaveCount(2)

    const table = page.getByRole('table', { name: '엔드포인트 × 환경 주소' })
    await expect(table.getByLabel('프론트 · dev 주소')).toHaveValue('https://dev.app.com')
    await expect(table.getByLabel('백엔드 · dev 스웨거 주소')).toHaveValue('https://dev-api.app.com/v3/api-docs')
    await expect(table.getByLabel('백엔드 · staging 주소')).toHaveValue('')
    await expect(table.getByLabel('백엔드 · staging 주소')).toHaveAttribute('placeholder', '미설정')

    // 잘못된 주소는 저장 전에 막는다.
    await table.getByLabel('프론트 · staging 주소').fill('stg.app.com')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('.settings-callout')).toHaveText('프론트 · staging 주소는 http:// 또는 https://로 시작해야 합니다.')
    // 빈 칸은 미설정으로 저장한다.
    await table.getByLabel('프론트 · staging 주소').fill('')
    await page.getByRole('button', { name: '환경', exact: true }).click()
    await table.getByLabel('환경 이름').last().fill('prod')
    await table.getByLabel('프론트 · prod 주소').fill('https://app.com')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('.em-status')).toHaveText('저장했습니다')

    const saved = (await authCalls(page)).filter(([name]) => name === 'saveProjectSettings').at(-1)?.[1]
    expect(saved.environments.map((environment: { name: string; position: number }) => [environment.name, environment.position]))
      .toEqual([['dev', 0], ['staging', 1], ['prod', 2]])
    expect(saved.urls.map((url: { baseUrl: string; specUrl: string | null }) => [url.baseUrl, url.specUrl])).toEqual([
      ['https://dev.app.com', null],
      ['https://app.com', null],
      ['https://dev-api.app.com', 'https://dev-api.app.com/v3/api-docs'],
    ])

    // 두 번째 저장은 다른 팀원이 먼저 고쳐서 거절된다.
    await table.getByLabel('프론트 · dev 주소').fill('https://dev2.app.com')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('.settings-callout')).toContainText('다른 팀원이 먼저 수정했습니다. 새로 불러온 뒤 다시 저장하세요.')
    await page.getByRole('button', { name: '새로 불러오기' }).click()
    await expect(table.getByLabel('프론트 · dev 주소')).toHaveValue('https://teammate.app.com')
    await expect(page.locator('.settings-callout')).toHaveCount(0)
  })

  test('프로젝트 변경 모달: 경고를 보여주고 다른 프로젝트로 로그인한 뒤 다시 불러온다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner })
    await page.goto('/')
    await openSettings(page)
    await page.getByRole('button', { name: '프로젝트 변경' }).click()
    const dialog = page.getByRole('dialog', { name: '프로젝트 변경' })
    await expect(dialog.getByRole('radio', { name: /checkly-team/ })).toContainText('현재')
    await expect(dialog.getByRole('radio', { name: /partner-api/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('textbox', { name: '닉네임' })).toHaveValue('minsu_p')
    await expect(dialog).toContainText('실행 중인 시나리오는 중단되고, 저장하지 않은 편집 내용은 사라집니다.')
    await dialog.getByRole('button', { name: '전환' }).click()
    await expect(dialog.getByRole('alert')).toContainText('닉네임과 비밀번호를 입력하세요.')
    await dialog.getByLabel(/비밀번호/).fill('secret1')
    await dialog.getByRole('button', { name: '전환' }).click()

    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('auth-loads'))).toBe('2')
    await expect(dock(page)).toBeVisible()
    await openSettings(page)
    await expect(page.getByRole('region', { name: '계정' }).locator('.account-code')).toHaveText('partner-api')
  })

  test('프로젝트 변경 모달의 초대코드로 가입은 앱 위에 가입 화면을 띄우고, 뒤로 가면 설정으로 돌아온다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner })
    await page.goto('/')
    await openSettings(page)
    await page.getByRole('button', { name: '프로젝트 변경' }).click()
    await page.getByRole('button', { name: '초대코드로 가입' }).click()
    const overlay = page.getByRole('dialog', { name: '초대코드로 가입' })
    await expect(overlay.getByRole('heading', { name: '초대코드 입력' })).toBeVisible()
    await overlay.getByRole('button', { name: '설정으로 돌아가기' }).click()
    await expect(overlay).toHaveCount(0)
    await expect(page.getByRole('region', { name: '계정' })).toBeVisible()
  })

  test('프로필: 닉네임 변경은 계정 카드에 바로 반영되고, 비밀번호 변경 실패는 main의 문장을 보여준다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner })
    await page.goto('/')
    await openSettings(page)
    const profile = page.locator('[aria-label="프로필"]')
    await profile.getByLabel('새 닉네임').fill('Minsu')
    await profile.getByRole('button', { name: '변경' }).first().click()
    await expect(profile.getByRole('alert')).toContainText('영문 소문자로 시작')
    await profile.getByLabel('새 닉네임').fill('minsu_k')
    await profile.getByRole('button', { name: '변경' }).first().click()
    await expect(profile.getByRole('status')).toContainText('닉네임을 바꿨습니다.')
    await expect(page.getByRole('region', { name: '계정' }).locator('.account-nick')).toHaveText('minsu_k')

    await profile.getByLabel('현재 비밀번호').fill('wrong1')
    await profile.getByLabel('새 비밀번호', { exact: true }).fill('newpass')
    await profile.getByLabel('새 비밀번호 확인').fill('newpass')
    await profile.getByRole('button', { name: '변경' }).last().click()
    await expect(profile.getByRole('alert')).toHaveText(/현재 비밀번호가 올바르지 않습니다./)
    await profile.getByLabel('현재 비밀번호').fill('secret1')
    await profile.getByRole('button', { name: '변경' }).last().click()
    await expect(profile.getByRole('status').filter({ hasText: '비밀번호를 바꿨습니다.' })).toBeVisible()
    expect((await authCalls(page)).find(([name]) => name === 'changePassword')?.[1]).toEqual({ currentPassword: 'wrong1', newPassword: 'newpass' })
  })

  test('로그아웃하면 로그인 화면으로 돌아간다', async ({ page }) => {
    await installAuthStub(page, { enabled: true, session: owner })
    await page.goto('/')
    await openSettings(page)
    await page.getByRole('button', { name: '로그아웃' }).click()
    await expect(loginForm(page)).toBeVisible()
    await expect(dock(page)).toHaveCount(0)
  })
})
