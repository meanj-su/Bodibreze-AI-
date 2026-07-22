# Bodibreze-AI

Bodibreze 团队的 AI 辅助运营工具库：集中管理业务逻辑、公共文档、可复用 Skill、自动化脚本、提示词模板、数据分析方法论和工作日记。

这个仓库主要作为团队共享的 GitHub 索引。它保存“方法、流程、脚本和模板”，避免把凭证、大体积原始数据、临时导出文件或真实后台下载内容放进仓库。

## 仓库内容

```text
Bodibreze-AI-/
|- docs/                         # 公共文档、业务框架、模板、AI 学习地图
|  |- ai-agent-work-map/          # AI Agent 工作协助进阶资料
|  |- brand/BODIBREZE/            # BODIBREZE SKU 与组合规则资料
|  |- framework/                  # 数据分析、清洗、字段口径等通用框架
|  |- public/                     # 本地公共 docs 迁移内容
|  `- templates/                  # 日报、复盘、提示词、SOP 模板
|- skills/                        # 可复用 Codex Skill
|  |- adspower-browser/
|  |- shopee-hover-data/
|  `- shopee-official-excel-export/
|- workflows/                     # 项目级自动化工作流
|  |- shopee-adspower-scraper/
|  `- google-sheets-analysis/
|- journal/                       # 工作日记与协作上下文
|- examples/                      # 脱敏样例输入/输出
|- reports/                       # 可沉淀的脱敏报告样例
|- .env.example                   # 环境变量示例，不包含真实凭证
|- .gitignore                     # 默认排除敏感文件、原始导出和临时产物
`- requirements.txt               # Python 工作流依赖占位
```

## 常用入口

- `docs/ai-agent-work-map/README.md`：AI 初学者工作协助路线，从工具地图开始。
- `docs/public/README.md`：公共 docs 入口，优先阅读这里再进入具体项目。
- `docs/brand/BODIBREZE/`：SKU 对照、清仓组合、Bundle 编码匹配等资料。
- `skills/shopee-official-excel-export/SKILL.md`：Shopee 官方 Excel 导出 Skill。
- `skills/adspower-browser/SKILL.md`：AdsPower 浏览器管理与登录态复用相关 Skill。
- `skills/shopee-hover-data/SKILL.md`：Shopee 图表 hover/sourceData 提取 Skill。
- `workflows/shopee-adspower-scraper/README.md`：Shopee Seller Center / AdsPower 数据采集与 Product Impact 报告工作流。

## Skill 使用方式

大多数 Skill 目录遵循以下结构：

```text
skill-name/
|- SKILL.md        # Skill 入口说明
|- references/     # 分步骤流程、字段映射、输出格式等参考文档
|- scripts/        # 可选辅助脚本
|- config/         # 配置或配置示例
`- assets/         # 可选模板或静态资源
```

使用时优先阅读对应目录下的 `README.md`；如果没有 `README.md`，从 `SKILL.md` 开始。

生成的报告、临时导出、原始数据和大文件默认不要提交，除非已经脱敏并整理成明确需要沉淀的文档或样例。

## 协作约定

- 每位成员的工作日记放在自己的 `journal/<成员>/` 目录下。
- 提交尽量小而聚焦，commit message 清楚说明改动内容。
- 当工作流、字段定义、输出格式发生变化时，同步更新相关文档或 Skill。
- 可复用流程优先沉淀为 Skill，不要只散落在聊天记录里。
- 原始下载、大体积媒体、账号凭证、token、cookie、API key 不提交。
- Shopee/AdsPower/Google Sheets 任务优先保留原始文件不变，清洗和合并只写派生产物。

## 安全说明

本仓库不得保存任何真实凭证。

`.env.example` 只展示变量名称和配置结构。密钥应从本地环境变量、本机凭证管理器或合规的云端密钥管理服务读取。

推送前建议搜索以下敏感词并人工复核命中内容：

```text
token
api_key
apikey
secret
password
cookie
private_key
client_email
refresh_token
```

## 本地环境

部分工作流仅为文档说明。需要运行 Node.js 脚本时，以对应 Skill 或 workflow 的 `package.json` / `SKILL.md` 为准。

需要运行 Python 辅助脚本时，可先准备本地环境：

```powershell
python -m venv .venv
pip install -r requirements.txt
```

## 推送到 GitHub

```powershell
cd C:\Users\Administrator\Bodibreze-AI-
git add README.md
git commit -m "Resolve README merge conflict"
git push -u origin main
```
