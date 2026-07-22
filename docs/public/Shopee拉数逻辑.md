# Shopee 鎷夋暟閫昏緫

閫傜敤鑼冨洿锛氭墍鏈夐渶瑕佷粠 Shopee Seller Center銆丼hopee Ads銆丼hopee 瀹樻柟 Excel銆丼hopee Open Platform銆丟oogle 鎬昏〃绛夋潵婧愬彇鏁扮殑椤圭洰銆?
鏈枃鍙矇娣€璺ㄩ」鐩€氱敤瑙勫垯銆傚叿浣撹剼鏈粛鏀惧湪鍚勯」鐩洰褰曞唴銆?
## 鎬诲師鍒?
- 浼樺厛浣跨敤瀹樻柟銆佸彲澶嶉獙鐨勬暟鎹嚭鍙ｏ細Seller Center 瀹樻柟 Excel銆丼hopee Open Platform銆丟oogle 鎬昏〃銆佸凡鐧诲綍椤甸潰涓殑鍙涓氬姟鏁版嵁銆?- 涓嶅弽鎺ㄧ鏈夋帴鍙ｏ紝涓嶆妸 token銆乧ookie銆乤ccess token銆乺efresh token 鍐欏叆 docs銆佷唬鐮併€佹棩蹇楁垨鎻愪氦璁板綍銆?- 鍘熷涓嬭浇鏂囦欢鍙繚瀛橈紝涓嶄慨鏀广€傛墍鏈夌瓫閫夈€佹牸寮忚浆鎹€佸瓧娈垫竻娲楅兘鍦ㄦ淳鐢熸眹鎬昏〃涓畬鎴愩€?- 姣忔鎷夋暟閮借淇濈暀鏉ユ簮淇℃伅锛氬浗瀹躲€佺珯鐐广€佽处鍙?Profile銆佹ā鍧椼€佹棩鏈熻寖鍥淬€佹潵婧愭枃浠舵垨椤甸潰 URL銆佺敓鎴愭椂闂淬€佺己澶辨棩鏈熴€佹帓闄ゅ師鍥犮€?- 鏃ユ湡鍙ｅ緞鎸夌珯鐐规湰鍦版椂闂村鐞嗭細ID=Asia/Jakarta锛孧Y=Asia/Kuala_Lumpur锛孴H=Asia/Bangkok銆?- Seller Center 鐨勬槰鏃ユ暟鎹€氬父闇€瑕佹鏃?recheck 鍚庢墠绋冲畾銆傝嫢鏂囦欢淇敼鏃ユ湡涓庢暟鎹棩鏈熸槸鍚屼竴澶╋紝榛樿鎺掗櫎锛岀瓑绗簩澶╅噸鏂版媺鍙栥€?
## 鎷夋暟鏂瑰紡浼樺厛绾?
### 1. 瀹樻柟 Excel 瀵煎嚭

閫傚悎锛歅roduct Performance銆乂oucher銆佷互鍙?Seller Center 椤甸潰鏈韩鎻愪緵 Export Data 鐨勬ā鍧椼€?
椤圭洰锛歚E:\AI椤圭洰姹囨€籠shopee-official-excel-export`

鏍稿績娴佺▼锛?
1. 閫氳繃 AdsPower Local API 鑾峰彇宸叉墦寮€ Profile銆?2. 鎸?Profile 鏄犲皠鍥藉锛歚kyme0da=ID`锛宍k14di2tc=MY`锛宍k16ggegy=TH`銆?3. 浣跨敤 Playwright CDP 杩炴帴宸茬櫥褰曟祻瑙堝櫒銆?4. 鑻ョ洰鏍囬〉鏈墦寮€锛屼紭鍏堢敤閰嶇疆閲岀殑鐩爣 URL 鍦ㄥ搴?Profile 涓墦寮€锛屼笉瑕佹眰鐢ㄦ埛鎻愬墠鎵撳紑椤甸潰銆?5. 鍙仛蹇呰椤甸潰鎿嶄綔锛氭墦寮€鐩爣椤甸潰銆侀€夋嫨鏃ユ湡銆佺偣鍑诲畼鏂?Export Data銆丩atest Reports/Download銆?6. 鍚屼竴鍥藉+妯″潡閬靛畧骞冲彴瀵煎嚭闄愬埗锛欵xport Data 闂撮殧鎸夌害 60s 鎺у埗锛涙姤琛ㄦ湭鐢熸垚鏃舵寜绾?10s 閲嶈瘯锛屼笉鍋氬ぇ瑙勬ā debug銆?7. 涓嬭浇鏂囦欢鍏堟寜 Playwright download event 鎺ユ敹锛涘け璐ユ椂鍙湪瀵瑰簲 Profile 涓嬭浇鐩綍鏌ユ壘锛岄伩鍏嶈法鍥藉/妯″潡涓叉枃浠躲€?8. 澶氭棩 Product Performance 鎸?By Day 鍗曟棩鎷嗗垎锛屼繚瀛樻瘡涓畼鏂?Excel锛屽啀鐢熸垚娲剧敓姹囨€汇€?
甯哥敤鍛戒护锛?
```powershell
node "E:\AI椤圭洰姹囨€籠shopee-official-excel-export\scripts\shopee-export.mjs" --approved-real-export "Thailand Product Performance: 2026/06/01~2026/07/16"
```

