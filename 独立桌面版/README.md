# Kimi 独立桌面伙伴

独立 Electron 版，复用现有 17 个动画片段、设置面板和鼠标交互，不替代已安装的 Kimi Work 桌宠。

## 启动

**推荐：双击目录中的 `启动 Kimi 桌宠.cmd`。** 已有依赖时会直接启动，不需要 Node.js 或 npm 保持可用，也不会留下命令行窗口；重复双击只会唤醒现有桌宠。

首次运行或依赖缺失时，启动脚本会调用 `npm install`，此时需要 Windows、Node.js 22 或更新版本及可用的 npm。也可手动执行：

```powershell
npm install
npm start
```

在 PowerShell 中如遇 `ELECTRON_RUN_AS_NODE`，先执行：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

## 使用

- 拖动人物移动桌宠；轻戳、三连点与长按有独立反应。
- 齿轮打开监控与设置。可调整大小、暂停动画、关闭自动轮换、预览四场景。
- 桌宠跟随 Kimi Code 主会话。轮次开始时自动弹钢琴，完成后演出收尾，失败或取消则直接退场。关闭监控面板后仍会跟随会话，钢琴也可手动预览。
- 已登录的 Kimi Code 正在运行时，桌宠经其官方本地服务读取套餐额度，额外的 API Key 可省略。本地服务不可用时，桌宠可用环境变量 `KIMI_API_KEY` 或 `KIMI_CODE_API_KEY` 直连官方额度接口。面板只接收额度结果，认证凭据由主进程处理。
- 右键桌宠或面板，选择“退出桌宠”即可关闭应用。也可在任务管理器中结束本应用的 Electron 进程，但不要结束 Kimi 客户端进程。

## 监控数据

桌宠增量读取最近活动会话的 `~/.kimi-code/sessions/<工作区>/<会话ID>/agents/main/wire.jsonl`，并跟踪已开始的轮次直至结束。面板打开时每 5 秒更新统计、每 5 分钟刷新官方额度。日志内容留在主进程，界面收到的是状态和统计结果。

- 上下文长度优先采用最新 `token_counting.measured.tokens`，不累加历次调用的输入 Token。
- 轮次按 `turnId` 去重，步数按 `step.end` 统计，压缩次数按 `usageScope: "session"` 统计。
- Token 速度使用最近 5 次调用的总输出 Token 除以总耗时；优先配对 `llm.request`，当前版本日志则使用 `step.begin` 到 `usage.record` 的时间差。
- 缓存命中率使用最近 5 次普通调用的 `inputCacheRead / (inputOther + inputCacheRead + inputCacheCreation)`，压缩用量不计入该比例。
- 已加载技能只统计真实 `<skill-loaded>` 消息并按名称去重，不以可用技能或工具列表代替。
- 工具监控显示当前轮次调用数、会话总调用数及尚未返回结果的执行中工具。

这些统计依赖当前 Kimi Code 的 `wire.jsonl` 内部记录格式；官方文档确认其中保存会话与工具请求轨迹，但未承诺字段为稳定公开接口，后续客户端格式变化可能需要同步调整解析器。

## 验证

```powershell
npm run check
npm test
```

带自动截图与面板测试的启动：

```powershell
$env:KIMI_PET_SMOKE = '1'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

验证结束会自行退出并生成 `smoke.png`。`KIMI_PET_DEMO=1` 仅用于显示明确标注的演示额度。

## 当前边界

宿主脚本会寻找非最小化的 Kimi / Kimi Code 主窗口，设置 Windows owner，并跟随其右下角；拖动时暂停跟随。尚未实现宿主最小化联动隐藏、宿主消失自动退出及任意相对锚点记忆。
