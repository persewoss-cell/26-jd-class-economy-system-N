# 🏫 학급 경제 시스템 🪙 (v2)

Streamlit으로 만들었던 학급 경제 시스템을 **Vercel에서 동작하는 웹사이트**로 옮긴 버전입니다.
기존 MongoDB 데이터(학생, 거래내역, 적금, 투자, 복권 등)를 **그대로 이어서** 사용합니다.

- 화면: React (태블릿 가로 화면 기준 최적화)
- 서버: Vercel 서버리스 함수 1개 (`api/index.js`)
- DB: MongoDB (기존 컬렉션·필드 구조 그대로)

---

## 🚀 처음 한 번만 하는 설정 (Vercel 배포)

### 1) MongoDB Atlas 접속 허용
Vercel 서버는 접속 IP가 계속 바뀌기 때문에, Atlas에서 모든 IP 접속을 허용해야 합니다.
1. [MongoDB Atlas](https://cloud.mongodb.com) 로그인 → 왼쪽 메뉴 **Network Access**
2. **ADD IP ADDRESS** → **ALLOW ACCESS FROM ANYWHERE** (`0.0.0.0/0`) → Confirm
   (Streamlit Cloud에서 이미 이렇게 쓰고 있었다면 그대로 두면 됩니다.)

### 2) Vercel에 저장소 연결
1. [vercel.com](https://vercel.com) 에 **GitHub 계정으로 가입/로그인**
2. **Add New… → Project** → 이 저장소 선택 → **Import**
3. Framework Preset이 **Vite**로 잡혀 있는지 확인 (자동으로 잡힘)

### 3) 환경변수 입력 (Import 화면의 *Environment Variables* 또는 Settings → Environment Variables)

| 이름 | 값 |
|---|---|
| `MONGO_URI` | 기존 Streamlit `secrets.toml`의 `[mongodb] uri` 값 그대로 |
| `MONGO_DB_NAME` | 기존 `db_name` 값 (안 썼다면 `class_point_app`) |
| `ADMIN_PIN` | 지금 쓰는 관리자 비밀번호 |
| `SESSION_SECRET` | (선택) 아무 긴 문자열. 비워도 동작 |

> ⚠️ 이 값들은 **채팅이나 코드에 적지 말고** Vercel 설정 화면에만 입력하세요.
> 관리자 비밀번호가 더 이상 코드에 들어있지 않아서 학생이 브라우저에서 볼 수 없습니다.

4. **Deploy** 클릭 → 1~2분 후 `https://프로젝트이름.vercel.app` 주소가 생깁니다.

이후에는 GitHub에 코드가 올라갈 때마다 Vercel이 **자동으로 다시 배포**합니다.

---

## ⏰ 자동 처리 (적금 만기 · 월급 자동지급)
- 기존 앱처럼 **누군가 사이트에 접속할 때마다** 만기된 적금 지급과 월급 자동지급을 시도합니다.
- 추가로 Vercel 크론이 **매일 밤 0시 5분(한국시간)** 에 한 번 더 확인합니다. (아무도 접속하지 않은 날 대비)
- 같은 달에 두 번 지급되지 않도록 기존과 같은 잠금(`payroll_auto_run`, `payroll_log`)을 사용합니다.

---

## 🧑‍💻 직접 실행해 보기 (선택)
```bash
npm install
npx vercel dev      # http://localhost:3000 (환경변수는 .env.local 에)
```

## 📁 폴더 구조
```
api/index.js            서버 입구(모든 요청을 action 이름으로 나눠 처리)
server/                 서버 로직 (기존 app.py의 api_* 함수들)
  core.js               잔액/국고/신용/투자/월급 공통 계산
  actions/*.js          탭별 기능
shared/format.js        날짜·숫자 표기(한국시간) 공용
src/                    화면
  App.jsx               로그인 · 사이드바 · 메인 메뉴(탭) 구성
  tabs/*.jsx            탭 화면
  components/           버튼·입력칸·표 등 공용 부품
docs/기능목록.md         기존 app.py와 1:1 대응 기능 체크리스트
```
