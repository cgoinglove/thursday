<div align="center">

<img src="docs/images/hero.png" alt="Thursday — 이모지 얼굴을 가진 오픈소스 음성 에이전트" width="760">

### 다들 프라이데이를 원했다. 이건 서스데이다.

**아이언맨에서 부러웠던 그 비서. 이제 내 컴퓨터에.**

찾아달라고, 만들어달라고, 일을 맡아달라고 말해보세요. Thursday와 이야기를 나누는 동안 에이전트들이 일을 합니다.

[OpenClaw](https://github.com/openclaw/openclaw), [Hermes](https://github.com/NousResearch/hermes-agent)처럼 나만의 AI 비서를 만드는 오픈소스 에이전트 하네스. Thursday는 실시간 음성 대화를 중심으로, 내 컴퓨터에서 돌아갑니다.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![stars](https://img.shields.io/github/stars/cgoinglove/thursday?style=flat-square&color=111)](https://github.com/cgoinglove/thursday/stargazers)

[English](README.md) · [한국어](README.ko.md)

</div>

```bash
npx thursday-agent
```

첫 화면에 OpenAI 또는 xAI 키 하나를 넣고 **“hey thursday”**라고 말하세요. Thursday 계정도 `.env` 파일도 필요 없습니다.

<br>

## “서스데이, 다음 주 여행 준비 좀 같이 하자.”

떠오른 생각부터 말해보세요. 이야기를 나누며 구체적으로 만들어가면 됩니다.

> **“교토에서 조용하고 1박 20만 원 아래인 숙소 세 곳 찾아줘. 좋은 선택지만 한 페이지에 정리해줘.”**

봇이 찾는 동안에도 말은 이어집니다. “아, 아침 먹으러 걸어갈 수 있는 곳이면 좋겠다. 옷은 뭘 챙겨야 할까?” Thursday와 대화하는 사이 봇들은 브라우저로 찾고, 비교하고, 페이지를 만듭니다. 준비되면 목소리로 알려주고 결과를 화면에 엽니다.

![봇이 백그라운드에서 일하는 동안 계속되는 하나의 음성 대화](docs/images/two-minds.png)

생각을 말하면 비서가 답하고, 그 사이 일이 진행되는 것. 영화 속 Friday에게 기대했던 바로 그 경험입니다.

<br>

## 한 문장이면, 봇 셋이 알아서 나눠 맡습니다.

Thursday는 요청을 에이전트 하나에게 던져두지 않습니다. 봇들이 서로 이야기하며 일을 나눕니다.

![Jarvis가 일을 나누고, Navigator가 쇼핑몰 여섯 곳을 읽고, Scribe가 페이지를 만든 방 — 아무도 타이핑하지 않았다](docs/images/task-thread.png)

여행에 입을 코트를 한 페이지로 모아달라고 해보세요. **Jarvis**가 일을 받아 두 조각 모두 자기 몫이 아니라고 판단합니다. **Navigator**가 실제 브라우저로 쇼핑몰 여섯 곳을 열어 가격, 링크, 사진을 가져오고, **Scribe**가 그걸로 페이지를 만듭니다. Jarvis가 조각이 잘 맞는지 확인해 Thursday에게 넘기면, 나는 한 문장으로 듣습니다.

주고받은 말은 전부 남습니다. 누가 무엇을 했는지 궁금하면 방을 열어 읽고, 더 시킬 게 있으면 그 자리에 적으면 멈춘 곳에서 이어갑니다.

<br>

## 입 밖으로 꺼낼 만한 말

| 이렇게 말하면 | 이렇게 됩니다 |
|---|---|
| **“이번 주에 뭐 받았지?”** | Thursday가 짧은 명령 하나를 실행하고 통화에서 답합니다. |
| **“14일 오사카 가는 제일 싼 비행기 찾아줘.”** | 봇이 실제 브라우저로 찾고 쓸 만한 페이지를 열어둡니다. |
| **“오늘 정한 걸 한 장짜리 문서로 만들어줘.”** | 봇이 파일을 쓰고 완성된 결과물을 엽니다. |
| **“부산으로 이사한 거 기억해.”** | 직접 읽고 고치고 지울 수 있는 메모리에 저장됩니다. |
| **“교토 3일 일정 짜줘. 날마다 지도도 넣어줘.”** | 여러 봇이 조사하고 시각적인 여행 일정을 만듭니다. |
| **“집주인에게서 온 이메일 있어?”** | 봇이 내가 선택해 연결한 브라우저 세션을 확인하고 답을 가져옵니다. |

<br>

## 나에게 맞는 비서로 만드세요

- **찾아보는 동안에도 계속 이야기하세요.** 느린 일은 봇이 맡습니다. Thursday의 말을 끊거나, 주제를 바꾸거나, 다음 아이디어를 함께 생각할 수 있습니다.
- **내 컴퓨터에 일을 맡기세요.** 봇이 셸, 파일, 실제 브라우저를 씁니다. 원하는 Chrome 세션을 연결하면 평소 쓰던 서비스에서도 일할 수 있습니다.
- **바로 쓸 수 있는 결과를 받으세요.** 완성된 페이지, 문서, 이미지, 오디오와 비디오를 열어보세요. 파일로 보관하고 다음 작업에 이어 쓸 수 있습니다.
- **다음에는 덜 설명하세요.** 취향은 메모리에, 반복하는 일의 방식은 Agent Skill에 남깁니다. Thursday가 기억하는 내용은 직접 읽고 고치고 지울 수 있습니다.
- **내 도구와 모델을 가져오세요.** MCP 서버를 연결하고, 모델을 고르고, 각자 역할과 도구와 기억을 가진 봇을 만드세요.
- **할 말을 마쳤으면 통화를 끊으세요.** 앱을 열어두면 작업은 계속됩니다. 앱까지 닫으면 멈췄다가 돌아왔을 때 이어갑니다.

Thursday에는 계획하는 Jarvis, 브라우저를 쓰는 Navigator, 글을 쓰는 Scribe가 기본으로 들어 있습니다. 이름 하나와 무엇을 위한 봇인지 한 문장이면 내 봇도 만들 수 있고, 실제 결정이 필요할 때는 봇이 나에게 묻습니다.

<br>

## 정확한 의미의 로컬 퍼스트

앱, 데이터베이스, 워크스페이스, 키, 메모리와 브라우저 세션은 내 컴퓨터에 있습니다. 서버는 `127.0.0.1`에만 열리고 Thursday 계정이나 호스팅된 제어 서버는 없습니다.

통화와 에이전트 작업에는 내가 설정한 모델 제공자가 사용됩니다. 연결한 서비스에는 내가 그 서비스를 통해 보내기로 한 요청이 전달됩니다. Thursday는 실제 셸을 가진 강력한 로컬 에이전트이며 보안 샌드박스가 아닙니다. 민감한 접근 권한을 주기 전에 [SECURITY.md](SECURITY.md)를 읽어주세요.

<br>

## 설치

```bash
npx thursday-agent
```

Node 22.18+가 필요합니다. `localhost:3000` 또는 다음 빈 포트에서 열립니다. 첫 실행 때 봇이 사용하는 Chromium 브라우저를 백그라운드에서 한 번 내려받습니다. macOS에서 만들었고 Linux도 작동할 것으로 보이며 Windows는 아직 확인하지 않았습니다.

```text
~/.thursday
├── local.db          통화, 메모리, 봇, 작업, 키
└── .ai-workspace
    ├── artifacts/    완성된 결과물
    ├── projects/     코드와 오래 유지되는 프로젝트
    ├── bots/         봇마다 자기 메모리와 저장된 세션
    └── .agents/      설치한 스킬
```

<details>
<summary><b>모델과 제공자</b></summary>

| | 제공자 |
|---|---|
| **음성** | OpenAI Realtime · xAI Grok Voice |
| **봇** | OpenAI · Anthropic · Google · xAI · Vercel AI Gateway · ChatGPT 로그인 |
| **스튜디오** | OpenAI · Google · xAI · Vercel AI Gateway |

봇마다 다른 모델을 사용할 수 있습니다.

</details>

<details>
<summary><b>소스에서 실행</b></summary>

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev
```

pnpm 10+가 필요합니다.

</details>

<br>

## 나만의 Friday는 “hey thursday”로 시작합니다.

아이언맨 슈트까지는 필요 없습니다. 직접 하기보다 말로 맡기고 싶었던 일 하나부터 시작해보세요.

프로젝트는 활발히 개발 중인 `0.x` 버전입니다. 무엇을 부탁했고 어디에서 멈췄는지 알려주세요. 그게 로드맵입니다.

<div align="center">

**일하는 동안에도 대화할 수 있는 에이전트를 원한다면 [Thursday에 별을 눌러주세요](https://github.com/cgoinglove/thursday).**

[어떻게 돌아가나](docs/how-it-works.md) · [기여](CONTRIBUTING.md) · [아키텍처](AGENTS.md) · [MIT](LICENSE)

</div>
