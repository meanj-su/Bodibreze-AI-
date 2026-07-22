# Public Docs Role Audit - 2026-07-22

## Conclusion

`E:\AI项目汇总\公共docs` 仍有必要，但不再作为最高级总入口。它调整为本地公共资料中转站、历史兼容入口和敏感资源路径索引。

## Reason

当前公共 docs 与 `Bodibreze-AI\docs\public` 存在大量 Markdown 重叠。`共享资源.md` 还包含 Google Sheet ID、credentials 路径和本地资源路径，这类内容不适合公开同步到 GitHub。

## New Source of Truth

- 最高级入口：`E:\AI项目汇总\Bodibreze-AI\AGENTS.md`
- 正式跨项目规则：`E:\AI项目汇总\Bodibreze-AI\docs\framework`
- 可公开公共说明：`E:\AI项目汇总\Bodibreze-AI\docs\public`
- 本地资源路径和历史资料：`E:\AI项目汇总\公共docs`
- 真实品牌数据：`E:\AI项目汇总\Bodibreze-Data-Library`

## Changes Made

- Updated `E:\AI项目汇总\公共docs\README.md` to say it is not the highest-level entry.
- Updated `E:\AI项目汇总\公共docs\协作规范.md` for old-project compatibility.
- Replaced GitHub `docs\public\共享资源.md` with a sanitized public version.
- Updated GitHub `docs\public\README.md` and `协作规范.md` to clarify local-vs-public roles.
- Updated migration standard with public docs positioning.

## Usage Rule

New tasks should read `Bodibreze-AI\AGENTS.md` first. Read `公共docs` only when checking local resource paths, historical notes, or not-yet-cleaned local knowledge.
