# Bodibreze AI Project Instructions

本仓库是 Bodibreze AI 工作体系的总工具库。所有 Bodibreze 后续 AI 项目在开始分析、脚本、文档、自动化或浏览器任务前，应优先读取本文件和相关上下文。

## 总工具库位置

- 本地路径：`C:\Users\Administrator\Bodibreze-AI-`
- GitHub：`https://github.com/meanj-su/Bodibreze-AI`

默认优先使用本地路径；只有本地缺失、疑似过期、用户要求同步或需要跨设备协作时，再参考 GitHub。

## 默认读取顺序

1. 当前项目 `AGENTS.md`
2. 当前项目 `README.md`
3. 总工具库 `C:\Users\Administrator\Bodibreze-AI-\AGENTS.md`
4. 总工具库 `C:\Users\Administrator\Bodibreze-AI-\README.md`
5. 总工具库 `docs\public\README.md`
6. 与任务相关的 `docs\`
7. 与任务相关的 `skills\`
8. 与任务相关的 `workflows\`
9. 如果本地缺失或过期，再参考 GitHub 总库

## 每次任务开始时必须说明

- 已读取哪些项目文件和总工具库文件。
- 复用了哪些已有 docs、skills、workflows。
- 哪些结论来自已验证文件，哪些来自旧知识或推断。
- 哪些信息需要重新验证。
- 是否涉及人工确认边界。

## 默认复用规则

- Shopee 官方报表导出优先看 `skills\shopee-official-excel-export\SKILL.md`。
- AdsPower/Shopee 页面读取优先看 `skills\adspower-browser\SKILL.md` 和 `workflows\shopee-adspower-scraper\README.md`。
- Shopee 图表 hover/sourceData 优先看 `skills\shopee-hover-data\SKILL.md`。
- AI 初学、任务拆解和提示词模板优先看 `docs\ai-agent-work-map\`。
- BODIBREZE SKU、Bundle、组合资料优先看 `docs\brand\BODIBREZE\`。
- 公共协作规则、拉数逻辑、Skill 创建方法优先看 `docs\public\`。

## 人工确认边界

以下情况必须先向用户确认，不能自动执行：

- 覆盖、删除、重命名已有项目文件。
- 上传 GitHub、公开仓库、提交真实业务数据。
- 使用账号登录、cookies、API Key、AdsPower 浏览器控制。
- 运行会导出、发布、提交、批量修改后台数据的脚本。
- 把临时流程沉淀为长期 Skill、公共规范或团队默认流程。
- 本地知识与 GitHub 知识冲突，且冲突会影响结果。

## 数据和安全规则

- 不提交真实凭证、cookies、token、API key、私钥、账号密码。
- 不提交原始下载、大体积媒体、大量原始销售报表或临时导出。
- 原始文件保持不变，清洗、筛选、合并只写派生产物。
- 表格/报表结论必须标明：已验证、仅推断、缺数据、需要人工确认。
- 导出类任务不能只看脚本退出码；必须确认目标文件存在、日期范围正确、关键表/字段有数据。

## 新项目最低要求

每个 Bodibreze 新项目根目录至少应包含：

```text
AGENTS.md
README.md
```

项目 `AGENTS.md` 可以从 `templates\new-project\AGENTS.md` 复制，并补充项目名称、范围、数据源和人工确认点。
