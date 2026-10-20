# 纪念册设计软件

> 当前源码版本 **1.5.1**：打开即用，已移除卡密、激活界面与签发流程。详见 [本次变更](docs/15-v151-no-activation.md)。

1.5.0：资源异常隔离、备份恢复、多选编辑、排版预览与拆页，以及 PDF 导出检查。详见 [版本说明](docs/14-v150-release.md)。

[软件介绍与操作指南](docs/software-introduction.html) · [下载 Windows 完整文件夹版](https://github.com/Ewanice/Memorybook/releases/latest)

普通使用无需开发环境：在 Releases 下载 `Memorybook-1.5.1-Windows-x64.zip`，完整解压后运行 `Memorybook/Memorybook.exe`，无需卡密或激活。普通设计与 PDF 导出离线可用，AI 使用自己的 API 或已登录的本地 Codex，不包含 AI 额度。

GitHub 可免费获取；平台可提供便捷交付与技术服务，自愿赞助另行说明。

## 获取源码（含 Git LFS）

```powershell
git lfs install
git clone https://github.com/Ewanice/Memorybook.git
cd Memorybook
git lfs pull
```

图片、字体及发布压缩包使用 Git LFS；仅下载 GitHub 的源码 ZIP 可能得到 LFS 指针，普通用户请优先下载 Releases 中的完整软件包。仓库不包含私钥、个人 API Key、用户工程或本地素材库。

## 先前版本

> 1.4.0：11 套排版更新成套纸张、底色与字色，换底可同步文字配色，详见 [排版更新](docs/13-layout-art-direction.md)。

1.3.2 修复贴纸库与照片列表混用、编辑器贴纸缺失及 Codex 漏用贴纸的校验，详见 [贴纸流程修复](docs/12-sticker-workflow-fix.md)。

> 1.3.1：软件生成路径与交付文件统一使用英文；最新路径、升级迁移与下载文件名见 [ASCII paths](docs/11-ascii-paths.md)。

当前阶段：已完成本地桌面功能与 Windows 完整文件夹版构建，正在做发布前验收。具体范围、测试证据和限制见 [开发与交付说明](docs/07-开发运行与交付.md)。

确定方向：Windows 离线桌面软件；平台自动发货云盘链接与使用说明；仅主动调用 AI 时联网。默认操作保持简单，高级属性按需展开。

元素 AI 批注使用 BYOK，整本生成还可选择本地 Codex。BYOK 模式：用户在设置中填写自己的 API Base URL、模型与 API Key，直接请求所选平台。无需运营服务端或购买 Windows 代码签名证书；当前产物为未签名包。

交付原则：软件打开即用，不设置卡密或激活；按完整商业产品架构直接实现，不以 MVP 代替正式交付；代码不静默吞错或伪造成功；提供必要设置，界面美观克制、不过度设计。分阶段仅用于实施和验收。

将自己的照片、贴纸、票根和文字组装成多页纪念册。从可编辑模板开始，支持自由修改、逐元素 AI 批注，以及按设计页导出 PDF。

1.3.0 新增软件根目录保存、压缩缓存、首页 Codex 状态、快捷键、逐页纸张与字体导入，交付改为完整文件夹。详见 [本次功能与存储说明](docs/10-软件目录存储与纸张字体.md)。

1.2.0 支持全排版随机生成、自定义排版编辑、软件内短语库、页码和本地 Codex 连接；详见 [本次功能说明](docs/09-随机排版与本地Codex.md)。

## 文档入口

1. [产品需求文档](docs/01-产品需求文档.md)：定位、首版范围、完整使用流程、功能规则与验收标准。
2. [交互与视觉设计](docs/02-交互与视觉设计.md)：编辑器布局、模板体系、封面与内页设计、关键状态。
3. [数据与 AI 修改协议](docs/03-数据与AI修改协议.md)：可编辑文档模型、批注、版本、AI 任务、取消与回滚。
4. [实施与验收计划](docs/04-实施与验收计划.md)：分阶段交付、测试场景、风险与待验证假设。
5. [纪念册数据示例](docs/examples/album.example.json)：以“明日世界 · 北京”为例的结构化文档。
6. [技术方案](docs/05-技术方案.md)：简化交互、技术栈、本地存储、PDF、AI 与发布验收。
7. [离线授权与自动发货](docs/06-离线授权与自动发货.md)：打开即用、固定内容自动发货与技术服务说明。
8. [开发运行与交付](docs/07-开发运行与交付.md)：本地开发、打包、已验证范围与用户使用说明。

## 本地开发

需要 Node.js 24+、npm 10.9+，首次安装构建依赖需要联网，应用的基础使用不需要联网。

```powershell
npm ci
node node_modules/electron/install.js
npm run build
npm run dev
```

用户 API Key、个人工程与本地数据不得提交到仓库。构建与运行无需授权密钥。

```powershell
npm run check
npm test
npm run smoke
npm run smoke:resources
```

文档版本：v0.8，2026-10-15。当前软件暂用“拾页 / Memorybook”名称。

