# sncf_rapport — 教学旅行家长报告 PDF 开发计划

日期：2026-10-10 · 状态：**已按本计划实现 v0.1.0**（现状见 `docs/HANDOFF.md`；另外增加了 AI 生成教育意义文字的 enrich 步骤，见 ADR 0003） · 目标：**只做一件事 —— 把能拿到的数据变成一份 PDF。**

设计原则（来自产品建议）：出行前数据自动继承，出行后实况由教师确认，教育成果由教师评价，环境影响由系统计算。
本服务不做表单、不做教师界面、不发邮件、不碰上游数据库。输入是一份 JSON，输出是一份 PDF。

---

## 0. 现有数据盘点（已核实，2026-10-10）

| 需要的信息 | 来源 | 现状 |
| --- | --- | --- |
| 人数、出发站、去返日期时间、学科/主题 | sncf_chatbot `ConfirmedRequirements`（`packages/contracts/requirements.schema.json`） | ✅ 已有，`participants_breakdown{students, accompanying}` 可区分师生 |
| 目的地、车站、地点、活动、去返车次、时刻 | sncf_chatbot `Journey` / `TravelFile`（`journey.schema.json`、`travel_file.schema.json`，示例 `examples/travel_file.json` Toulouse→Carcassonne） | ✅ 已有；`TrainLeg.line` 只是标签，**无车次号**；全部为 `simulated: true` |
| 学校、班级、教师姓名 | — | ❌ chatbot 有意不采集 → 必须由教师确认表提供 |
| 实际完成情况、五项能力评价、教师评语 | — | ❌ 新数据 → 教师确认表提供 |
| 车站坐标 | sncf_events `var/share-v073/csv/stations.csv`（260 个奥克西塔尼车站，UIC 码 + 经纬度） | ✅ 仅奥克西塔尼大区 |
| 铁路相邻站段 | `~/Downloads/huawei/kit_hackathon_lio_18h/connections_occitanie.csv`（stop UIC 对 + 平均分钟） | ✅ 与 stations.csv 按 UIC 关联即可画线路图 |
| 参观地点坐标、官方链接、许可/署名 | sncf_events `/api/detail`、JSONL 导出（`latitude/longitude/canonical_url/license/attribution`） | ✅ 但 **无图片** |
| 事实级引用（出处、引文、抓取时间） | sncf_resultat `StoredFact` | ✅ 可选；三个模块 id 不互通（T001 gap D4） |
| CO₂ 排放因子 | — | ❌ 本机没有任何 ADEME / impactco2 数据，需下载 |
| 照片 | — | ❌ 只能由调用方随 JSON 提供 |
| PDF 渲染管线 | sncf_bilan `src/sncf_bilan/pdf/render.py`（WeasyPrint、A4 页脚、水印、macOS Pango 修正、字体） | ✅ 直接搬 |
| 品牌 | sncf_chatbot `docs/DESIGN.md`：navy `#0f2149` / red `#c90c0f` / yellow `#ffd500`，Barlow 字体 | ✅ 沿用，不加新色 |

结论：**10 项必需数据里 6 项来自 chatbot 的 travel_file，4 项（学校班级、教师名、实际人数、五项评价+确认）来自教师确认 JSON。** 线路图和 CO₂ 由本服务从上面的数据算出。

---

## 1. 范围

**做：**
1. 输入契约 `TripReportRequest`（Pydantic → JSON Schema，放 `contracts/`）。
2. 一个纯函数 `render_report(request) -> bytes`（HTML/Jinja2 → WeasyPrint）。
3. 派生计算：铁路路径 + 距离 + SVG 线路图；CO₂ 估算（含方法与来源说明）；五项能力图。
4. 一个组装脚本 `scripts/assemble.py travel_file.json teacher.json > request.json`，演示“继承行程 + 教师补 4 项”。
5. CLI 预览 `scripts/preview.py request.json`；一个 HTTP 端点 `POST /api/v1/render`（同步返回 PDF，`X-Rapport-Key` 鉴权）。
6. 测试、ruff、schema 导出校验、AGENTS.md、HANDOFF。

**不做（v1）：** 教师表单 UI、存储/幂等/重试、邮件发送（需要时交给 sncf_bilan + Mailato）、从 chatbot 数据库直读、历史资料图片（sncf_events 无图）、费用分担（无财务数据）。

