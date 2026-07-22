# AI 项目统一迁移规范

本规范适用于 Bodibreze 相关 AI 项目、Codex Skills、公共 docs、自动化脚本、品牌数据资源库和导出目录的整理迁移。

## 总原则

- E 盘作为 AI 项目主工作区：`E:\AI项目汇总\`。
- C 盘只保留 Codex 必须路径、用户目录兼容入口或 junction。
- D 盘优先作为大体积导出和历史下载落点，稳定后再逐步接入数据资源库。
- GitHub 只保存工具库、规则、脚本、Skill、脱敏样例和文档，不保存真实凭证和原始业务数据。
- 迁移采用“复制 -> 验证 -> 建立兼容入口 -> 保留备份 -> 后续确认清理”的顺序，不直接删除源目录。

## 推荐目录

```text
E:\AI项目汇总\
  00-总入口\
  Bodibreze-AI\
  Bodibreze-Data-Library\
  Codex Skills\
  公共docs\
  projects\
  archives\
```

## 分类规则

- 工具库 / GitHub 仓库：放 `E:\AI项目汇总\Bodibreze-AI` 或 `projects\`。
- 品牌数据资源库：放 `E:\AI项目汇总\Bodibreze-Data-Library`。
- Codex Skill 源文件：放 `E:\AI项目汇总\Codex Skills\`，必要时用 junction 暴露给 `C:\Users\Administrator\.codex\skills\`。
- 公共规则 / SOP / 模板：放 `E:\AI项目汇总\公共docs\` 或 `Bodibreze-AI\docs\`。
- 大体积导出：暂保留 `D:\Shopee Export`，后续按数据资源库规范接入 `raw\`。
- 历史旧副本：放 `E:\AI项目汇总\archives\`。
- 凭证 / token / cookies / 私钥：不放 GitHub；只放本地安全位置，并通过 `.env.example` 记录变量名。

## 迁移验收

每个项目迁移后必须验证：

- 目标目录存在，文件数量和关键文件可读取。
- `README.md` 和 `AGENTS.md` 指向正确主路径。
- Git 仓库可执行 `git status`，远端地址正确。
- Codex 旧入口如果需要保留，必须通过 junction 或明确说明兼容路径。
- 不迁移 `node_modules`、`exports`、`downloads`、`credentials`、大体积原始报表或临时缓存。
- 涉及覆盖、删除、重命名、公开上传、浏览器控制或凭证读取时，必须先人工确认。

## 新项目落地方式

1. 在 E 盘归类创建项目目录。
2. 从 `Bodibreze-AI\templates\new-project\` 复制 `AGENTS.md` 和 `README.md`。
3. 在项目 README 里记录数据源、输出目录和人工确认点。
4. 如果项目形成稳定流程，再沉淀到 `skills\`、`workflows\` 或 `docs\framework\`。
