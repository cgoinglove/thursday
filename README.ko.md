<div align="center">

!![design: 브랜드 캔버스의 `Hero · social card` 아트보드를 1200×630(라이트)으로 내보내 `docs/images/hero.png` 로. GitHub social preview 에도 같은 이미지.]

# Thursday

**내 컴퓨터에서 도는 음성 에이전트.**
말로 시키면, 느린 일은 셸·브라우저·스킬을 가진 봇들에게 넘긴다.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoing/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoing/thursday/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.18-111?style=flat-square)](package.json)

[English](README.md) · [한국어](README.ko.md)

</div>

!![video: 60초 데모, 1440×900, 라이트 테마, 브라우저 크롬 없이. 통화 하나를 처음부터 끝까지: "Hey Thursday" → "다음 주 교토 가는데 20만원 아래 코트 찾아서 한 페이지로 정리해줘" → "네, Navigator 가 보러 갔어요" → 다른 얘기를 계속하는 동안 통화 아래 작업 줄이 생기고 → 페이지가 저절로 열리고 → "돌아왔어요". "네, 보러 갔어요"부터 페이지가 열리기까지 12초를 GIF 로 잘라 `docs/images/demo.gif` 로; 전체는 YouTube 에 올려 여기 링크.]

대부분의 에이전트는 텍스트 박스다. Thursday 는 통화다. 하고 싶은 걸 내 말로 하고, 계속 이야기한다. 일은 대화 뒤에서, 내 컴퓨터에서 일어나고, 전화를 끊어도 멈추지 않는다.

한 통화에 두 종류의 머리가 있다. 실시간 음성 모델이 대화를 잡고, 한눈에 답할 수 있는 것만 만진다 — 나에 대해 기억하는 것, 파일 하나. 그보다 오래 걸리는 모든 것 — 브라우저, 셸, 연결된 서비스, 몇 분짜리 작업 — 은 텍스트 모델 봇에게 간다. 봇은 뒤에서 돌고, 끝나면 한 문장으로 돌아와 그녀가 소리 내어 말해준다.

## 설치

```bash
npx thursday-agent
```

`http://localhost:3000` 에서 열린다. 통화를 여는 데 키 하나면 된다 — OpenAI 또는 xAI 키를 첫 화면에 입력. `.env` 는 없고, 나머지는 전부 앱 안에서 정한다. 데이터는 `~/.thursday` 에 산다.

<details>
<summary>소스에서</summary>

```bash
git clone https://github.com/cgoing/thursday.git
cd thursday
pnpm install
pnpm dev
```

Node 22.18+, pnpm 10+. 첫 실행 때 봇이 쓸 브라우저(~280 MB)를 백그라운드에서 받는다.

</details>

macOS 에서 만들었다. Linux 는 될 것이고, Windows 는 확인하지 않았다.

## 이렇게 말해보세요

첫 1분, 순서대로. 각각이 다른 부분을 보여준다.

| 말 | 일어나는 일 |
|---|---|
| "Hey Thursday." | 통화가 열린다. 첫 통화에서는 뭐라고 부를지 묻고, 기억한다. |
| "이번 주에 다운로드 폴더에 뭐 받았지?" | 명령 하나, 말하는 사이에 끝난다 — 셸은 그녀가 직접 쓰는 것이지 넘기는 일이 아니다. |
| "우리 언니 생일 3월 3일인 거 기억해." | 그 자리에서 저장된다. 다음 주에 물어보면 된다. |
| "다음 주 교토 가는데 20만원 아래 코트 찾아서 한 페이지로 정리해줘." | **Navigator** 가 진짜 브라우저로 쇼핑몰을 열고 페이지를 만든다. 그녀는 계속 이야기한다. 끝나면 페이지가 화면에 저절로 열린다. |
| "집주인한테서 온 메일 있는지 봐줘." | 봇이 이미 로그인돼 있는 내 브라우저에 붙는다. 설정할 게 없다. |
| "내 봇들이 쓸 구글 계정 하나 만들어줘." | **Jarvis** 가 보이는 창에서 폼을 채우고 비밀번호 앞에서 멈춘다 — 그건 내 몫. 그다음 이어서 한다. |
| "오늘 정한 거 한 장짜리 브리프로 써줘." | **Scribe** 가 무엇에 쓸 건지 묻고 쓴다 — 채팅 말풍선이 아니라 문서로 열린다. |
| "Crumb 이라는 빵집 로고 그려줘." | 스튜디오: 이미지·영상·음성·받아쓰기 모델을, 가진 키로. |

아무 때나 끊어도 된다. 작업은 나 없이 끝나고, 다음 통화에 말해준다 — 허락하면 먼저 전화를 걸기도 한다.

## 어떻게 돌아가나

!![design: 브랜드 캔버스의 `How it works` 아트보드를 1200×560 으로 내보내 `docs/images/how-it-works.png` 로]

