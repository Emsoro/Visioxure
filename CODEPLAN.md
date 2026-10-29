# Visioxure · Code Plan（v2 · 实现核对修订版）

> Visio + Axure 结合体：Visio 式图形绘制与连接线，Axure 式交互原型；保存为 `.vsdx`，可导出 **HTML / PNG / PDF / SVG**；元素可配置 **注释 / 链接 / 脚本**；支持图片、多页面树、组件库（母版+实例）、迭代器（Repeater）、组合/解组与布尔运算（联合/相交/剪除）。
>
> **本版说明**：2026-10-29 对仓库 v1.0.0（commit `37dfae3`）逐模块核对后重写。§2 架构改为「实际落地结构」，§6 用 ✅/◐/⬜ 标注完成度，§7 把缺失功能按重要程度重新排队。原计划中「待建但从未创建」的目录（`src/document.*`、`src/exporter.*`、`frontend/js/panels/`、`frontend/js/tools/`、`frontend/js/export/`）已从架构图中移除，改为「目标结构」表格中的规划项。

---

## 0. 核对结论（一句话版）

**P0–P5 已完整落地可用（含 S2 属性面板），P6（导出）零代码，P7（打磨）未开始。**
当前产品是「能画流程图、能读写 Visio 文件、能跑原型、属性能精确编辑的编辑器」，但**还交不出去**——没有任何导出能力。

> **2026-10-29 增量**：S2 属性面板已交付（新增 `frontend/js/props.js`），同时修正了三个相关缺陷：面板输入框屏蔽全局快捷键导致 Ctrl+Z 失效、撤销/重做丢失当前页与选中、右侧 6 个 Tab 折行。另修正 `37dfae3` 引入的回归：渲染器改为「有填充才闭合」后，形状库的透明填充多边形（三角形/梯形/菱形/箭头）缺一条闭合边，现改为由 `path.closed[]` 显式声明开合。验收改为 Playwright 脚本化（`test/e2e/`，一条命令跑完 56 项断言），不再依赖人工截图识别。

计划与实际的 4 处架构偏差：

| 偏差 | 计划 | 实际 | 影响 |
|---|---|---|---|
| 后端文档模型 | `src/document.hpp/.cpp`（JSON 校验/迁移） | 不存在；校验仅在前端 `Model.load`（只查 `format`） | 版本迁移无落点，坏文件靠前端 try/catch |
| 导出层 | `frontend/js/export/{html,svg,pdf}.js` + `src/exporter.*` | 不存在 | P6 全部待做，架构需按现状重设计（见 §7-S1） |
| 前端目录 | `panels/`、`tools/`、`images.js`、`library.js`、`canvas/{handles,ruler}.js` | 扁平 21 个文件；手柄在 `overlay.js`+`tools.js`，标尺在 `overlay.js` | 目录更扁平，可维护性尚可，不强求拆分 |
| Bridge | 9 条（含 `export.write`、`app.close_confirm`） | 10 条（多了 `bridge.test`/`app.get_info`/`app.open_url`，缺 `export.write`/`app.close_confirm`） | 导出与关窗拦截无后端入口 |

---

## 1. 产品定位

- 目标用户：画流程图 / 线框原型 / 交付说明的中文桌面用户。
- 与 Visio 的关系：**读**要能吃真实 Visio 文件（已达成），**写**要能被 Visio 打开（已达成），不追求母版/主题的完全互操作（见 §9 风险）。
- 与 Axure 的关系：交互原型运行时（事件→动作、动态面板、三级变量、中继器）在编辑预览与导出页共用一套 `interact.js`。

---

## 2. 实际架构