杈撳嚭瑙勫垯锛?
- 鍘熷鏂囦欢锛歚D:\Shopee Export\<Country>\<Module>\...`
- 璺ㄥ浗姹囨€伙細`D:\Shopee Export\Combined\<Module>\...`
- 鏈€缁堟眹鎬诲懡鍚嶏細`鍥藉1_鍥藉2_鏁版嵁鏉垮潡_鏁版嵁鏃堕棿娈?xlsx`锛屼緥濡?`TH_product performance_260601-260716.xlsx`銆?- Product Performance 鏈€缁堣〃鍙繚鐣?`Top Performing Products`锛孉 鍒椾负 `鏁版嵁鏃ユ湡`锛屾棩鏈熷崌搴忥紝鍙繚鐣?`Variation ID = "-"`銆?- Voucher 鏈€缁堣〃鍙繚鐣?`Performance List`锛孉 鍒椾负 `鏁版嵁鏃ユ湡`锛屾棩鏈熷崌搴忋€?- 鍗板凹瀹樻柟琛ㄧ殑鏁板瓧娓呮礂鍙湪鏈€缁堟淳鐢熻〃涓仛锛氬厛鍘婚櫎 `.`锛屽啀鎶?`,` 鏇挎崲涓?`.`锛屽師濮?Excel 涓嶆敼銆?
宸查獙璇佺珯鐐逛笌鐩綍锛?
| 鍥藉 | Profile | Product Performance | Voucher | 涓嬭浇鍏滃簳鐩綍 |
|---|---|---|---|---|
| ID | `kyme0da` | `seller.shopee.co.id/datacenter/product/performance` | `seller.shopee.co.id/datacenter/marketing/voucher` | `D:\adspower涓嬭浇-39` |
| MY | `k14di2tc` | `seller.shopee.com.my/datacenter/product/performance` | `seller.shopee.com.my/datacenter/marketing/voucher` | `D:\adspower涓嬭浇-43` |
| TH | `k16ggegy` | `seller.shopee.co.th/datacenter/product/performance` | `seller.shopee.co.th/datacenter/marketing/voucher` | `D:\adspower涓嬭浇-44` |

璋冭瘯杈圭晫锛?
- 椤甸潰宸查娆¤瘑鍒垚鍔熷悗锛屽悗缁悓妯″潡鏃ユ湡浼樺厛澶嶇敤宸茬‘璁ら〉闈笌鎿嶄綔璺緞銆?- 鎵句笉鍒伴〉闈㈡垨璧勬簮鏃讹紝鎻愮ず鐢ㄦ埛纭椤甸潰鏄惁宸茬櫥褰?宸叉墦寮€锛屾垨鏄惁闇€瑕佷慨鏀归渶姹傝寖鍥淬€?- 涓嶅奖鍝嶄富娴佺▼鐨?debug 寤跺悗澶勭悊锛涗笉瑕佸湪姣忔鎶ヨ〃鏈敓鎴愭椂灞曞紑澶ц妯℃鏌ャ€?
### 2. AdsPower CDP 鍙璇诲彇

閫傚悎锛氶渶瑕佹鏌ュ凡鎵撳紑 Seller Center 椤甸潰銆佽鍙栧彲瑙佽〃鏍笺€佹憳瑕佸崱鐗囥€乂ue chart sourceData銆丒Charts option 鐨勫満鏅€?
椤圭洰锛歚E:\AI椤圭洰姹囨€籠shopee-adspower-scraper`

鍘熷垯锛?
- 鍙繛鎺ュ凡鎵撳紑 AdsPower 娴忚鍣ㄣ€?- 涓嶆墦寮€鏂版祻瑙堝櫒锛屼笉鐧诲綍锛屼笉鐐瑰嚮锛屼笉杈撳叆锛屼笉瀵艰埅锛屼笉鎴浘锛屼笉 hover锛岄櫎闈炲綋鍓嶄换鍔℃槑纭厑璁搞€?- 鍗曚釜 Profile 鎴?Tab 澶辫触鏃跺彧璁板綍璇ュけ璐ワ紝涓嶉樆鏂叾浠?Profile銆?- 浼樺厛杩囨护鍑轰笟鍔℃暟鎹紝閬垮厤閬嶅巻 Vue/ECharts 鍐呴儴鍝嶅簲寮忓璞￠€犳垚鍣０鍜屾€ц兘鍘嬪姏銆?
甯哥敤鍛戒护锛?
```powershell
cd E:\AI椤圭洰姹囨€籠shopee-adspower-scraper
npm run inspect
node .\scripts\inspect-current-seller-center.mjs --profile-id kyme0da --json
```