---

## 2. 输入契约（`TripReportRequest`，schema_version "1.0"）

```
TripReportRequest
├── schema_version, locale ("fr")
├── school            { name, class_name, teacher_name }                      ← 教师表
├── trip                                                                      ← travel_file
│   ├── reference, title, date (出发日), return_date
│   ├── origin_station, destination_station, destination_city
│   ├── outbound { line, from_station, to_station, departure, arrival }
│   ├── return   { ... }
│   ├── planned_participants { total, students, accompanying }
│   └── simulated: bool
├── education                                                                  ← travel_file
│   ├── subject, theme, objectives: [str]
│   ├── places     [{ title, note, entity_id?, official_url?, lat?, lon?, license?, attribution? }]
│   └── activities [{ id, title, start?, end?, description? }]
├── teacher_feedback                                                           ← 教师表
│   ├── trip_completed: completed | partial | cancelled
│   ├── actual_participants { students, accompanying }
│   ├── activities_completed: all | partial | none
│   ├── completed_activity_ids: [str]
│   ├── changes: str?                      (临时变化)
│   ├── competencies: { savoir, savoir_faire, savoir_se_deplacer, savoir_s_orienter, savoir_etre }
│   │       每项 { status: acquis | partiel | non_evalue, comment?: str }
│   ├── observations: str?
│   └── validated_at: datetime
├── environment                                                                ← 可选覆盖
│   ├── baseline: autocar | voiture          (默认 autocar)
│   └── distance_km_override?: float         (调用方若有真实里程可覆盖)
├── media                                                                      ← 可选
│   └── photos [{ data_base64 | path, caption, taken_at?, consent: bool, kind: trip | documentary }]
└── sources                                                                    ← 可选
    └── [{ label, url, retrieved_at? }]     (sncf_resultat 的 StoredFact 可映射到这里)
```

规则：
- `consent != true` 的照片一律不渲染；`documentary` 与 `trip` 分区标注。
- `competencies.*.status == non_evalue` 渲染为“非évaluée”，绝不自动算达成。
- `trip.simulated` 为真时保留 sncf_bilan 的 “SIMULATION” 水印。
- 缺失的可选字段显示 « non communiqué »，报告仍必须能渲染（有一个全空示例作测试）。

---

## 3. 派生层（`ReportView`，PDF 只读这一层）

### 3.1 线路图与距离 `src/sncf_rapport/geo/`
- `data/stations.csv`、`data/connections.csv` 复制进仓库，附 `data/PROVENANCE.md`（stations 来自 sncf_events 的 STATION-SOURCE-NOTICE，connections 来自 liO 黑客松套件）。
- 站名 → UIC：规范化匹配（去重音、去 "Gare de"），找不到则返回 `None`。
- 路径：在 connections 图上以 `duration_min_mean` 为权重跑 Dijkstra；距离 = 路径各段 haversine 之和，标注为 « distance estimée »。
- SVG：等距投影，大区全网浅灰作底，所选路径 navy 加粗，起终点红点，参观地点（有坐标时）黄点；纯 Python 拼字符串，不引入制图库；WeasyPrint 直接渲染内联 SVG。
- 任一站不在数据集中 → 不画图，改为文字路线，并在“来源说明”里注明。

### 3.2 CO₂ `src/sncf_rapport/carbon/`
- `data/emission_factors.json`：`{ mode, g_co2e_per_pkm, source_name, source_url, version, retrieved_at }`。**数字不写死在代码里**，在 P3 由脚本 `scripts/fetch_factors.py` 从 impactco2.fr（ADEME Base Empreinte 的公开 API）拉取并落盘；离线时用已落盘文件。
- 公式：`diff = passengers × distance_km × 2 (往返) × (factor_baseline − factor_ter) / 1000` kg。passengers 取 `actual_participants` 总数。
- 输出三个数：铁路估算、基准估算、差值，以及一段固定的方法说明（基准、因子来源、版本、"estimation, non mesure"）。

### 3.3 能力图
- 五行，每行三格状态（acquis / partiel / non évaluée），纯 CSS；下方一句“评价为班级整体表现，不代表每位学生单独认证”。

---

