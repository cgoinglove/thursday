<div align="center">

<img src="docs/images/hero.png" alt="Thursday — 이모지 얼굴을 가진 오픈소스 음성 에이전트" width="760">

### 다들 프라이데이를 원했다. 이건 서스데이다.

컴퓨터에게 말로 시키세요. 봇들이 일하는 동안 Thursday가 대화를 이어갑니다.<br>
[OpenClaw](https://github.com/openclaw/openclaw), [Hermes](https://github.com/NousResearch/hermes-agent) 같은 오픈소스 에이전트를 목소리 중심으로, 내 컴퓨터에서.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![stars](https://img.shields.io/github/stars/cgoinglove/thursday?style=flat-square&color=111)](https://github.com/cgoinglove/thursday/stargazers)

[English](README.md) · [한국어](README.ko.md)

</div>

## 빠른 시작

```bash
npx thursday-agent
```

OpenAI API 키를 넣고, 처음 쓸 봇을 고르고, **“hey thursday”**라고 말하세요.

![봇이 일하는 동안에도 통화는 계속됩니다](docs/images/two-minds.png)

## 기능

- **그냥 말하면 됩니다.** 중간에 끼어들 수 있는 실시간 음성 통화. “hey thursday”나 단축키로 시작합니다.
- **느린 일은 봇이.** 몇 초 넘게 걸리는 일은 봇이 백그라운드에서 맡고, 대화는 그대로 이어집니다.
- **진짜 내 컴퓨터.** 봇은 셸, 내 파일, 실제 브라우저를 씁니다. 이미 로그인된 Chrome도요. 결제는 Pay 버튼 앞에서 멈추고 나에게 넘깁니다.
- **바로 열어보는 결과물.** 페이지, 문서, 차트, 이미지, 오디오, 영상이 파일로 남고 화면에 열립니다.
- **전화를 끊어도 계속.** 작업은 내 컴퓨터에서 돌고, 끝나면 Thursday가 알려줍니다.
- **내가 꾸리는 팀.** 이름과 한 문장이면 봇 하나. 봇끼리 일을 나누고, 내가 정할 일은 나에게 묻습니다.
- **읽을 수 있는 기억.** Thursday가 나에 대해 아는 건 평범한 노트입니다. 어느 줄이든 열고, 고치고, 지울 수 있습니다.
- **스킬과 MCP.** Agent Skills를 더하고 MCP 서버를 연결합니다.
- **모델은 자유롭게.** OpenAI, Anthropic, Google, xAI, Vercel AI Gateway, ChatGPT 로그인. 봇마다 다른 모델을 쓸 수 있습니다.
- **로컬 우선.** Thursday 계정이 없습니다. 앱, 데이터, 키가 모두 내 컴퓨터에 있습니다.

## 필요한 것

- Node.js 22.18+
- 음성용 OpenAI API 키
- macOS. Linux도 될 것이고, Windows는 아직 테스트하지 않았습니다.

> [!NOTE]
> 봇은 내 컴퓨터에서 실제 명령을 실행합니다. Thursday는 샌드박스가 아닙니다. 민감한 곳에 접근하게 하기 전에 [SECURITY.md](SECURITY.md)를 읽어주세요.

<details>
<summary><b>소스에서 실행</b></summary>

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev
```

pnpm 10+ 이 필요합니다.

</details>

<div align="center">

<br>

**[작동 방식](docs/how-it-works.md)** · [기여하기](CONTRIBUTING.md) · [보안](SECURITY.md) · [MIT](LICENSE)

일하는 동안 말을 걸 수 있는 비서가 마음에 든다면 [Thursday에 별을](https://github.com/cgoinglove/thursday) 눌러주세요.

</div>
