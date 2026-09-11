# Changelog

## [0.5.0](https://github.com/cgoinglove/thursday/compare/thursday-agent-v0.4.0...thursday-agent-v0.5.0) (2026-09-11)


### Features

* introduce AGENTS.md for Thursday voice agent documentation and update various files ([3dbb6fb](https://github.com/cgoinglove/thursday/commit/3dbb6fbcbcfc753f744e9398d193ab929f1ec0ec))

## [0.4.0](https://github.com/cgoinglove/thursday/compare/thursday-agent-v0.3.0...thursday-agent-v0.4.0) (2026-09-11)


### Features

* say who is who in every prompt, and who said what to a job ([d1a3ef8](https://github.com/cgoinglove/thursday/commit/d1a3ef8becf97c91cf81a33c20b345858d0c7c90))


### Fixes

* draw an app stop in the bot room as a stop, not a compaction ([4d7a9e4](https://github.com/cgoinglove/thursday/commit/4d7a9e4d3b714c7f460d5ad210153a8610d4d6ad))
* keep the dev server on this machine, as the CLI already does ([99e89df](https://github.com/cgoinglove/thursday/commit/99e89dfdbb001d5da45be229d834cfd3bef4f050))
* listen for the ChatGPT sign-in on both loopbacks ([bed977c](https://github.com/cgoinglove/thursday/commit/bed977c093795038e5d965fc6bb7fddba33e1d7f))
* say why an old database can't boot, instead of a raw SQLITE_ERROR ([7b31b15](https://github.com/cgoinglove/thursday/commit/7b31b151a66b9ef8cdf06371ca78e1ba2dab59d5))
* start on a port nothing holds on any address, in dev as well as the CLI ([1248102](https://github.com/cgoinglove/thursday/commit/12481029def17add255d6d6584d10874ecfe7c6b))


### Docs

* lead with the emoji face, and say what bots do now ([13347ad](https://github.com/cgoinglove/thursday/commit/13347adb7a51ed63e54ed9e25375c0c02ad1d1e7))
* redraw the three README artboards for the emoji face ([57eba59](https://github.com/cgoinglove/thursday/commit/57eba59873d0c0bb51810bbd4baa1ae307340328))

## [0.3.0](https://github.com/cgoinglove/thursday/compare/thursday-agent-v0.2.0...thursday-agent-v0.3.0) (2026-09-11)


### Features

* a bot can be switched off ([e4175f4](https://github.com/cgoinglove/thursday/commit/e4175f40f32fdaa16a12178352798bf5532eeb0d))
* a bot can leave a browser open to show you, and only the hidden one closes ([368f5b5](https://github.com/cgoinglove/thursday/commit/368f5b514c449a53bfd5ac906d7bdd61cb7c7dd6))
* a centred bot face, a tab that shows what waits on you, and shine that reads on light ([108ff2d](https://github.com/cgoinglove/thursday/commit/108ff2dc3cb04903eb6d40490d5a1aa47473ef40))
* a fact opens the conversation it was said in, and nothing reads calls back ([e876132](https://github.com/cgoinglove/thursday/commit/e87613283537973fb6affcdff8c1c440db69211d))
* bot runs pick themselves back up after a restart, a closed browser or a model that goes quiet ([0875907](https://github.com/cgoinglove/thursday/commit/0875907e5d025e693bcb6576e57d6b0ba521e19a))
* bots keep their own memory as files, not one rewritten note ([7adba40](https://github.com/cgoinglove/thursday/commit/7adba4037992b176305b2b51cc6a5d938ae13d59))
* bots read the user's memory and no longer write to it ([b4cfc4d](https://github.com/cgoinglove/thursday/commit/b4cfc4de9292c64b77e90d217da1ea8af3289462))
* clear what jobs leave behind after three days ([4c47663](https://github.com/cgoinglove/thursday/commit/4c47663e6c4a6f5aca8078d11ed7dd4eb9a5cdb8))
* edit memory from its own screen, one change at a time ([c8d9fb9](https://github.com/cgoinglove/thursday/commit/c8d9fb990313b8c46a18123f5c5f2926056984d0))
* enhance documentation and configuration for thursday skill ([7382b4f](https://github.com/cgoinglove/thursday/commit/7382b4f3d86cf5b0d6f4272adc52c00d148a0b91))
* implement ChatGPT sign-in functionality and related configurations ([d8afa1d](https://github.com/cgoinglove/thursday/commit/d8afa1d8549cf3838e6dc5d0c6effc782cefab5c))
* offer ready-made bots from the New bot line, with what each still needs ([cf91f7a](https://github.com/cgoinglove/thursday/commit/cf91f7ae325f677599e77e0c85bbce1d510867b1))
* say on the Models section when no studio model is picked ([a5e7a52](https://github.com/cgoinglove/thursday/commit/a5e7a529a31436d13e3b16a6daa206e2d2b54b39))
* see what a bot keeps on its page, open a file in place, delete one ([f0c60d3](https://github.com/cgoinglove/thursday/commit/f0c60d3179f9876c57469d83699be56b30747558))
* seed Insta and Voyage, and offer only the recommended three at install ([10ccb34](https://github.com/cgoinglove/thursday/commit/10ccb342478c740a07defde4ee6168bb2ebe90a9))
* stream memory edits from the memory tab, reading notes on demand ([5290d13](https://github.com/cgoinglove/thursday/commit/5290d13d0c101618ab731756bdc473ae09b98521))
* update ASCII_FACE charset to support emoji only ([71829c4](https://github.com/cgoinglove/thursday/commit/71829c424d5e580ad071c919cb600dc4c918a2a9))


### Fixes

* a bot borrowed onto a job works in the job's folder ([9b358a2](https://github.com/cgoinglove/thursday/commit/9b358a29e006ff1b54620a2739a1859f924bff93))
* let a seed bot's prompt be saved past the old cap ([ddc2296](https://github.com/cgoinglove/thursday/commit/ddc22965e61a630d35f38a351add5763f8b251ee))
* point the model shelves at ids the providers still answer ([30a5705](https://github.com/cgoinglove/thursday/commit/30a570590c3b34edfe71d79b73cd12798f28913f))
* stop telling a bot its step count, and raise the cap to 30 ([e0d0eba](https://github.com/cgoinglove/thursday/commit/e0d0eba08bf6f0e364e684891f9db7ea0ed21ede))


### Docs

* say what memory actually is, and where reads are not fenced ([1855214](https://github.com/cgoinglove/thursday/commit/18552148baea3b9245ef918d8e13de16a77b0cb4))

## [0.2.0](https://github.com/cgoinglove/thursday/compare/thursday-agent-v0.1.2...thursday-agent-v0.2.0) (2026-09-09)


### Features

* a broken run says so, and the shell says what this machine has ([b3515e3](https://github.com/cgoinglove/thursday/commit/b3515e317870a698ff707f657ec7cb9f6b7ddd01))
* a folder for the job, a folder for the bot, and shorter notes ([1ba4769](https://github.com/cgoinglove/thursday/commit/1ba4769b2864ae3432b0d8934bc80838923797d4))
* a prompt and its tool set say what they cost ([f58d96a](https://github.com/cgoinglove/thursday/commit/f58d96aba2a6dd2de9f248537b59a9073fde27b2))
* bots keep their own notes, and learn the machine on their first command ([c06996b](https://github.com/cgoinglove/thursday/commit/c06996b7068230f12f8cfd75de5ff0131b67fab7))
* every fact in memory records whose hand wrote it ([72e3f5f](https://github.com/cgoinglove/thursday/commit/72e3f5f2ae39dcff05022e430d72ff9b60688dff))
* introduce PROMPT_CROWDED configuration and update bot/skill settings ([6dfea3a](https://github.com/cgoinglove/thursday/commit/6dfea3a201c579bd353373b8b1ccd9bf29ef45a5))
* one folder per job, and a tool argument may be left out ([d92bff1](https://github.com/cgoinglove/thursday/commit/d92bff1af511544339dc620a423eabe1045dc3b1))
* the crew says who, the words say what ([e276663](https://github.com/cgoinglove/thursday/commit/e276663d886ae74e82ead9e3ffb8776179d18512))


### Fixes

* keep memory's bookkeeping off the model, and say what time it is ([5a11299](https://github.com/cgoinglove/thursday/commit/5a1129924b2ddf928f972d7646f128875089231e))
* writes that must land, and turns that must be stored whole ([a13b3d0](https://github.com/cgoinglove/thursday/commit/a13b3d0c18842a1d657cf8af4e8113f0b73eb24d))

## [0.1.2](https://github.com/cgoinglove/thursday/compare/thursday-agent-v0.1.1...thursday-agent-v0.1.2) (2026-09-08)


### Fixes

* start on a free port instead of an EADDRINUSE stack trace ([336dede](https://github.com/cgoinglove/thursday/commit/336dede509dd717725d66c77733c548451770422))

## [0.1.1](https://github.com/cgoinglove/thursday/compare/thursday-agent-v0.1.0...thursday-agent-v0.1.1) (2026-09-08)


### Fixes

* let npm choose the native binaries, instead of shipping the build machine's ([a9903cf](https://github.com/cgoinglove/thursday/commit/a9903cfefa66c504efc1f80c7991757b1b2734ca))
* publish from the version release-please decided, not from its tag ([ca4b75a](https://github.com/cgoinglove/thursday/commit/ca4b75a96a604e4b64fcdf388797b26286c8a0ff))

## 0.1.0 (2026-09-08)


### Features

* first public release ([2779293](https://github.com/cgoinglove/thursday/commit/27792938e57522cfe6f3c7e60b7797980cb98738))


### Docs

* say what a harness is, and what the call can do that none of them can ([5ff27a2](https://github.com/cgoinglove/thursday/commit/5ff27a2ce1f582370b6a3fda9be11ca12266662f))
