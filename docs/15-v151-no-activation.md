# 1.5.1：移除卡密功能

软件打开后直接进入首页，无需卡密、激活或登录。旧版工程、素材、短语、字体和 AI 设置继续保留；旧数据库中的历史卡密字段不再读取或校验。

## 产品与实现

- 删除首次激活界面、卡密输入与文件导入、授权状态、卡密更换入口。
- 设置“授权与关于”改为“关于”，保留版本、第三方许可、诊断和恢复默认设置。
- 删除卡密验证模块、激活 IPC、授权门禁、签发脚本及相关数据类型。
- 构建不再需要公钥、私钥或签发步骤；发布包不再包含 `license.txt`。
- 自动数据库备份直接随软件启动，不再依赖激活状态。
- 保留 IPC 来源校验、文件路径校验、任务锁、AI Key 加密及 Windows 可选代码签名，这些机制各自承担原有职责。

## 开发与发布

```powershell
npm ci
node node_modules/electron/install.js
npm run build
npm run dev
```

正式打包：

```powershell
$env:MEMORY_RELEASE = "1"
npm run package
npm run verify:release
npm run delivery
```

已有同版本 Electron 离线压缩包时，可设置 `MEMORY_ELECTRON_ZIP_DIR` 指向其所在目录。此项与卡密无关。

平台自动发货提供完整软件包链接、解压说明及技术服务范围，不再发送卡密。GitHub 免费获取、可选平台技术服务和自愿赞助的安排保持不变。AI 仍使用用户自己的 API 或本地 Codex 账户额度。

## 本次验证

2026-10-20：类型检查、65 项自动测试、100 页 PDF 桌面流程、含遗留无效卡密的重启与工程持久化、12 项恢复检查均通过。正式包还通过首次直接启动、激活 API 缺失、实际 EXE 与完整文件夹存储检查；ZIP 不含 license.txt，487 个文件逐项摘要一致。
