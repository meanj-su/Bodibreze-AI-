# Project AGENTS Onboarding Validation - 2026-07-22

## Scope

本次补齐 4 个已经位于 E 盘且已被 `Bodibreze-AI` 工具库收录的项目级 `AGENTS.md`。

## Projects

| Project | Type | AGENTS.md | Status |
|---|---|---|---|
| `E:\AI项目汇总\shopee-adspower-scraper` | Workflow | `AGENTS.md` | Added |
| `E:\AI项目汇总\shopee-official-excel-export` | Codex Skill | `AGENTS.md` | Added |
| `E:\AI项目汇总\adspower-browser` | Codex Skill | `AGENTS.md` | Added |
| `E:\AI项目汇总\shopee-hover-data` | Codex Skill | `AGENTS.md` | Added |

## Clarification

这些项目此前已经迁移/落点在 E 盘，并且已被总工具库收录到 `skills/` 或 `workflows/`。本次工作不是重新迁移，而是补齐每个项目自己的 `AGENTS.md`，让 Codex 进入项目根目录时能直接读取项目级规则。

## Common Requirements Added

- 任务开始前读取当前项目入口和 `E:\AI项目汇总\Bodibreze-AI\AGENTS.md`。
- 说明已读取文件、复用知识、重新验证项和人工确认边界。
- 涉及凭证、cookies、API Key、浏览器控制、导出、覆盖、删除、GitHub 上传时先确认。
- 原始文件不改动；清洗和可视化输出写入派生目录或 `Bodibreze-Data-Library`。

## Verification Checklist

- [x] `shopee-adspower-scraper\AGENTS.md` exists.
- [x] `shopee-official-excel-export\AGENTS.md` exists.
- [x] `adspower-browser\AGENTS.md` exists.
- [x] `shopee-hover-data\AGENTS.md` exists.
- [x] Each file points to `E:\AI项目汇总\Bodibreze-AI\AGENTS.md`.
- [x] Each file states project-specific safety boundaries.

## Follow-up

后续可按同样方式补齐：`全站数据分析`、`公共docs`、`日常工作`。这些项目需要先盘点数据、输出和凭证落点，再写项目级规则。
