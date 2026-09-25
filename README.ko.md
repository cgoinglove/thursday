<div align="center">

<a href="https://youtu.be/7XmsAtwQGjo">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/hero-dark.png">
    <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/hero-light.png" alt="Thursday — GPT-Live 1 위에서 도는 오픈소스 음성 비서와 AI 봇 팀. 하나는 페이지를 끝냈고, 하나는 웹을 뒤지는 중이다" width="880">
  </picture>
</a>

**GPT-Live 1 위에서 도는 오픈소스 음성 비서. 뒤에는 AI 봇 팀이 있습니다.**<br>
내 컴퓨터에서, 내 OpenAI 키로 돕니다. 나는 말하고, 오래 걸리는 일은 봇들이 진짜 브라우저와 셸과 내 파일로 처리합니다.

[![npm](https://img.shields.io/npm/v/thursday-agent?style=flat-square&color=111&label=npm)](https://www.npmjs.com/package/thursday-agent)
[![CI](https://img.shields.io/github/actions/workflow/status/cgoinglove/thursday/ci.yml?style=flat-square&label=ci)](https://github.com/cgoinglove/thursday/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/thursday-agent?style=flat-square&color=111)](https://nodejs.org)
[![discord](https://img.shields.io/badge/discord-join-111?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/Qmysdh9Fy8)

[English](README.md) · [한국어](README.ko.md) · [▶ 영상 보기](https://youtu.be/7XmsAtwQGjo) · [실제 통화](https://youtu.be/V7fBDY3cYRU)

</div>

## 빠른 시작

```bash
npx thursday-agent
```

Node.js 22.18 이상과 OpenAI API 키 하나면 됩니다. 첫 화면에 키를 넣고, 함께할 봇을 고른 뒤 **얼굴을 누르면** 통화가 시작됩니다. 가입도 `.env` 도 없습니다. 통화는 그 키로 1분에 약 $0.05 입니다. 한국어로 말하면 한국어로 답합니다(화면은 아직 영어입니다).

## 이렇게 시켜 보세요

- “20만 원 아래로 코트 좀 찾아서 한 페이지에 정리해 줘.”
- “평일 아침 아홉 시마다 메일 훑고 답장 초안 잡아 줘.”
- “누나 생일 3월 3일인 거 기억해 둬.”
- 일이 도는 중에 “아까 코트 건 어디까지 됐어?”

### 시켜 놓고, 계속 말하세요

음성 모델이 직접 브라우저를 열면 1분쯤 말이 없어지고, 조용한 통화는 끊긴 통화나 다름없습니다. 그래서 몇 초 넘게 걸리는 일은 봇에게 넘기고 통화는 이어집니다. 말을 끊어도 되고, 딴 얘기를 해도 되고, 시킨 일이 어디까지 됐는지 물어봐도 됩니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/talk-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/talk-light.png" alt="통화 중 — 봇이 맡았고 돌아오면 알려 주겠다고 말한다. 그 아래로 일이 넘어가고 웹 검색이 시작된다" width="880">
</picture>

### 한마디면 팀이 움직입니다

봇들은 일을 나눠 맡고, 서로의 결과를 확인하고, 내가 정해야 할 때만 묻습니다. 주고받은 것은 전부 스레드에 남습니다. 누가 뭘 했는지 열어 보고, 중간에 끼어들 수도 있습니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/team-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/team-light.png" alt="봇 둘의 스레드 — 하나가 일을 넘기고, 다른 하나가 비교한 것을 보고하고, 질문 하나가 나를 기다린다" width="880">
</picture>

### 심부름은 진짜 브라우저로

주문, 예약, 신청서, 메일함. 봇은 전용 브라우저나 내가 이미 로그인해 둔 Chrome 을 씁니다. 결제는 마지막 버튼 앞에서 멈추고, 그 화면은 내가 누르라고 열린 채로 남습니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/errands-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/errands-light.png" alt="봇이 몰던 브라우저의 결제 화면 — 다 채워 두고 결제 버튼 앞에서 멈춰 열린 채로 남았다" width="880">
</picture>

### 결과는 파일로 남습니다

페이지, 차트, 영상, 슬라이드, 문서, 스크립트. 전부 내 컴퓨터에 파일로 저장되고, 다 되면 화면 구석에 올라옵니다. “보여 줘” 하면 열립니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/results-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/results-light.png" alt="봇이 만든 페이지와, 그 옆에 저장된 파일 이름" width="880">
</picture>

## 이런 것도 됩니다

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/more-dark.png">
  <img src="https://raw.githubusercontent.com/cgoinglove/thursday/main/docs/images/more-light.png" alt="내 봇 팀 — 첫 실행에서 고르거나 직접 만들고, 봇마다 다른 모델로. 폰에서 — 텔레그램·디스코드·슬랙으로 말 걸기. 루틴 — 평일 아침 아홉 시, 봇 하나와 일 하나와 시각 하나. 읽을 수 있는 메모리 — 열고 고치고 지울 수 있는 평범한 메모" width="880">
</picture>

## 어떻게 돌아가나

Thursday 는 내 컴퓨터에서 도는 오픈소스 음성 비서입니다. 통화는 OpenAI 의 GPT-Live 1 이 붙들고, 도구는 Responses 모델이 씁니다. 몇 초 넘게 걸리는 일은 뒤에서 도는 봇에게 갑니다 — OpenAI·Anthropic·Google·xAI 의 텍스트 모델에 셸, 진짜 브라우저, 내 파일, Agent Skills, MCP 서버가 붙은 것입니다. 봇들은 일을 나눠 맡고 내가 정해야 할 때 묻습니다. 그 결과와 질문은 통화 안으로 돌아오고, 전화를 끊어도 일은 계속 돕니다. 루틴은 정해진 시각에 일을 시작합니다. 그녀가 나에 대해 아는 것은 내가 읽을 수 있는 평범한 메모입니다. 말 대신 글로 시켜도 되고, 앱에서도 텔레그램·디스코드·슬랙에서도 됩니다. [자세히 →](docs/how-it-works.md)

## 돌리기 전에 알아 둘 것

- **모델은 로컬이 아닙니다.** 앱과 데이터와 키는 내 컴퓨터에 있지만, 통화 음성은 OpenAI 로 가고 봇은 내가 넣은 프로바이더로 갑니다. 로컬 엔드포인트는 [열린 이슈](https://github.com/cgoinglove/thursday/issues/16)입니다.
- **샌드박스가 아닙니다.** 봇은 내 계정으로 진짜 명령을 실행합니다. 결제 앞에서 멈추는 것과 로그인 전에 묻는 것은 모델이 따르는 지시이지 잠금장치가 아닙니다. 민감한 것을 맡기기 전에 [SECURITY.md](SECURITY.md) 를 읽어 주세요.
- **macOS 에서 만들었습니다.** Linux 는 될 것 같지만 확인하지 못했고, Windows 는 아직입니다. 화면은 영어지만 말은 내 언어로 합니다.

<details>
<summary><b>돈은 얼마나 드나요?</b></summary>

Thursday 자체는 무료이고 MIT 입니다. 키는 내가 넣습니다. 통화는 OpenAI 가 1분에 약 $0.05 로 매기고(말이 없는 시간도 포함, [요금표](https://developers.openai.com/api/docs/pricing)), 봇은 내가 고른 프로바이더에 토큰만큼 붙습니다.

</details>

<details>
<summary><b>내 데이터는 어디로 가나요?</b></summary>

통화에서 한 말과 봇이 다루는 것은 내가 설정한 모델 프로바이더와 내가 연결한 서비스로 갑니다. “hey thursday” 호출어는 켜기 전까지 꺼져 있습니다 — 브라우저의 음성 인식을 쓰는데, Chrome 에서는 탭이 열려 있는 동안 마이크 소리가 Google 로 갑니다. 얼굴을 누르면 호출어 없이 통화가 시작됩니다. 앱은 `127.0.0.1` 에서 듣고, 통화·메모리·파일은 `~/.thursday` 에 있습니다(소스로 돌리면 그 폴더에).

</details>

<details>
<summary><b>소스로 돌리기</b></summary>

```bash
git clone https://github.com/cgoinglove/thursday.git
cd thursday
pnpm install
pnpm dev
```

pnpm 10 이상이 필요합니다.

</details>

<div align="center">

<br>

다들 프라이데이를 원했죠. 이건 서즈데이입니다.

**[어떻게 돌아가나](docs/how-it-works.md)** · [기여하기](CONTRIBUTING.md) · [보안](SECURITY.md) · [MIT](LICENSE)

돌려 보셨나요? [막힌 곳을 알려 주세요](https://github.com/cgoinglove/thursday/issues/new). 그 목록이 곧 로드맵입니다.<br>
궁금한 게 있으면 [Discord에서 물어보세요](https://discord.gg/Qmysdh9Fy8).

</div>