## 4. PDF 版式（A4，法语）
1. 封面：liO · RAPPORT DE VOYAGE SCOLAIRE，“Notre voyage, nos apprentissages”，学校/班级/日期，三个大数字（实际学生数、5 个维度、CO₂ 差值）。
2. Parcours：线路图 + 去返车次表 + 参观地点。
3. Ce que nous avons fait：计划 vs 实际完成的活动、临时变化、教师评语。
4. Compétences développées：五项能力图 + 每项评语。
5. Notre impact：CO₂ 对比卡片 + 方法说明。
6. Photos（有且授权时）。
7. Sources et validation：官方链接、车站/线路数据来源、排放因子来源、教师确认日期、simulated 提示。
页脚：页码、生成时间、« Document établi à partir des informations confirmées par l'enseignant·e »。

---

## 5. 技术栈与仓库结构
Python 3.13 + uv（同 sncf_bilan）；fastapi、pydantic v2、jinja2、weasyprint；dev：pytest、httpx、pypdf、ruff。不加制图库。

```
sncf_rapport/
├── AGENTS.md  README.md  pyproject.toml
├── src/sncf_rapport/
│   ├── models.py        (TripReportRequest 等)
│   ├── view.py          (ReportView，唯一取值层)
│   ├── geo/ {stations.py, route.py, svg.py}
│   ├── carbon/ {factors.py, estimate.py}
│   ├── pdf/ {render.py, report.html.j2, report.css}   ← 从 sncf_bilan 搬
│   ├── assemble.py      (travel_file + teacher → request)
│   ├── api.py  config.py
├── contracts/ {trip_report_request.schema.json, examples/}
├── data/ {stations.csv, connections.csv, emission_factors.json, PROVENANCE.md}
├── assets/ {fonts/, brand/}
├── scripts/ {preview.py, assemble.py, fetch_factors.py, export_schema.py}
├── tests/
└── docs/ {PLAN.zh-CN.md, HANDOFF.md, ADR/}
```

---

## 6. 实施步骤（按依赖分组，P2/P3/P4 可并行派 agent）

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 脚手架 | uv 项目、AGENTS.md（英文仓库/法语产出、hands-off 四个兄弟仓库、不自动 commit）、复制 sncf_bilan 的 render.py/CSS/字体/config、`data/` + PROVENANCE | `uv run pytest` 跑空套件通过 |
| P1 契约 | `models.py`、`export_schema.py`、示例：`01-carcassonne-complet.json`（由 chatbot 的 travel_file.json 组装）、`02-minimal-tout-vide.json`、`03-hors-occitanie.json`、`90-invalide-*` | schema `--check` 通过；无效示例被拒 |
| P2 geo | 站名匹配、Dijkstra、距离、SVG | Toulouse→Carcassonne 路径经过预期站点；距离在合理区间；SVG 可渲染 |
| P3 carbon | `fetch_factors.py` + `estimate.py` | 因子文件含来源与日期；估算有单元测试；无因子文件时报告显示“非disponible”而不崩 |
| P4 版式 | `report.html.j2` + `report.css` + `view.py` | 三个示例都能渲染；pypdf 抽文本校验关键字段、页数、水印、照片数 |
| P5 入口 | `assemble.py`、`preview.py`、`api.py` `POST /api/v1/render` | httpx 测试：鉴权、422、PDF content-type |
| P6 门禁 | `ruff check && ruff format --check && pytest && export_schema --check` | 全绿 |
| P7 交接 | README、HANDOFF、ADR（借用 bilan 管线、不用制图库、因子外置） | 可由另一 agent 按 HANDOFF 续做 |

---

## 7. 已定决策（2026-10-10，用户）
1. **所有字段均可选。** “必需 10 项”只是产品层面的建议；契约里任何字段缺失都不得拒绝请求，报告以 « non communiqué » 渲染。原因：本模块之后交给他人合并进团队仓库，上游字段名和可得性未定。`README.md` 和 `docs/INTEGRATION.md` 必须向合并者明确列出“哪些字段缺了报告会明显变差”。
2. **CO₂ 基准：autocar + voiture 两个都给。**
3. **Logo：SNCF Voyageurs**（与 sncf_bilan 相同文件和 PROVENANCE 条款；真实文件不进公共仓库）。
4. 字体：直接复用 sncf_bilan 的 Source Sans 3（省去下载）。
5. sncf_resultat：只预留 `sources[]`，不调 API。邮件：v1 不发。
