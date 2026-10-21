// 팀 프로젝트·로그인(Supabase) IPC 계약. main(index.ts)·preload(bridge.ts)·renderer가 같이 쓰므로
// 타입만 둔다. 설계: docs/02-architecture/supabase-common.md

export type AuthRole = "owner" | "member";

/** Supabase 연결 설정이 없으면 enabled=false — 로그인 없이 기존 로컬 모드로 동작한다. */
export type AuthConfig = { enabled: boolean };

export type AuthSession = {
  userId: string;
  projectId: string;
  projectCode: string;
  nickname: string;
  role: AuthRole;
};

/** 이 기기에서 로그인했던 프로젝트(프로젝트 변경 모달 목록). 비밀번호는 저장하지 않는다. */
export type RecentProject = { projectCode: string; nickname: string; lastUsedAt: string };

/** 가입 2단계 "프로젝트 확인". */
export type InvitePreview = {
  projectCode: string;
  ownerNickname: string;
  memberCount: number;
  createdAt: string;
};

/** 비밀번호 찾기 1단계 "계정 확인". 재설정 코드는 관리자가 설정 > 멤버에서 발급한다. */
export type ResetAccount = { projectCode: string; nickname: string; ownerNickname: string };

/** 관리자가 발급한 재설정 코드(6자리 숫자). 30분 동안 한 번만 쓸 수 있다. */
export type IssuedResetCode = { code: string; expiresAt: string };

export type ProjectMember = {
  userId: string;
  nickname: string;
  role: AuthRole;
  createdAt: string;
};

export type ProjectInfo = {
  id: string;
  code: string;
  inviteCode: string;
  createdAt: string;
  members: ProjectMember[];
};

export type EndpointKind = "web" | "api";

/** `updatedAt`이 없으면 새 행. 있으면 읽었을 때의 값이며, 저장 시 DB 값과 다르면 충돌로 거절한다. */
export type ProjectEndpoint = { id: string; name: string; kind: EndpointKind; position: number; updatedAt?: string };
export type ProjectEnvironment = { id: string; name: string; position: number; updatedAt?: string };
export type ProjectEndpointUrl = {
  endpointId: string;
  environmentId: string;
  baseUrl: string;
  /** 스웨거 주소. kind = "api" 엔드포인트에서만 쓴다. */
  specUrl: string | null;
  updatedAt?: string;
};

/** 엔드포인트 × 환경 주소 표 전체. 저장은 이 전체를 보내고 main이 추가·수정·삭제를 계산한다. */
export type ProjectSettings = {
  endpoints: ProjectEndpoint[];
  environments: ProjectEnvironment[];
  urls: ProjectEndpointUrl[];
};

/**
 * 실패하면 reject하며 Error.message는 사용자에게 그대로 보여줄 한국어 문장이다.
 * 동시 수정 충돌은 "다른 팀원이 먼저 수정했습니다. 새로 불러온 뒤 다시 저장하세요."로 알린다.
 */
export type AuthBridge = {
  getConfig(): Promise<AuthConfig>;
  /** 저장된 세션을 복원한다. 없거나 만료되면 null. */
  getSession(): Promise<AuthSession | null>;
  /** 세션이 바뀌면(로그인·로그아웃·만료·닉네임 변경) 호출한다. 반환값은 구독 해제. */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void;

  signIn(input: { projectCode: string; nickname: string; password: string; remember: boolean }): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** 직접 하지 않은 로그아웃(관리자가 내보냄)의 이유. 없으면 "". 다시 로그인하면 지워진다. */
  getSignOutNotice(): Promise<string>;
  /** "기억하기"로 저장한 마지막 프로젝트 코드·닉네임. */
  getRemembered(): Promise<{ projectCode: string; nickname: string } | null>;
  listRecentProjects(): Promise<RecentProject[]>;

  previewInvite(inviteCode: string): Promise<InvitePreview | null>;
  isProjectCodeAvailable(code: string): Promise<boolean>;
  isNicknameAvailable(inviteCode: string, nickname: string): Promise<boolean>;
  /**
   * 프로젝트를 만들고 그 계정으로 로그인까지 한다. createCode는 운영자가 발급한 생성 코드이며,
   * 틀리거나 서버에서 생성이 꺼져 있으면 거절한다.
   */
  createProject(input: { code: string; nickname: string; password: string; createCode: string }): Promise<{ session: AuthSession; inviteCode: string }>;
  /** 초대코드로 가입하고 그 계정으로 로그인까지 한다. */
  joinProject(input: { inviteCode: string; nickname: string; password: string }): Promise<AuthSession>;

  /** 비밀번호 찾기(로그인 전). 없는 계정·관리자 계정이면 거절한다. */
  findResetAccount(input: { projectCode: string; nickname: string }): Promise<ResetAccount>;
  /** 재설정 코드가 맞는지만 확인한다(코드는 그대로 남는다). 틀리면 시도 횟수가 줄어든다. */
  verifyResetCode(input: { projectCode: string; nickname: string; code: string }): Promise<void>;
  /** 코드를 확인하고 새 비밀번호로 바꾼다. 성공하면 코드는 지워진다. 로그인은 하지 않는다. */
  resetPassword(input: { projectCode: string; nickname: string; code: string; password: string }): Promise<void>;

  getProject(): Promise<ProjectInfo>;
  /** 관리자만. */
  regenerateInviteCode(): Promise<string>;
  /** 관리자만. 관리자 자신은 내보낼 수 없다. */
  removeMember(userId: string): Promise<void>;
  /** 관리자만. 멤버의 비밀번호 재설정 코드를 새로 발급한다(이전 코드는 무효). */
  issueResetCode(userId: string): Promise<IssuedResetCode>;
  changeNickname(nickname: string): Promise<AuthSession>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;

  getProjectSettings(): Promise<ProjectSettings>;
  saveProjectSettings(settings: ProjectSettings): Promise<ProjectSettings>;
};
