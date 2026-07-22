# Context Loading Validation - 2026-07-22

## Goal

验证 Bodibreze AI 项目统一上下文读取机制是否可用。

## Existing Project Test

项目：`C:\Users\Administrator\Bodibreze-AI-`

预期读取顺序：

1. `AGENTS.md`
2. `README.md`
3. `docs\public\README.md`
4. 任务相关 `docs\`、`skills\`、`workflows\`

验证结果：通过。总工具库已存在 `AGENTS.md` 和 `README.md`，并明确列出读取顺序、复用规则、人工确认边界和安全规则。

## New Project Test

项目样例：`examples\new-project-context-test\`

预期文件：

- `AGENTS.md`
- `README.md`

验证结果：通过。新项目样例已从 `templates\new-project\` 复制最低接入文件，内容指向本地总工具库和 GitHub 总库。

## Acceptance Checklist

- [x] 总工具库存在 `AGENTS.md`。
- [x] 新项目模板存在 `templates\new-project\AGENTS.md`。
- [x] 新项目模板存在 `templates\new-project\README.md`。
- [x] 现有项目测试通过：`Bodibreze-AI-` 可作为项目级入口。
- [x] 新项目测试通过：`examples\new-project-context-test\` 可作为新项目起点。
- [x] 人工确认边界覆盖凭证、浏览器控制、GitHub 上传、原始数据、覆盖文件。
- [x] 规则要求 AI 报告读取来源、复用知识、重新验证项。

## Human Confirmation Boundary

以下行为仍必须由用户确认：

- 覆盖、删除、重命名已有文件。
- 上传 GitHub 或公开业务数据。
- 使用账号登录、cookies、API Key、AdsPower 浏览器控制。
- 执行导出、发布、提交、批量修改后台数据的脚本。
- 将临时流程沉淀为长期 Skill 或团队公共规范。