### 3. Shopee Ads 灏忔椂鏁版嵁

閫傚悎锛歅roduct Ads / Shop Ads 椤甸潰灏忔椂绾ц姳璐广€佹洕鍏夈€佺偣鍑汇€佽鍗曘€丟MV 绛夋洸绾挎暟鎹€?
椤圭洰锛歚E:\AI椤圭洰姹囨€籠shopee-adspower-scraper`

褰撳墠宸茬敤閫昏緫锛?
1. 杩炴帴宸叉墦寮€ AdsPower Profile銆?2. 绛涢€?Shopee Ads 椤甸潰锛歚/portal/marketing/pas/index`銆?3. 浼樺厛鎹曡幏瀹樻柟椤甸潰璇锋眰杩斿洖鐨?`report/get_time_graph`銆?4. 濡傛灉娌℃湁鎹曡幏鍒扮綉缁滃搷搴旓紝鍐嶈鍙?Vue chart `sourceData`銆?5. 鍙帴鍙楀甫 `timestamp` 鍜屽叧閿笟鍔℃寚鏍囩殑 rows銆?6. 鎸夌珯鐐规湰鍦版椂鍖鸿仛鍚堜负 24 灏忔椂銆?7. Shopee Ads 鐨?`cost` 灞曠ず鍊奸€氬父涓?`cost / 100000`銆?
甯哥敤鍛戒护锛?
```powershell
cd E:\AI椤圭洰姹囨€籠shopee-adspower-scraper
npm run export:ads-hourly -- --date 2026-07-07
npm run export:ads-hourly -- --watch --interval-ms 60000
```

杈撳嚭锛?
```text
E:\AI椤圭洰姹囨€籠shopee-adspower-scraper\exports\shopee_ads_hourly_<date>.csv
```

### 4. 鍥捐〃 sourceData / hover 鍏滃簳

閫傚悎锛歋eller Center 鍥捐〃鏁版嵁鍙湪 hover tooltip 鎴?canvas 鍥捐〃涓樉绀猴紝浣嗛〉闈?Vue state 涓粛鑳借鍙?sourceData銆?
椤圭洰锛歚E:\AI椤圭洰姹囨€籠shopee-hover-data`

浼樺厛绾э細

1. Vue component `sourceData`
2. ECharts option
3. 鍙楁帶 hover tooltip 鎴浘

hover 鍙綔涓烘渶鍚庡厹搴曪紱濡傛灉 sourceData 鍙敤锛屼笉瑕佸仛鎴浘璇嗗埆銆?
甯哥敤鍛戒护绀轰緥锛?
```powershell
node E:\AI椤圭洰姹囨€籠shopee-hover-data\scripts\extract_shopee_chart_data.mjs --url "<SHOPEE_URL>" --date 2026-07-07 --metric cost
```

杈撳嚭鏃跺繀椤绘爣娉細

- 鏃ユ湡鍜屾椂鍖?- 鎸囨爣鍚?- 鏉ユ簮锛歚sourceData` / `API response` / `tooltip`
- 鏄惁闅愯棌鏈潵灏忔椂鎴栭浂鍊煎皬鏃?
### 5. Shopee Open Platform token 鎷夋暟

閫傚悎锛氳鍗曘€佸晢鍝併€佸簵閾恒€佸簱瀛樼瓑 Open Platform 姝ｅ紡鏀寔鐨勬帴鍙ｃ€?
鐢ㄦ埛鎻愪緵鐨?token env 鏂囦欢灞炰簬绉佸瘑鍑瘉锛屽彧鑳芥斁鍦ㄦ湰鏈哄畨鍏ㄧ洰褰曪紝渚嬪锛?
```text
<LOCAL_SECURE_TOKEN_ENV_PATH>
```

璇ョ被 env 鐨勭粨鏋勯€氬父鍖呮嫭锛?
- `SHOPEE_APP_ID`
- `SHOPEE_PARTNER_ID`
- `SHOPEE_SHOP_COUNT`
- 姣忎釜搴楅摵鐨?`SHOP_ID`銆乣REGION`銆乣NAME`
- 姣忎釜搴楅摵鐨?`ACCESS_TOKEN`銆乣REFRESH_TOKEN`銆乣ACCESS_TOKEN_EXPIRES_AT`