- **통화는 실시간 음성 모델이다.** OpenAI Realtime 또는 xAI Grok Voice — 대화 전체를, 어떤 언어로든, 끼어들기까지. 그녀에게는 메모리, 파일 하나, 한 줄짜리 명령을 위한 셸이 있고, 통화를 조용하게 만들 만한 건 없다.
- **봇은 컴퓨터 전체를 가진 텍스트 모델이다.** 셸, 진짜 브라우저(Playwright), 파일시스템, 스킬, MCP 서버, 그리고 서로. 로그인이 필요하면 내 눈앞의 창에서 하고, 일을 끝까지 가져간다: 산 물건, 만든 계정, 지은 페이지.
- **작업은 통화보다 오래 산다.** 탭이 아니라 서버에서 돈다. 화면이 그리는 것과 그녀가 다시 읽는 것은 같은 행이다.
- **메모리는 노트 폴더고, 내 것이다.** 사실은 한 줄에 하나, 날짜는 날짜로, 내 디스크에. 답하기 전에 읽고, 뭔가 나오는 순간 적는다. 노트는 전부 열어볼 수 있다.

각 부분이 무엇을 만지고 무엇을 만지지 않는지, 긴 버전: [docs/how-it-works.md](docs/how-it-works.md)

## 같이 오는 것

!![design: 브랜드 캔버스의 `Seed bots` 아트보드를 1200×420 으로 내보내 `docs/images/bots.png` 로]

**봇 셋.** 주제가 아니라 성향으로 나눴다 — Jarvis 는 계획하고 남은 걸 다 하고, Navigator 는 가서 보고, Scribe 는 쓴다. 내 봇은 1분이면 만든다: 이름, 한 문장, 원하면 모델과 고정 툴 몇 개.

**스킬** — 봇이 시작 전에 읽는 방법서: [브라우저](skills/browser/SKILL.md), [이 Mac](skills/computer/SKILL.md), 그림이나 조작이 필요한 결과를 위한 [인터랙티브 페이지](skills/interactive-page/SKILL.md), 그리고 스킬을 늘리는 둘 — [스킬 찾기](skills/find-skills/SKILL.md), [스킬 만들기](skills/skill-creator/SKILL.md). 오픈 스킬 생태계의 무엇이든 `npx skills add` 로 설치된다.

**MCP 서버**, OAuth 포함. 설정에서 하나 연결하면 봇이 툴을 검색해서 부른다. 봇에 몇 개를 고정해두면 검색을 건너뛴다.

**스튜디오** — 이미지·영상·음성·받아쓰기 — 봇에게는 서버 하나로 보인다.

!![capture: 작업 도중의 통화 화면, 라이트 테마, 1440×900 — 가운데 Thursday 마크, 그 아래 캡션 한 줄, "Navigator is on it" 알약, 그 아래 툴 칩이 보이는 작업 줄. → `docs/images/call.png`]

!![capture: 끝난 작업 하나를 연 Tasks 화면 — 요청, 툴 줄 몇 개(bash, browser), 리포트, 아티팩트 링크가 보이는 스레드. 1440×900, 라이트. → `docs/images/task.png`]

## 모델

| | 제공자 |
|---|---|
| **음성** (통화) | OpenAI Realtime · xAI Grok Voice |
| **텍스트** (봇) | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway (실리는 모델 전부, 실시간 목록) |
| **스튜디오** | OpenAI · Google · xAI · Vercel AI Gateway |

시작은 키 하나로 충분하다: 음성 키는 텍스트 키이기도 하다. 설정에서 더 넣으면 봇마다 다른 모델로 돌릴 수 있다.

## 어디로 가나

**0.x** 는 이 웹 앱이다: 하네스를 더 — 더 나은 봇, 더 많은 스킬, 더 넓은 스튜디오 — 그리고 첫 사용자들이 말하는 모든 것.
**1.0** 은 데스크톱 앱이다: 같은 서버를 창 하나에, 마이크와 컴퓨터를 한 걸음 더 가까이.

그녀에게 뭐라고 말했고 어디서 멈췄는지를 이슈로 남겨주면 된다. 그게 로드맵이다.

## 보안

이 앱은 셸과 브라우저와 내 키를 가진 언어 모델이다. 그게 제품이다. 키는 내 컴퓨터에 남고 셸에는 닿지 않는다. 봇은 워크스페이스 안에만 쓴다. 서버는 localhost 에 묶인다. 비밀번호·일회용 코드·패스키는 내가 친다. 이게 무엇을 막고 무엇을 막지 않는지: [SECURITY.md](SECURITY.md)

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md) 는 어떻게 돌리고 어떤 PR 이 좋은 PR 인지. [CLAUDE.md](CLAUDE.md) 는 아키텍처 — 어떤 코드가 어디에 살고 왜 그런지.

## 라이선스

[MIT](LICENSE)
