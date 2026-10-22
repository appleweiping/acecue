# AceCue

在浏览器里练习面试回答：针对目标岗位回答一道题（打字或语音口述），得到按 STAR 结构拆解的反馈，以及面试官很可能接着问的追问。

![回答一道行为面试题并得到离线检查器的反馈](docs/demo.gif)

**在线试用：** https://acecue.vercel.app （点 *Try a one-click demo*，不需要密钥）· [English](README.md)

界面目前只有英文；AI 模式可以选择用中文出题和写反馈。

## 为什么做这个

我在投实习。自己在脑子里过答案的时候，总是漏掉同样的东西：目标没说清楚、一直在说"我们"、结尾没有结果。我想要一个工具：给我出题，让我说出来，然后指出我漏掉的部分。

这个仓库早先的版本是一个"实时面试副驾"，会监听会议并实时给出回答建议。我把它删掉了：在真实面试里用它就是作弊，我不想让自己的名字和这种东西挂在一起。留下来的是面试之前真正有用的部分：练习。

## 功能

1. 选岗位（通用、软件、数据、产品、硬件/芯片设计）和题型（行为、技术、混合）。
2. 从内置题库出题，或者让模型根据你的简历和职位描述出题。
3. 在文本框里作答，或者点 **Dictate** 直接说。计时器和字数会提示这段回答说出来大概多长。
4. 得到反馈：STAR 每一部分（情境、任务、行动、结果）标为缺失 / 偏弱 / 清楚并附说明，10 分制总分，需要改进的点，以及一个可以接着回答的追问。技术题用另一套标准：思路、理由、例子、局限。
5. 把整轮练习下载成 Markdown 留作笔记。

两种反馈方式：

| | 离线检查器 | AI 模型 |
| --- | --- | --- |
| 原理 | [`star-check.js`](public/js/star-check.js) 里的规则：每个 STAR 部分的提示短语、字数、口头禅、含糊措辞、"we" 与 "I" 的比例、是否有数字 | 用你自己的密钥；模型根据简历和职位描述出题，并以 JSON 返回反馈，用同样的版式显示 |
| 需要 | 什么都不需要，完全在浏览器里运行 | OpenAI、Anthropic、Gemini、DeepSeek、Mistral 或 OpenRouter 的密钥 |
| 局限 | 只支持英文回答；只检查结构，判断不了故事本身好不好，也可以被刻意"刷分" | 消耗 API 额度；质量取决于模型 |

一键演示会填入一份虚构的学生简历、一份虚构的职位描述和一段示例回答，然后用离线检查器给出反馈。

## 本地运行

需要 Node 20 或更新版本，没有需要安装的依赖。

```bash
git clone https://github.com/appleweiping/acecue.git
cd acecue
npm run dev      # http://localhost:3000
npm test
```

没有密钥也想试 AI 模式：用 `MOCK_UPSTREAM=1 npm run dev`（PowerShell：`$env:MOCK_UPSTREAM=1; npm run dev`）启动，密钥随便填。回复来自 [`scripts/mock-upstream.mjs`](scripts/mock-upstream.mjs)，带有 "(mock)" 标记，不是模型输出。

## 密钥怎么处理

- AI 模式下，浏览器通过 `X-User-Key` 请求头把密钥发给本站的 `/api/chat` 边缘函数，函数调用一次所选服务商并把回复流式返回，不记录也不保存密钥。密钥默认存在 `sessionStorage`（关闭标签页即清除），勾选 *Remember the key* 才会存进 `localStorage`。
- `/api/chat` 只响应来自同一域名页面的请求（检查 `Origin` 头），别的网站不能把它当作免费中转。
- 服务器环境变量里的密钥默认不使用，除非设置 `ALLOW_OPERATOR_KEYS=1`，此时按 IP 限流。见 [`.env.example`](.env.example)。
- 离线检查器和题库不联网。语音输入用的是浏览器自带的语音识别；在 Chrome 里音频会发送给 Google。

## 许可证

MIT，见 [LICENSE](LICENSE)。