瀹夊叏瑙勫垯锛?
- 涓嶆妸 env 鏂囦欢澶嶅埗杩涢」鐩洰褰曘€?- 涓嶆彁浜?env銆乼oken銆乧ookie銆佺鍚嶅瘑閽ャ€?- 鏃ュ織鍙墦鍗板簵閾?ID銆佸浗瀹躲€佸悕绉般€佽繃鏈熸椂闂达紝涓嶆墦鍗?token 鍐呭銆?- access token 鍒版湡鍓嶅厛 refresh锛況efresh token 澶辨晥鏃跺仠姝㈠苟璁╃敤鎴烽噸鏂版巿鏉冦€?- 鍙皟鐢?Shopee Open Platform 瀹樻柟鏂囨。鏀寔鐨勬帴鍙ｏ紱涓嶄娇鐢ㄩ〉闈㈢鏈夋帴鍙ｄ綔涓洪暱鏈熻嚜鍔ㄥ寲渚濊禆銆?
## 鏃ユ湡涓庡畬鏁存€ц鍒?
- 鐢ㄦ埛瑕佹眰鈥滄槰澶╂垨鍋囨湡+鍋囨湡鍓嶄竴澶┾€濇椂锛屽彧鑰冭檻涓浗鍋囨湡锛涙甯稿懆涓€鎶撲笂鍛ㄤ簲鍒板懆鏃ャ€?- Seller Center 鏁版嵁浠ョ珯鐐规湰鍦版棩鏈熶负鍑嗭紝涓嶇敤绯荤粺 UTC 鏃ユ湡鐩存帴鍒囩墖銆?- 宸蹭笅杞芥枃浠跺鐢ㄤ紭鍏堢骇楂樹簬閲嶅涓嬭浇锛涙寜鏂囦欢鍚嶈瘑鍒暟鎹棩鏈燂紝鎸夋枃浠朵慨鏀规椂闂磋瘑鍒槸鍚︿负鍚屾棩鐢熸垚銆?- 鍚屾棩鐢熸垚鐨勨€滄暟鎹棩鏈?鏂囦欢淇敼鏃ユ湡鈥濇枃浠堕粯璁ゆ帓闄わ紝鍥犱负骞冲彴 recheck 鍚庣浜屽ぉ鏁版嵁鎵嶆洿绋炽€?- 濡傛灉鏌愬ぉ缂哄け锛屽厛鍙ˉ缂哄け鏃ユ湡锛涜ˉ瀹屽悗鍐嶇粺涓€鐢熸垚鏈€缁堟眹鎬汇€?
## 璐ㄩ噺鏍￠獙娓呭崟

姣忔浜や粯鍓嶈嚦灏戠‘璁わ細

- 鏃ユ湡瑕嗙洊鏄惁瀹屾暣锛岀己澶辨棩鏈熸槸鍚︿负 0銆?- A 鍒楁槸鍚︿负 `鏁版嵁鏃ユ湡`銆?- 鏃ユ湡鏄惁鍗囧簭銆?- Sheet 鏄惁鍙繚鐣欑洰鏍?Sheet銆?- Product Performance 鏄惁鍙繚鐣?`Variation ID = "-"`銆?- 鍗板凹鏁板瓧鏍煎紡鏄惁鍙湪娲剧敓琛ㄦ竻娲椼€?- 鍘熷瀹樻柟 Excel 鏄惁鏈鏀瑰姩銆?- 杈撳嚭鏂囦欢璺緞銆佹潵婧愭枃浠舵暟閲忋€佽鏁般€丼HA-256 鎴栧璁?JSON 鏄惁鍙拷婧€?
## 鏂伴」鐩鐢ㄥ缓璁?
鏂伴」鐩帴鍏?Shopee 鎷夋暟鏃讹紝鍏堟寜涓嬮潰椤哄簭鍒ゆ柇锛?
1. 椤甸潰鏈夊畼鏂?Export Data锛氭帴鍏?`shopee-official-excel-export`銆?2. 椤甸潰鍙湁鍥捐〃/灏忔椂鏇茬嚎锛氫紭鍏堢敤 AdsPower CDP 璇诲彇缃戠粶鍝嶅簲鎴?`sourceData`銆?3. 闇€瑕佹爣鍑嗕笟鍔″璞★細浼樺厛鐢?Shopee Open Platform token銆?4. 鏁版嵁宸茶繘鍏?Google 鎬昏〃锛氫紭鍏堜粠 Google Sheets / CSV 瀵煎嚭璇诲彇锛岄伩鍏嶉噸澶嶆墦寮€ Seller Center銆?
涓嶈涓烘瘡涓浗瀹躲€佹瘡涓ā鍧楅噸鍐欎竴濂楁祦绋嬨€傚浗瀹躲€丳rofile銆乁RL銆佷笅杞界洰褰曘€丼heet 鍚嶃€佹枃浠跺悕 hint 搴旈厤缃寲銆?