```
┌────────────────────────── Visioxure.exe（单文件）──────────────────────────┐
│ 前端（WebView2，编译期嵌入）                        后端（C++17 / TauriCPP）    │
│  ┌────────────────────────────┐    invoke(cmd)   ┌───────────────────────┐  │
│  │ model.js  文档 JSON（唯一事实源）│ ──────────────► │ main.cpp 命令表         │  │
│  │ renderer.js  Canvas 2D 渲染    │                  │ vsdx/package   OPC zip │  │
│  │ tools.js   选择/变换/连线/文本   │ ◄────────────── │ vsdx/writer    JSON→XML│  │
│  │ editor.js  输入/快捷键/面板胶水  │   emit(event)    │ vsdx/reader    XML→JSON│  │
│  │ interact.js 交互运行时（预览/导出共用）│           │ 最近文件 / 原生对话框    │  │
│  └────────────────────────────┘                  └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

**职责边界（已落地，不再调整）**

- 前端：文档模型、渲染、命中、工具、布线、面板、交互运行时、**导出产物生成（待做）**。
- 后端：无状态。只做 `.vsdx` 编解码、原生对话框、最近文件、标题、写盘（待加 `export.write`）。
- 数据交换：`vsdx.save {path, doc}` / `vsdx.load {path} → {doc, warnings}`，格式即 §3 的 JSON。

**实际模块清单（21 个前端文件 / 9 个后端文件）**

| 层 | 文件 | 职责 |
|---|---|---|
| 模型 | `frontend/js/model.js` | 文档 JSON、页面/形状/组合/布尔/对齐/图层、事件总线 `VX.Events` |
| 模型 | `frontend/js/history.js` | 快照式 undo/redo，上限 200 步，拖拽事务 `begin/commit` |
| 几何 | `frontend/js/geometry.js` | 形状→多边形环、Clipper 布尔、旋转辅助 |
| 布线 | `frontend/js/routing.js` | 4 连接点锚定、直线/正交/曲线/手动折线、命中距离；纯函数 |
| 渲染 | `frontend/js/canvas/renderer.js` | `drawScene`、形状/文本换行/虚线/箭头字形、`invalidate` 脏标记 |
| 渲染 | `frontend/js/canvas/overlay.js` | 选区手柄、连接点、对齐线、标尺绘制 |
| 渲染 | `frontend/js/canvas/hit.js` | 命中测试（AABB/旋转/线段/参考线），图层显隐锁定过滤 |
| 交互 | `frontend/js/tools.js` | 选择/创建/文本/连接线工具、吸附、就地编辑、端点与线段拖拽 |
| 交互 | `frontend/js/editor.js` | 画布鼠标、快捷键、页面树、排列工具条、图层面板、参考线 |
| 面板 | `props.js` / `style.js` / `inspect.js` / `meta.js` / `page.js` / `colorpicker.js` / `stencils.js` | 属性（几何+文本样式）/ 线条样式 / 交互 / 注释 / 页面 / 调色板 / 形状库 |
| 运行时 | `interact.js` + `preview.js` | 事件→动作、变量作用域、动画、F5 全屏预览 |
| IO | `fileio.js` + `app.js` | Bridge 封装、新建/打开/保存、最近文件、菜单、快捷键 |
| 后端 | `src/main.cpp` | 窗口 + 10 条 Bridge 命令 + 最近文件 |
| 后端 | `src/vsdx/{package,reader,writer,xml}.cpp` | OPC 包、VisioML 读写、XML 轻量解析 |

**目标结构（仅列尚未创建、且已确认要做的）**

```
frontend/js/export/html.js    # 文档 → 自包含 HTML（交互运行时内联）
frontend/js/export/svg.js     # 形状 → SVG（HTML 导出与独立 .svg 共用）
frontend/js/export/pdf.js     # 极简 PDF writer（JPEG + DCTDecode）
frontend/js/images.js         # 图片资产：导入/hash 去重/SVG 尺寸探测
frontend/js/library.js        # 组件库（母版/实例/解除链接/环检测）
src/exporter.cpp              # export.write：写文件夹 / miniz 打 zip
```

> `frontend/js/props.js` 已从本表移入上表（S2 已实现）。

---

## 3. 内部文档模型（以 `model.js` 实际字段为准）

```jsonc
{
  "format": "visioxure", "version": 1,
  "doc": { "theme": "light", "variables": [ { "name": "username", "default": "guest" } ] },  // ✅ 已实现
  "pages": [{
    "id": "p1", "name": "页面-1",
    "size": { "mode": "fixed", "w": 800, "h": 1100, "orientation": "portrait" },  // ✅ fixed；◐ autoHeight/auto 仅占位
    "background": "#FFFFFF",           // ✅ 随 vsdx PageSheet.FillForegnd 往返
    "variables": [],                   // ✅ 页面变量
    "layers": [ { "id": "l1", "name": "默认", "visible": true, "locked": false } ],  // ✅
    "guides": [ { "dir": "v", "pos": 120 } ],   // ◐ 仅内存，未写入 vsdx
    "shapes": [{
      "id": "s1", "type": "rect",      // ✅ rect|ellipse|text|path|connector|group|panel|image(未实现)|instance(未实现)|repeater(未实现)
      "x": 100, "y": 80, "w": 200, "h": 48, "angle": 0, "z": 3, "layer": "l1", "lock": false,
      "style": { "fill": "#4A90D9", "line": "#2B6CB0", "lineWidth": 1.5, "cornerRadius": 6, "opacity": 1,
                 "dash": "dash", "linePattern": 2,          // ✅ 新增：虚线（Visio LinePattern 映射）
                 "arrowBeginKind": "none", "arrowEndKind": "arrow",   // ✅ 7 种字形 + 尺寸档
                 "arrowBeginType": 0, "arrowEndType": 4,
                 "font": { "family": "Segoe UI", "size": 14, "color": "#333333", "bold": false,
                           "align": "left", "vAlign": "top" } },
      "text": "登录",
      "path": { "subpaths": [ [ { "x": 0, "y": 0 } ] ], "fillRule": "evenodd", "closed": [true] },  // ✅ 布尔结果/自由路径；closed 可选，缺省=全闭合
      "panel": { "states": [ { "id": "st1", "name": "状态 1", "shapes": [] } ], "active": "st1" },  // ✅
      "glue": { "begin": "s0:3", "end": "s1:0" },   // ✅ 锚点序号 0=上 1=右 2=下 3=左
      "route": "ortho",                             // ✅ straight|ortho|curve|manual
      "points": [ { "x": 0, "y": 0 } ],             // ✅ route=manual 时的用户折线
      "meta": { "notes": "…", "links": [ { "label": "文档", "url": "https://…" } ],
                "scripts": [ { "name": "校验", "event": "click", "code": "…" } ] },   // ✅
      "interactions": [ { "event": "click", "actions": [ { "type": "openLink", "target": "p2" } ] } ]  // ✅
    }]
  }]
}
```

**尚未进入模型的字段**：`assets[]`（图片资产）、`library[]` + `instance`、`repeater`、`size.mode: autoHeight/auto`。`version` 存在但**没有迁移函数**——目前只做 `format` 校验。

---

## 4. VSDX 实现映射（核对后）

| 内部字段 | VisioML | 状态 |
|---|---|---|
| x/y/w/h | `PinX/PinY/Width/Height`（英寸） | ✅ 含负宽高（1-D 反向）与 `LocPin` 换算 |
| angle | `Angle`（弧度） | ✅ |
| 坐标系 | Visio 原点左下、Y 向上 | ✅ 双向翻转（`pageH - y - h/2`） |
| fill/line/线宽 | `FillForegnd/LineColor/LineWeight` | ✅ 含索引色 palette 解析 |
| 虚线 | `LinePattern` 2/3/4/5 | ✅ → `style.dash` |
| 箭头 | `BeginArrow/EndArrow` 0~45 | ✅ 11=实心方块、22=空心菱形等；写回同号 |
| 文本 | `Text` + `Character/Paragraph` | ✅ 单段落；多段落/富文本 ⬜ |
| 矩形/椭圆/路径 | `Geometry` Section | ✅ 含 `Rel*` 相对行、`Del="1"` 删行 |
| 圆弧 | `ArcTo`（A=弓高）/`EllipticalArcTo`（A/B=弧上点） | ✅ 三点定圆 + 15° 采样（圆角矩形、开始/结束胶囊） |
| 连接线 | 1-D 形状 + 页面 `Connects/Connect` | ✅ 端点粘附 + `VXRoute/VXBegin*` 手写折线 |
| 组合 | 原生 `Shape` 嵌套 | ✅ 读原生组合；写为独立形状 + `VXGroup` 链 |
| 图层 | `LayerMember` | ✅ 下标即图层序号 |
| 背景页 | `BackPage` | ✅ 读取时跳过 |
| 母版 | `Masters/Master` | ✅ 读取时合并几何/样式（⚠ 保存时不产生母版） |
| 样式继承 | `StyleSheets` + `F="Inh"` | ✅ 线/填充/文本三组继承 |
| 注释/链接/脚本 | `User` 段 `VXNotes/VXLinks/VXScripts` | ✅ 往返保真；Visio 原生 `Annotation`/`Hyperlink` 段 ⬜ |
| 交互/面板状态/变量 | `User` 段 `VXInteractions/VXPanel/VXVars/VXGlobalVars` | ✅ |
| 图片 | `Foreign` + `ForeignData` + `visio/media/*` | ⬜ 读写均未实现 |
| 页面参考线 | （无对应映射） | ⬜ `guides` 保存后丢失 |
| 主题 | `document.xml` 主题色 | ◐ 仅解析索引色，未解析 `THEME(...)` 名 |

**兼容承诺（保持）**：写入合法 vsdx（Visio 可打开）；读取真实 Visio 文件（母版合并、相对几何、1-D、圆弧）；不承诺母版/主题的写回保真。

---

## 5. Bridge 命令（`src/main.cpp` 实际 10 条）

```cpp
bridge.test          // 连通性自检（返回 pong + 版本）
app.set_title        // 标题 + 未保存标记
app.get_info         // 版本 / 平台
app.open_url         // 系统浏览器打开（品牌链接）
file.open_dialog     // 原生打开
file.save_dialog     // 原生保存
vsdx.save            // {path, doc} JSON→VSDX（含最近文件）
vsdx.load            // {path} → {doc, warnings}
app.recent_files     // get / push / clear
log_error            // 前端诊断
```

**缺失**：`export.write`（导出落盘/打 zip）、`app.close_confirm`（关窗拦截）。后端无定时 Emit（沿用现状）。

---

## 6. 功能完成度总表

图例：✅ 完成可用 · ◐ 部分实现/有已知缺口 · ⬜ 未开始

### 6.1 工程与框架

| # | 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|---|
| 1 | 单 exe、窗口、Bridge 双向 | ✅ | `TauriCPP/` + `main.cpp` | |
| 2 | CMake / 资源嵌入 / 版本 / 图标 | ✅ | `CMakeLists.txt`、`version.hpp`、`build.ps1` | 1.0.0 |
| 3 | 菜单栏 / 工具栏 / 四栏布局 / 状态栏 | ✅ | `index.html`、`app.css` | |
| 4 | 最近文件、脏标记标题 | ✅ | `fileio.js`、`main.cpp` | |
| 5 | 关窗未保存确认 | ⬜ | — | 无 `app.close_confirm` |
| 6 | 剪贴板 Ctrl+C/V/X | ⬜ | — | 只有 Ctrl+D 复制、Alt 拖拽复制 |
| 7 | 前端诊断日志 | ✅ | `log_error` | |

### 6.2 文档模型与页面

| # | 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|---|
| 8 | 多页面 / 页面树（平铺 + 重命名 + 右键菜单） | ◐ | `model.js`、`editor.js` | 无文件夹分组、无拖拽排序 |
| 9 | 页面尺寸（fixed）+ 背景色 | ✅ | `page.js` | 预设 A4/A3 未做 |
| 10 | 页面尺寸 autoHeight / auto | ⬜ | — | 模型字段未启用 |
| 11 | 参考线（拖出/移动/删除/吸附） | ✅ | `editor.js`、`tools.js`、`overlay.js` | 仅内存 |
| 12 | 参考线随 vsdx 保存 | ⬜ | — | `writer.cpp` 未写 guides |
| 13 | 形状基础字段 + 旋转 | ✅ | `model.js`、`tools.js` | |
| 14 | 图层显隐 / 锁定 / 当前层 | ✅ | `model.js`、`editor.js`、`hit.js` | 锁定层不可命中 |
| 15 | 组合 / 解组 / 嵌套 / 双击进组 | ✅ | `model.js`、`tools.js` | |
| 16 | 布尔运算（联合/相交/剪除） | ✅ | `geometry.js` + `vendor/clipper.js` | 曲线按折线近似 |
| 17 | 对齐 / 分布 | ✅ | `model.js`、`editor.js` | |
| 18 | JSON Schema 校验 / 版本迁移 | ◐ | `model.js` | 仅 `format` 检查 |

### 6.3 画布与编辑

| # | 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|---|
| 19 | Canvas 渲染（形状/文本换行/虚线/箭头字形） | ✅ | `renderer.js` | 箭头按 Visio `lendN` 字形 |
| 20 | 静态层离屏缓存 | ◐ | `renderer.js` | 单 canvas + dirty 全量重绘 |
| 21 | 命中测试（AABB/旋转/线段/参考线） | ◐ | `hit.js` | 线性遍历，无空间索引 |
| 22 | 8 缩放手柄 + 旋转柄 + 等比/15° 吸附 | ✅ | `overlay.js`、`tools.js` | |
| 23 | 网格 / 对齐线 / 参考线吸附 | ✅ | `tools.js` | |
| 24 | 标尺（自适应刻度）+ 十字原点 | ✅ | `overlay.js` | |
| 25 | 文本就地编辑（DOM textarea 覆盖） | ✅ | `tools.js` | |
| 26 | **形状几何属性面板（x/y/w/h/角度/圆角/透明度）** | ✅ | `props.js` | 右栏「属性」Tab；多选显示「多个值」 |
| 27 | **文本样式面板（字体/字号/加粗/对齐/颜色）** | ✅ | `props.js` | 直写 `style.font`，与 `renderer.fontString` 同字段 |
| 28 | 缩放 / 平移 / 适应窗口 | ✅ | `viewport.js`、`editor.js` | |

### 6.4 Visio 向特性

| # | 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|---|
| 29 | 形状库 3 类 34 项（基本 6 / 流程图 3 / 原型 25） | ✅ | `stencils.js` | |
| 30 | 连接线：4 连接点吸附 + 直线/正交/曲线 | ✅ | `routing.js`、`tools.js` | |
| 31 | 端点拖拽换连接点（14px 吸附） | ✅ | `tools.js` | |
| 32 | 手动拖拽线段（生成 `route:"manual"`） | ✅ | `tools.js`、`routing.js` | |
| 33 | 正交布线 A* 避障 | ⬜ | `routing.js` | 现为固定引导段 + 曼哈顿折线 |
| 34 | 图片插入（png/jpg/svg/webp）+ 资产表 | ⬜ | — | 形状库只有「图片占位」块 |
| 35 | 组件库（母版 / 实例 / 解除链接 / 环检测） | ⬜ | — | 左栏 Tab 已隐藏 |

### 6.5 Axure 向特性

| # | 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|---|
| 36 | 交互面板：6 事件 × 9 动作 | ✅ | `inspect.js` | click/dblclick/enter/leave/pageload/keydown |
| 37 | 动态面板多状态编辑/切换 | ✅ | `model.js`、`inspect.js`、`interact.js` | 双击进入状态编辑 |
| 38 | 三级变量 + `{{var}}` 插值 | ✅ | `interact.js`、`inspect.js` | local → page → global |
| 39 | F5 全屏预览（含动效、键盘事件） | ✅ | `preview.js` | |
| 40 | 中继器（数据集/模板/布局/增删行/过滤排序分页） | ⬜ | — | 形状库仅有占位构件 |
| 41 | 注释浮层（预览/导出时高亮角标） | ⬜ | — | 仅编辑面板 |

### 6.6 元数据

| # | 功能 | 状态 | 实现位置 | 备注 |
|---|---|---|---|---|
| 42 | 注释 / 链接 / 脚本面板 | ✅ | `meta.js` | |
| 43 | meta 随 vsdx `User` 段往返 | ✅ | `writer.cpp`、`reader.cpp` | `VXNotes/VXLinks/VXScripts` |
| 44 | 元素脚本运行时（与交互动作同沙箱） | ✅ | `interact.js` | 编辑器内不执行 |
| 45 | Visio 原生 `Annotation` / `Hyperlink` 段互操作 | ⬜ | — | 自研文件互通，跨软件不显示 |

### 6.7 导出

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| 46 | HTML（单文件 / 文件夹 / zip） | ⬜ | 交互运行时可直接复用 |
| 47 | PNG（1x/2x/3x、透明底、全部页） | ⬜ | `drawScene` 可离屏复用 |
| 48 | SVG（矢量、文本 `tspan`） | ⬜ | 需新建 `export/svg.js` |
| 49 | PDF（栅格 JPEG + `DCTDecode`） | ⬜ | 需新建 `export/pdf.js` |
| 50 | `export.write` 后端命令 + 导出对话框 | ⬜ | 需新建 `src/exporter.cpp` |

### 6.8 VSDX 读写

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| 51 | 写入合法 OPC 包（Visio 可打开） | ✅ | 形状/文本/颜色/连线正确 |
| 52 | 读取真实 Visio 文件（样式继承/母版合并/相对几何/1-D/圆弧） | ✅ | 三样本回归通过 |
| 53 | 图层 / 组合链 / 粘附 / 交互 / 面板 / 变量 往返 | ✅ | `User` 段 |
| 54 | 图片 `ForeignData` 读写 | ⬜ | |
| 55 | 保存时保留母版引用（而非全展开） | ⬜ | 当前一律展开为具体形状 |
| 56 | 页面参考线往返 | ⬜ | |
| 57 | 主题色 `THEME(...)` 解析 | ◐ | 仅索引色 |

### 6.9 质量与打磨

| # | 功能 | 状态 | 备注 |
|---|---|---|---|
| 58 | `vsdx_test` round-trip + `ctest` | ✅ | `vsdx_roundtrip` |
| 59 | 三样本 vs SVG 视觉回归 | ◐ | 脚本在 `build/`（已 gitignore），未入库 |
| 60 | `model_test` / 布线单测 | ⬜ | |
| 61 | 大文档性能（500+ 形状） | ⬜ | 无缓存/索引 |
| 62 | 亮 / 暗主题 | ⬜ | 只有单套亮色 |
| 63 | README / 使用说明 | ✅ | 进度表已与本文件同步（P5 / P5.5 均标 ✅） |
| 64 | 前端 Playwright 验收脚本（属性面板 + 主干交互 + 子路径闭合） | ✅ | `test/e2e/`，复用本机 Edge，56 项断言 |

**统计**：✅ 37 项 · ◐ 6 项 · ⬜ 21 项（共 64 项）。

---

## 7. 缺失功能排期（按重要程度）

### S 级：决定「能不能用 / 能不能交付」，先做

| 优先级 | 功能 | 为什么现在做 | 验收标准 | 预计改动 |
|---|---|---|---|---|
| **S1** | **导出 MVP：HTML 单文件 + PNG（1x/2x/3x、透明底）** | 产品定位写着「可导出 HTML/PNG/PDF/SVG」，当前 0 导出，交付闭环断裂；且两者都能直接复用 `drawScene` 与 `interact.js`，性价比最高 | 菜单「文件→导出」可选 HTML/PNG；导出的 HTML 双击可跑交互、页面可切换；PNG 与画布像素一致 | 新增 `export/html.js`、`export/png.js`、`src/exporter.cpp`、`export.write`、菜单与对话框 |
| ~~**S2**~~ ✅ | **形状属性面板（几何 + 文本样式）**（2026-10-29 已完成） | 没有它，圆角/透明度/字体/字号/对齐/精确坐标全部不可编辑——等于让用户用模板默认值拼图；模型与渲染器都已支持，纯 UI 缺失 | 选中形状可改 x/y/w/h/角度/圆角/透明度；文本可改字体/字号/加粗/颜色/水平·垂直对齐；多选混合值显示「多个值」；全部走 History | 已交：`frontend/js/props.js` + `index.html` 挂「属性」Tab + `app.js` 初始化；验收 `test/e2e/check_props.js` |
| **S3** | **图片插入（png/jpg/svg/webp）** | 线框原型刚需；现在形状库里只有灰色占位块，用户必须去别的工具拼图 | 可从菜单/拖拽插入图片；按 hash 去重存资产表；支持 contain/cover/fill/stretch；保存 vsdx 写 `Foreign`+`media`，重新打开不丢 | `model.js` 加 `assets`、新增 `images.js`、`renderer.js` 画图、`reader/writer` 增 `Foreign` 段 |

### A 级：显著提升产品完整度

| 优先级 | 功能 | 说明 | 验收标准 |
|---|---|---|---|
| **A1** | 导出 SVG + PDF + 多页 zip + 导出对话框 | S1 打通后顺延；SVG 复用同一套形状→路径转换（`svg.js` 也被 HTML 导出复用） | SVG 浏览器打开无锯齿、文本 `tspan` 换行；PDF 多页单文件、与画布一致；多页打 zip |
| **A2** | 中继器 Repeater | 数据集 + 模板 + 竖向/网格布局，导出/预览渲染；补齐 Axure 侧最后一块 | 模板内 `{{列名}}` 插值；`addRow/deleteRow/filter/sort/分页` 动作可跑；保存 vsdx 往返 |
| **A3** | 组件库（母版 / 实例 / 解除链接） | 左栏 Tab 已埋好；跨页复用是 Axure 核心价值 | 拖入组件生成实例；改实例文本/样式不影响母版；解除链接变独立形状；嵌套环检测报错 |
| **A4** | 页面树分组 + 拖拽排序；`autoHeight/auto` 页面模式 | 页面多了以后平铺列表不可用；autoHeight 是原型交付常用模式 | 可建文件夹、拖拽调整层级与顺序；autoHeight 画布随内容向下扩展并写入 vsdx |
| **A5** | 参考线 / 页面尺寸模式随 vsdx 保存 | 现在保存再打开参考线全丢（用户已感知的「丢数据」） | `guides` 写入 `User` 段（`VXGuides`），读取还原；尺寸模式同理 |

### B 级：体验与正确性增强

| 优先级 | 功能 | 说明 |
|---|---|---|
| **B1** | 正交布线 A* 避障 | 现在折线可能穿过形状；宽高比悬殊时走线不美观 |
| **B2** | 关窗未保存确认 `app.close_confirm` | 防止误关丢稿（当前 `OnClose` 无回调） |
| **B3** | 剪贴板 Ctrl+C/V/X（含跨页粘贴、id 重映射） | 只有 Ctrl+D 与 Alt 拖拽复制，跨页搬运需重复拖 |
| **B4** | 注释浮层（预览/导出角标 + 悬停浮层） | 交付评审场景，`meta.notes` 已存在但无处展示 |
| **B5** | Visio 原生 `Annotation` / `Hyperlink` 段读写 | 与「在 Visio 里也能看到批注/超链接」的预期对齐 |
| **B6** | 大文档性能：静态层离屏缓存 + 空间索引 | 500+ 形状文档的验收项 |
| **B7** | 亮 / 暗主题（CSS 变量） | P7 验收项 |
| **B8** | `model_test` + 布线单测 + 视觉回归脚本入库 | 现在只有 round-trip 一种测试 |

### C 级：长期 / 明确不做

| 优先级 | 项目 | 结论 |
|---|---|---|
| C1 | 保存时保留母版引用 | 长期；当前展开策略对 Visio 打开无影响 |
| C2 | `THEME(...)` 主题色完整解析 | 只在读取带主题色的 Visio 文件时影响颜色精度 |
| C3 | 矢量 PDF（文本可选中 + 字体子集） | 单独排期，先交付栅格 PDF |
| C4 | Visio 母版/主题/图层的**完整**互操作 | **明确不做**：无底洞，保持 §4 的分阶段承诺 |

---

## 8. 里程碑（重排后）

| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| **P0 骨架** | TauriCPP / CMake / build.ps1 / Bridge / 四栏布局 | 单 exe、Bridge 双向通 | ✅ |
| **P1 画布核心** | 模型 / 渲染 / 选择变换 / 吸附 / undo / 文本 / 多页 / 标尺参考线 | 200 步撤销、参考线吸附 | ✅ |
| **P2 Visio 特性** | 形状库 / 连接线 + 布线 / 图层 / 样式 / 组合 / 布尔 / 对齐分布 | 流程图可画、布尔往返无损 | ✅ |
| **P3 VSDX** | miniz / writer / reader / 对话框 / 脏标记 / 最近文件 | Visio 能开、能吃真实文件 | ✅ |
| **P4 Axure** | 交互面板 / 动态面板 / 三级变量 / F5 预览 | 3 页原型可跑 | ✅ |
| **P5 元数据** | 注释/链接/脚本面板 + `User` 段往返 | 保存重开不丢 | ✅（Visio 原生段 ⬜） |
| **P5.5 属性面板** | 几何 + 文本样式 + 圆角/透明度（**S2**） | 所有样式可编辑、可撤销 | ✅（`test/e2e/check_props.js`） |
| **P6 导出** | HTML / PNG（**S1**）→ SVG / PDF / zip（**A1**） | 导出 HTML 可交互、PNG/PDF 一致 | ⬜ |
| **P6.5 图片 + 中继器 + 组件库** | **S3 / A2 / A3** | 原型可插入图片、可重复列表、可复用组件 | ⬜ |
| **P7 打磨** | 布线避障 / 剪贴板 / 关窗确认 / 性能 / 主题 / 测试 | 500+ 形状不卡、ctest 全绿 | ⬜ |

---

## 9. 风险与对策（更新）

| 风险 | 对策 |
|---|---|
| 导出与画布视觉不一致 | 导出复用 `renderer.drawScene`（PNG/PDF）与同一套 SVG 转换；建立三样本像素差分回归 |
| VSDX 完全兼容是深坑（Masters/主题/继承） | 保持 §4 分阶段承诺；母版只读不写，主题只解析索引色 |
| 连接线自动布线复杂 | 现有固定引导段 + 曼哈顿折线已可用；A* 作为 B1 增量，失败退化为直角折线 |
| Canvas 文本排版（换行/对齐/字体回退） | 渲染前字体回退链 `family → Arial → Helvetica → YaHei`；与 Visio SVG 对比时区分「字体缺失」与「排版错误」 |
| Visio 箭头/圆弧等细节语义误读 | 已用 `test/sample/*.svg` 反推字形与圆弧行语义；新增样本必须先做 SVG 对照再改代码 |
| 前端代码量增长难维护 | 单文件职责清晰（21 个模块）；新增导出/图片/组件按 §2「目标结构」拆文件 |
| 脚本功能安全边界 | 仅在预览/导出沙箱执行（编辑器内不执行），文档明示 |
| 属性面板与渲染器字段漂移 | 面板字段直接读写 `shape.style`，不引入第二套状态；多选用「多个值」占位；`test/e2e/check_props.js` 逐字段断言写入结果 |
| 面板/输入框抢占全局快捷键 | 面板输入框只屏蔽非 Ctrl/⌘ 键（Delete/方向键不穿透画布）；`editor.js` 对 `input[type=number]` 只放行 Ctrl+Z/Y |
| 子路径开合语义被猜错 | 闭合与否不得从「有没有填充」推断（基库多边形就是无填充的闭合环），统一由 `path.closed[]` 声明；reader 从 Visio 几何推导并写出，writer 对开放折线不补回原点的行；`test/e2e/check_stencils.js` 用像素探针双向守住 |
| 参考线等内存态数据丢失 | A5 统一走 `User` 段持久化，并纳入 round-trip 测试 |

---

## 10. 技术栈与运行环境

`C++17` · `TauriCPP(Win32/WebView2)` · `nlohmann/json` · `miniz(zip)` · `Clipper`（`frontend/vendor/clipper.js`）· `Canvas 2D` · `vanilla ES2020` · `MSVC` · `CMake` · `ctest` · `Playwright`（`test/e2e`，无头验收，复用本机 Edge）

环境要求：VS2022（C++ 工作负载）、CMake 3.15+、Python 3（资源打包）、vcpkg `webview2:x64-windows-static`；前端验收另需 Node 18+，首次执行 `cd test/e2e && npm install`。
调试：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`（CDP 截图/注入），`build.ps1 -DevMode` 前端热加载。

前端验收（优先用这个，比人工截图快）：

```powershell
python -m http.server 8731      # 仓根起静态服务
node test/e2e/run_all.js        # 属性面板 + 主干交互 + 子路径闭合，56 项断言，退出码非 0 即失败
```
