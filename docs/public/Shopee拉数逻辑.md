# Shopee 拉数逻辑

适用范围：所有需要从 Shopee Seller Center、Shopee Ads、Shopee 官方 Excel、Shopee Open Platform、Google 总表等来源取数的项目。

本文只沉淀跨项目通用规则。具体脚本仍放在各项目目录内。

## 总原则

- 优先使用官方、可复验的数据出口：Seller Center 官方 Excel、Shopee Open Platform、Google 总表、已登录页面中的可见业务数据。
- 不反推私有接口，不把 token、cookie、access token、refresh token 写入 docs、代码、日志或提交记录。
- 原始下载文件只保存，不修改。所有筛选、格式转换、字段清洗都在派生汇总表中完成。
- 每次拉数都要保留来源信息：国家、站点、账号/Profile、模块、日期范围、来源文件或页面 URL、生成时间、缺失日期、排除原因。
- 日期口径按站点本地时间处理：ID=Asia/Jakarta，MY=Asia/Kuala_Lumpur，TH=Asia/Bangkok。
- Seller Center 的昨日数据通常需要次日 recheck 后才稳定。若文件修改日期与数据日期是同一天，默认排除，等第二天重新拉取。

## 拉数方式优先级

### 1. 官方 Excel 导出

适合：Product Performance、Voucher、以及 Seller Center 页面本身提供 Export Data 的模块。

项目：`E:\AI项目汇总\shopee-official-excel-export`

核心流程：

1. 通过 AdsPower Local API 获取已打开 Profile。
2. 按 Profile 映射国家：`kyme0da=ID`，`k14di2tc=MY`，`k16ggegy=TH`。
3. 使用 Playwright CDP 连接已登录浏览器。
4. 若目标页未打开，优先用配置里的目标 URL 在对应 Profile 中打开，不要求用户提前打开页面。
5. 只做必要页面操作：打开目标页面、选择日期、点击官方 Export Data、Latest Reports/Download。
6. 同一国家+模块遵守平台导出限制：Export Data 间隔按约 60s 控制；报表未生成时按约 10s 重试，不做大规模 debug。
7. 下载文件先按 Playwright download event 接收；失败时只在对应 Profile 下载目录查找，避免跨国家/模块串文件。
8. 多日 Product Performance 按 By Day 单日拆分，保存每个官方 Excel，再生成派生汇总。

常用命令：

```powershell
node "E:\AI项目汇总\shopee-official-excel-export\scripts\shopee-export.mjs" --approved-real-export "Thailand Product Performance: 2026/06/01~2026/07/16"
```

输出规则：

- 原始文件：`D:\Shopee Export\<Country>\<Module>\...`
- 跨国汇总：`D:\Shopee Export\Combined\<Module>\...`
- 最终汇总命名：`国家1_国家2_数据板块_数据时间段.xlsx`，例如 `TH_product performance_260601-260716.xlsx`。
- Product Performance 最终表只保留 `Top Performing Products`，A 列为 `数据日期`，日期升序，只保留 `Variation ID = "-"`。
- Voucher 最终表只保留 `Performance List`，A 列为 `数据日期`，日期升序。
- 印尼官方表的数字清洗只在最终派生表中做：先去除 `.`，再把 `,` 替换为 `.`，原始 Excel 不改。

已验证站点与目录：

| 国家 | Profile | Product Performance | Voucher | 下载兜底目录 |
|---|---|---|---|---|
| ID | `kyme0da` | `seller.shopee.co.id/datacenter/product/performance` | `seller.shopee.co.id/datacenter/marketing/voucher` | `D:\adspower下载-39` |
| MY | `k14di2tc` | `seller.shopee.com.my/datacenter/product/performance` | `seller.shopee.com.my/datacenter/marketing/voucher` | `D:\adspower下载-43` |
| TH | `k16ggegy` | `seller.shopee.co.th/datacenter/product/performance` | `seller.shopee.co.th/datacenter/marketing/voucher` | `D:\adspower下载-44` |

调试边界：

- 页面已首次识别成功后，后续同模块日期优先复用已确认页面与操作路径。
- 找不到页面或资源时，提示用户确认页面是否已登录/已打开，或是否需要修改需求范围。
- 不影响主流程的 debug 延后处理；不要在每次报表未生成时展开大规模检查。

### 2. AdsPower CDP 只读读取

适合：需要检查已打开 Seller Center 页面、读取可见表格、摘要卡片、Vue chart sourceData、ECharts option 的场景。

项目：`E:\AI项目汇总\shopee-adspower-scraper`

原则：

- 只连接已打开 AdsPower 浏览器。
- 不打开新浏览器，不登录，不点击，不输入，不导航，不截图，不 hover，除非当前任务明确允许。
- 单个 Profile 或 Tab 失败时只记录该失败，不阻断其他 Profile。
- 优先过滤出业务数据，避免遍历 Vue/ECharts 内部响应式对象造成噪声和性能压力。

