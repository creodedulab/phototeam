# 포토팀빌딩

팀별 사진 미션을 진행하는 웹 애플리케이션입니다. `live.html`과 `live.js`가 실서비스 화면이며, GitHub 배포 시 `live.html`을 `index.html`로 배치합니다. 기존 `index.html`은 브라우저 저장소만 사용하는 구 프로토타입입니다.

## 구성
- Vercel: 정적 웹 화면과 GitHub 연동 배포.
- Supabase Edge Function `phototeam`: 참가자·관리자 요청과 인증 처리.
- Supabase Postgres: 방, 주제, 팀, 제출물, 관리자 인증 상태. 일반 클라이언트에 테이블 직접 권한을 부여하지 않습니다.
- Supabase Storage의 비공개 `mission-photos`: 사진. 권한 확인 후 서명된 링크를 발급합니다.
- 팀은 6자리 입장 코드, 팀 이름, 비밀번호로 입장하며 새 팀은 비밀번호를 확인합니다. 팀 비밀번호는 해시로 저장되고, 관리자가 재설정하면 기존 기기 세션은 해제됩니다. 방 상태는 약 2초 간격으로 서버에서 동기화합니다. 남은 시간은 서버 시간과 종료 시각을 기준으로 표시하고, 저장 마감은 데이터베이스에서 다시 확인합니다.

## 운영
관리자는 방 진행 현황에서 팀별 사진·팀을 삭제하거나 팀 비밀번호를 재설정할 수 있습니다. 사진 삭제 시 해당 미션의 제목과 설명, 한마디도 함께 삭제됩니다. 비밀번호 재설정 시 팀의 기존 접속은 해제되며 제출물은 유지됩니다.

방별 미션은 1~10개를 선택할 수 있습니다. 방 개설 후에도 제출물이 없는 미션을 변경하거나 삭제할 수 있습니다. 제출된 미션은 사진과의 연결을 보호하기 위해 변경할 수 없습니다. 타이머가 0이 되어도 관리자가 `미션종료`를 누르기 전에는 시간을 추가하여 제출을 재개할 수 있습니다. 갤러리는 수동 종료 후 열리며, 기능 변경 이전에 시간이 끝나 이미 갤러리를 볼 수 있었던 방도 계속 열 수 있습니다.

관리자 비밀번호는 코드와 Git 저장소에 저장하지 않습니다. 초기 비밀번호는 생성 시 별도 로컬 `admin-access.txt`에 기록됩니다. 이 파일은 Git에 포함하지 마세요. 브라우저별로 기존 프로토타입에 저장한 데이터는 자동 이전되지 않습니다.

스키마 및 변경 이력은 `supabase/migrations/`, 주제 초기 목록은 `supabase/seed.sql`입니다. Edge Function 코드는 `supabase/functions/phototeam/`에 있습니다. 기존 프로젝트에 초기 목록을 다시 적용하면 중복될 수 있으므로 주의하세요.

## 검증
Node.js 24 이상에서 다음 검사를 실행합니다.

```
node tests/client.test.mjs
node tests/security.test.mjs
node tests/api.test.mjs
node tests/submission.test.mjs
node tests/team_auth.test.mjs
node tests/admin_actions.test.mjs
node tests/history.test.mjs
node tests/features.test.mjs
```

배포 전 PC 브라우저, 아이폰 Safari, 안드로이드 Chrome에서 사진 선택과 촬영·업로드, 마감, 결과 발표와 다운로드를 실제로 확인해야 합니다. 실제 데이터 보존 기간과 이용량은 Supabase 프로젝트의 플랜과 운영 상태에 좌우되므로 정기 백업과 용량 점검이 필요합니다.

