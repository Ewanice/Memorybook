# 1.3.1 ASCII paths

软件生成的目录、交付包内部路径及默认文件名统一使用英文 ASCII。界面继续使用中文。此规则替代旧文档中的中文路径示例。

| 内容 | 相对软件根目录的路径 |
| --- | --- |
| 工程数据库 | data/memorybook.sqlite |
| 照片与贴纸 | data/assets/ |
| 预览缓存 | data/previews/ |
| 浏览器缓存与日志 | data/browser-cache/、data/logs/ |
| 本地 Codex 工作目录 | data/codex-generation/ |
| 明文短语 | phrases.txt |
| 内置字体 | materials/fonts/ |
| 导入字体 | materials/imported-fonts/ |
| 纸张素材 | materials/papers/ |
| 默认 PDF、工程备份和诊断导出 | exports/ |

导出默认文件名使用 memorybook-编号.pdf、album-编号.memorybook；用户可以在保存对话框自行选择名称。软件不强制改名用户已经存在的照片，也不改动用户选择的外部目录。

新交付文件为 Memorybook-1.3.1-Windows-x64.zip。内含 Memorybook/ 完整程序文件夹、license.txt、README.txt、SHA256.json；请完整解压到英文路径，例如 D:/Memorybook。

升级时优先读取现有英文目录。若尚无新数据库，则优先复制软件旁旧中文数据目录中的一致性快照和原图，再考虑旧系统用户目录。旧中文短语库可迁移到 phrases.txt；已编辑的英文文件不覆盖。旧导入字体按摘要校验后迁移到 materials/imported-fonts。迁移记录写入 data/path-migration-v131.json，原目录保留，避免丢失资料。

构建验收检查 ASAR 内部和整个交付包的文件路径均为 ASCII。另有真实完整文件夹启动测试，检查默认工程、缓存、字体和短语路径。新增迁移测试覆盖旧中文目录、短语保留、字体迁移与重复运行不覆盖。
