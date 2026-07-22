# Bodibreze AI 上下文读取约定

本约定用于让所有 Bodibreze 后续 AI 项目形成一致工作方式：先读取项目规则，再读取总工具库，再执行任务。

## 目标

AI 在开始执行前必须知道：当前项目是什么、应该复用哪些公共知识、哪些内容需要重新验证、哪些动作必须人工确认。

## 标准读取顺序

1. 当前项目 `AGENTS.md`
2. 当前项目 `README.md`
3. 总工具库 `C:\Users\Administrator\Bodibreze-AI-\AGENTS.md`
4. 总工具库 `C:\Users\Administrator\Bodibreze-AI-\README.md`
5. 总工具库 `docs\public\README.md`
6. 任务相关 `docs\`
7. 任务相关 `skills\`
8. 任务相关 `workflows\`
9. 本地缺失或疑似过期时，再参考 GitHub：`https://github.com/meanj-su/Bodibreze-AI`

## 任务启动报告格式

```text
已读取上下文：
- <文件 1>
- <文件 2>

复用知识：
- docs: <具体文档>
- skills: <具体 Skill>
- workflows: <具体工作流>

需要重新验证：
- <日期、页面状态、输出文件、账号状态、配置路径等>

人工确认边界：
- <是否涉及凭证、浏览器控制、GitHub 上传、原始数据、覆盖文件等>
```

## 合格标准

- 任务开始前能列出读取来源。
- 能说清楚复用了哪些已有资料。
- 不把旧知识当成当前事实。
- 涉及敏感权限或破坏性动作时先确认。
- 输出结论区分：已验证、仅推断、缺数据、需要人工确认。

## 新项目接入方式

1. 从 `templates\new-project\` 复制 `AGENTS.md` 和 `README.md` 到项目根目录。
2. 填写项目名称、范围、数据源和输出约定。
3. 第一次任务用 `docs\templates\bodibreze-project-startup-prompt.md` 的提示词启动。
4. 若项目形成稳定流程，再沉淀到 `skills\`、`workflows\` 或 `docs\framework\`。
