# Kimi 桌宠 (Kimi Desktop Pet)

> 🎨 原型设计源自 B站 UP 主 **ZipZipPipe** 创作的 AI 娘形象，由本项目使用 **GPT** 进行 Q 版化重构与逐帧动作设计，支持真实会话状态联动、细腻动画演出与上下文指标监控。

---

## 📖 项目简介

本项目包含两大桌宠形态体系：
1. **独立桌面版 (`独立桌面版/`)**：基于 Electron 构建的轻量级透明桌面伴侣，能够独立运行于 Windows 桌面，随同开发者的日常编码与会话进程动态互动；
2. **Kimi Work 版 (`kimi work版/`)**：专为 Kimi Work 平台环境设计的桌宠与指标监控套件，包含完整交互界面、多场景高精度动画序列、指标采集器与安装配置。

---

## 📦 快速下载 (Release Downloads)

> 💡 **面向普通用户**：若您不需要修改源码或配置开发环境，可直接前往本仓库的 **[Releases 页面](https://github.com/Ancientandmodern/kimi-desktop-pet/releases/tag/v1.0.0)** 下载解压即用的压缩包：
> 
> - 🚀 **[点击直接下载：独立桌面版免安装完整包 (139 MB)](https://github.com/Ancientandmodern/kimi-desktop-pet/releases/download/v1.0.0/Kimi_Desktop_Pet_Standalone.zip)**  
>   包含独立桌宠全部必要依赖与预构建文件的解压即用包。解压后直接双击 `启动 Kimi 桌宠.cmd` 即可运行，无需预先安装 Node.js 环境。
> - 🧩 **[点击直接下载：kimi work版运行包 (14.8 MB)](https://github.com/Ancientandmodern/kimi-desktop-pet/releases/download/v1.0.0/kimi.work.zip)**  
>   面向 Kimi Work 工作台的一体化运行包与预设资源。
> 
> *(注：上述两套 zip 压缩包作为成品下载使用，仓库源码树保持轻量，仅收录核心代码、脚本与素材源文件。)*

---

## 🌟 核心特性

### 1. 独立桌面版 (Standalone Electron)
- **生动交互**：
  - 支持桌面任意位置拖拽移动；
  - 轻戳、三连击、长按触发独立动作与表情反馈；
  - 角色跟随 Kimi Code 主窗口右下角（拖拽时自动暂停跟随）。
- **会话联动演出**：
  - 自动监听本地 Kimi Code 会话状态（`~/.kimi-code/sessions/...`）；
  - 轮次开始时进入弹钢琴工作动画，轮次顺利完成进入收尾演出，异常或取消时平稳退场。
- **内置监控与设置面板**：
  - 点击齿轮按钮打开控制面板；
  - 动态显示当前会话 Context 长度（优先读取最新 measured tokens）；
  - 实时统计轮次去重、步骤计数、Token 生成速度与缓存命中率；
  - 实时展示已加载技能与活跃工具调用状态；
  - 随时调整桌宠显示缩放尺寸、暂停动画或手动预览各场景动作。

### 2. Kimi Work 版 (Work Platform)
- **四大沉浸设定场景**：
  1. 🌙 **月光下看书**：安静待机，细腻的翻页与微风呼吸；
  2. 🎸 **听摇滚乐**：活力活跃待机；
  3. ☕ **与 GLM 的日常**：双人互动趣味彩蛋；
  4. 🎹 **弹钢琴**：全神贯注的工作进行曲。
- **高品质美术素材**：原生透明通道 PNG 序列帧动画与精确时间轴 (`timeline.json`)，杜绝半透明叠化与边缘脏色。
- **完整指标采集架构**：包含接口调用统计与工作台插件集成规范。

---

## 🗂️ 仓库目录结构

```text
kimi-desktop-pet/
├── 独立桌面版/                    # 独立桌面版 Electron 工程
│   ├── 启动 Kimi 桌宠.cmd         # Windows 桌面一键启动脚本
│   ├── main.cjs                  # Electron 主进程 (窗口管理、透明置顶、宿主跟随)
│   ├── renderer.js               # 渲染进程 (动画调度与交互逻辑)
│   ├── session-monitor.cjs       # Kimi 会话日志增量解析与指标聚合
│   ├── quota.cjs                 # 官方额度接口查询与本地服务探测
│   ├── pet.js                    # 动画序列与交互动作状态机
│   ├── index.html                # 桌宠视窗与设置面板 DOM 结构
│   ├── styles.css                # 样式与滤镜定义
│   ├── preload.cjs               # 安全 IPC 预加载脚本
│   ├── package.json              # 项目依赖与运行脚本
│   ├── scripts/                  # 辅助工具与构建校验脚本
│   └── tests/                    # 冒烟测试与自动化测试
│
├── kimi work版/                   # Kimi Work 平台版本
│   └── kimi桌宠/
│       ├── 完整界面/              # 工作台内嵌前端交互界面
│       ├── 源文件/                # 动画原始图层与关键帧素材
│       ├── 指标采集/              # 会话指标与监控采集模块
│       ├── 桌宠运行包/            # 平台运行所需的分发包
│       ├── 安装信息.json          # 插件与组件绑定元数据
│       └── progress.md           # 详细设计规范、帧率时序与验收记录
│
├── .gitignore                    # Git 忽略配置 (忽略 node_modules、zip 及临时日志)
└── README.md                     # 项目使用与部署说明
```

---

## 🚀 源码运行指引

### 运行独立桌面版

#### 环境要求
- 操作系统：Windows 10 / 11
- 运行环境：Node.js 22+ (带有 npm)

#### 运行步骤
1. 进入独立桌面版目录：
   ```powershell
   cd 独立桌面版
   ```
2. 安装依赖并启动：
   ```powershell
   npm install
   npm start
   ```
   或者直接双击运行目录内的 `启动 Kimi 桌宠.cmd`。

#### 环境变量配置 (可选)
- `KIMI_API_KEY` 或 `KIMI_CODE_API_KEY`：当 Kimi Code 本地服务未运行时，可配置此环境变量直连官方额度接口。
- `KIMI_PET_SMOKE=1`：开启自动冒烟测试模式，测试完成后会自动截图并安全退出。

---

## 📄 形象来源与鸣谢 (Credits)

- **原始角色形象**：由 B站 UP 主 **ZipZipPipe** 创作设计（感谢原作者创作的精彩 AI 娘视觉设计与原型！）。
- **Q版化二创与动画设计**：由作者使用 **GPT** 进行 Q 版化重构与姿态演进，并完成了 17 组关键姿势、时序时间轴与高精度透明通道动画序列的导出与合成。
- **系统工程开发**：包含独立桌面版 Electron 宿主架构、会话日志增量解析器、上下文与额度实时监控面板，以及 Kimi Work 平台套件开发。
- 本项目遵循开源与非商业学习交流目的，欢迎提出 Issue 与 Pull Request 共同完善！