常用命令：

```powershell
cd E:\AI项目汇总\shopee-adspower-scraper
npm run inspect
node .\scripts\inspect-current-seller-center.mjs --profile-id kyme0da --json
```

### 3. Shopee Ads 小时数据

适合：Product Ads / Shop Ads 页面小时级花费、曝光、点击、订单、GMV 等曲线数据。

项目：`E:\AI项目汇总\shopee-adspower-scraper`

当前已用逻辑：

1. 连接已打开 AdsPower Profile。
2. 筛选 Shopee Ads 页面：`/portal/marketing/pas/index`。
3. 优先捕获官方页面请求返回的 `report/get_time_graph`。
4. 如果没有捕获到网络响应，再读取 Vue chart `sourceData`。
5. 只接受带 `timestamp` 和关键业务指标的 rows。
6. 按站点本地时区聚合为 24 小时。
7. Shopee Ads 的 `cost` 展示值通常为 `cost / 100000`。

常用命令：

```powershell
cd E:\AI项目汇总\shopee-adspower-scraper
npm run export:ads-hourly -- --date 2026-07-07
npm run export:ads-hourly -- --watch --interval-ms 60000
```

输出：

```text
E:\AI项目汇总\shopee-adspower-scraper\exports\shopee_ads_hourly_<date>.csv
```

### 4. 图表 sourceData / hover 兜底

适合：Seller Center 图表数据只在 hover tooltip 或 canvas 图表中显示，但页面 Vue state 中仍能读取 sourceData。

项目：`E:\AI项目汇总\shopee-hover-data`

优先级：

1. Vue component `sourceData`
2. ECharts option
3. 受控 hover tooltip 截图

hover 只作为最后兜底；如果 sourceData 可用，不要做截图识别。

常用命令示例：

```powershell
node E:\AI项目汇总\shopee-hover-data\scripts\extract_shopee_chart_data.mjs --url "<SHOPEE_URL>" --date 2026-07-07 --metric cost
```

输出时必须标注：

- 日期和时区
- 指标名
- 来源：`sourceData` / `API response` / `tooltip`
- 是否隐藏未来小时或零值小时

### 5. Shopee Open Platform token 拉数

适合：订单、商品、店铺、库存等 Open Platform 正式支持的接口。

用户提供的 token env 文件属于私密凭证，只能放在本机安全目录，例如：

```text
D:\dingding\download\shopee_live_tokens_2038850_2026-07-16.env
```

该类 env 的结构通常包括：

- `SHOPEE_APP_ID`
- `SHOPEE_PARTNER_ID`
- `SHOPEE_SHOP_COUNT`
- 每个店铺的 `SHOP_ID`、`REGION`、`NAME`
- 每个店铺的 `ACCESS_TOKEN`、`REFRESH_TOKEN`、`ACCESS_TOKEN_EXPIRES_AT`

安全规则：

- 不把 env 文件复制进项目目录。
- 不提交 env、token、cookie、签名密钥。
- 日志只打印店铺 ID、国家、名称、过期时间，不打印 token 内容。
- access token 到期前先 refresh；refresh token 失效时停止并让用户重新授权。
- 只调用 Shopee Open Platform 官方文档支持的接口；不使用页面私有接口作为长期自动化依赖。

## 日期与完整性规则

- 用户要求“昨天或假期+假期前一天”时，只考虑中国假期；正常周一抓上周五到周日。
- Seller Center 数据以站点本地日期为准，不用系统 UTC 日期直接切片。
- 已下载文件复用优先级高于重复下载；按文件名识别数据日期，按文件修改时间识别是否为同日生成。
- 同日生成的“数据日期=文件修改日期”文件默认排除，因为平台 recheck 后第二天数据才更稳。
- 如果某天缺失，先只补缺失日期；补完后再统一生成最终汇总。

## 质量校验清单

每次交付前至少确认：

- 日期覆盖是否完整，缺失日期是否为 0。
- A 列是否为 `数据日期`。
- 日期是否升序。
- Sheet 是否只保留目标 Sheet。
- Product Performance 是否只保留 `Variation ID = "-"`。
- 印尼数字格式是否只在派生表清洗。
- 原始官方 Excel 是否未被改动。
- 输出文件路径、来源文件数量、行数、SHA-256 或审计 JSON 是否可追溯。

## 新项目复用建议

新项目接入 Shopee 拉数时，先按下面顺序判断：

1. 页面有官方 Export Data：接入 `shopee-official-excel-export`。
2. 页面只有图表/小时曲线：优先用 AdsPower CDP 读取网络响应或 `sourceData`。
3. 需要标准业务对象：优先用 Shopee Open Platform token。
4. 数据已进入 Google 总表：优先从 Google Sheets / CSV 导出读取，避免重复打开 Seller Center。

不要为每个国家、每个模块重写一套流程。国家、Profile、URL、下载目录、Sheet 名、文件名 hint 应配置化。
