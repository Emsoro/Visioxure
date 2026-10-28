# Visioxure · Code Plan

> Visio + Axure 结合体：Visio 式图形绘制与连接线，Axure 式交互原型；保存为 `.vsdx`，可导出 **HTML / PNG / PDF / SVG**；元素可配置 **注释 / 链接 / 脚本**；支持图片（png/jpg/svg/webp）、多页面树、组件库（母版+实例）、迭代器（Repeater）、组合/解组与布尔运算（联合/相交/剪除）。
> 框架参考 `D:\Work\CPlusPlus\MaseGame`（自研 TauriCPP：C++17 / Win32 / WebView2 / 单 exe / 前端编译期嵌入）。

---

## 1. 总体架构

沿用 MaseGame 的分工，但**文档模型以前端为唯一事实源**（编辑器需要高频交互，后端不做游戏式主循环）：

```
┌─────────────────────────── Visioxure.exe（单文件）───────────────────────────┐
│  前端（WebView2，编译期嵌入）                    后端（C++17 / TauriCPP）      │
│  ┌──────────────────────────┐      Bridge     ┌──────────────────────────┐  │
│  │ 编辑器 UI                 │  invoke(cmd)   │ 文件对话框（打开/保存）     │  │
│  │  · Canvas 渲染 + 命中测试  │ ─────────────► │ VSDX 读写（OPC zip+XML）  │  │
│  │  · 文档模型 / undo-redo   │ ◄───────────── │ HTML 导出写盘 / 打 zip     │  │
│  │  · 交互引擎（Axure 运行时）│   emit(event)  │ 最近文件 / 窗口管理        │  │
│  │  · HTML 导出生成器         │                └──────────────────────────┘  │
│  └──────────────────────────┘                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **前端**负责：画布渲染、工具、选择/变换、连接线布线、undo/redo、属性面板、交互预览、HTML 导出产物生成。
- **后端**负责：`.vsdx` 读写（zip + Visio XML ↔ 内部 JSON）、原生打开/保存对话框、导出写盘、最近文件列表。
- **数据交换**：前端在保存时把完整文档 JSON 交给后端 → 后端转成 VSDX；打开时后端解析 VSDX → 还原 JSON → 前端加载。格式统一为内部 JSON Schema（见 §3）。

## 2. 目录结构

```
Visioxure/
├── CMakeLists.txt            # 参考 MaseGame：静态 CRT、/utf-8、资源嵌入、版本信息、图标、DPI manifest
├── build.ps1                 # Release / -DevMode / -Clean（前端热加载）
├── src/
│   ├── main.cpp              # TauriCPP 入口：窗口配置 + 全部 bridge.RegisterCommand
│   ├── document.hpp/.cpp     # 内部文档模型定义 + JSON 校验/迁移（版本号）
│   ├── vsdx/
│   │   ├── package.hpp/.cpp  # OPC 包读写（miniz）：[Content_Types].xml / _rels / parts
│   │   ├── writer.hpp/.cpp   # 内部 JSON → Visio XML（page1.xml、document.xml…）
│   │   └── reader.hpp/.cpp   # Visio 生成的 vsdx → 内部 JSON（Cell/Geometry/Glue 解析）
│   └── exporter.hpp/.cpp     # 接收前端导出 payload，写文件夹或打 zip
├── frontend/
│   ├── index.html
│   ├── vendor/clipper.min.js # 多边形布尔运算库（联合/相交/剪除，单文件）
│   ├── css/
│   │   ├── app.css           # 布局：菜单栏/工具栏/左形状库/中画布/右检查器/状态栏
│   │   └── themes.css        # 亮/暗主题（CSS 变量，参考 MaseGame 主题切换）
│   └── js/
│       ├── app.js            # 启动、bridge 封装、布局、快捷键
│       ├── model.js          # 文档模型 + 变更事件 + JSON Schema 校验
│       ├── history.js        # 命令栈 undo/redo（事务合并：拖动合成一条）
│       ├── stencils.js       # 形状库定义（基本/流程图/线框/容器…）
│       ├── canvas/
│       │   ├── renderer.js   # Canvas 2D 分层渲染（静态层离屏缓存 + 动态层）
│       │   ├── hit.js        # 命中测试（几何 + 逆旋转 + 空间索引）
│       │   ├── handles.js    # 选择框/8 手柄/旋转柄/连接点吸附
│       │   └── ruler.js      # 页面标尺（刻度随缩放自适应）+ 参考线拖出/吸附/删除
│       ├── tools/            # select / shape / connector / text / pan / group
│       ├── routing.js        # 连接线布线：直线 / 直角(正交避障) / 曲线
│       ├── library.js        # 组件库（母版）：新建/实例化/解除链接/嵌套与环检测
│       ├── images.js         # 图片资产：png/jpg/webp/svg 导入、hash 去重资产表、SVG 尺寸探测
│       ├── interact.js       # Axure 式交互引擎（编辑预览与导出共用，含迭代器渲染）
│       ├── panels/           # 页面树 / 组件库 / 形状库 / 样式 / 交互 / 注释·链接·脚本 / 图层 / 数据集
│       └── export/
│           ├── html.js       # 文档 → 自包含 HTML（页面 + 交互运行时 + 注释面板）
│           ├── svg.js        # 形状 → SVG 转换器（HTML 导出与独立 .svg 导出共用）
│           └── pdf.js        # 极简 PDF writer：每页栅格化 JPEG 直嵌（DCTDecode），多页单文件
├── third_party/
│   ├── miniz/                # 单文件 zip 库（miniz.c/h），无需 vcpkg
│   └── nlohmann/             # json.hpp（随 TauriCPP third_party）
├── test/
│   ├── vsdx_test.cpp         # 写→读 round-trip；用 Visio 生成样例文件做读测试
│   └── model_test.cpp        # JSON 序列化 / 版本迁移
└── TauriCPP/                 # 框架副本（直接从 MaseGame 拷贝，含 tools/pack_resources.py）
```

## 3. 内部文档模型（JSON Schema 草案）

前端与后端、编辑器与导出器共用的中间格式，带 `version` 以便迁移：

```json
{
  "format": "visioxure", "version": 1,
  "doc": { "theme": "light", "variables": [ { "name": "username", "default": "guest" } ] },   // ★ 全局变量（文档级、跨页面持久、带默认值）
  "assets": [                                     // ★ 图片资产表（png/jpg/webp/svg，按内容 hash 去重复用）
    { "id": "a1", "format": "png", "hash": "sha1…", "data": "base64…", "w": 800, "h": 600 }
  ],
  "library": [                                    // ★ 组件库（Axure 母版，全局复用，支持嵌套+环检测）
    { "id": "m1", "name": "顶部导航栏", "shapes": [ /* 结构同页面 shapes */ ] }
  ],
  "pages": [
    {
      "id": "p1", "name": "登录页",
      "size": { "mode": "autoHeight", "w": 375, "h": 812 },
      // ★ 页面尺寸三模式：
      //   fixed      Visio 式固定宽高（预设 A4/A3/Letter/自定义）
      //   autoHeight Axure 式定宽自适应高：w 固定，h 随内容包围盒自动向下扩展
      //   auto       自适应：导出为 100% 宽流式布局
      "variables": [ { "name": "errorMsg", "default": "" } ],   // ★ 页面变量（进入页面时重置为默认值，离开销毁）
      "layers": [ { "id": "l1", "name": "默认", "visible": true, "locked": false } ],
      "guides":  [ { "dir": "v", "pos": 120 }, { "dir": "h", "pos": 80 } ],   // ★ 参考线（从标尺拖出，随文档保存）
      "shapes": [
        {
          "id": "s1", "type": "rect",            // rect|ellipse|text|image|path|panel|container|group|connector|instance|repeater
          "x": 100, "y": 80, "w": 200, "h": 48, "angle": 0,
          "z": 3, "layer": "l1", "lock": false,
          "style": { "fill": "#4A90D9", "line": "#2B6CB0", "lineWidth": 1.5,
                     "cornerRadius": 6, "opacity": 1,
                     "font": { "family": "Segoe UI", "size": 14, "color": "#FFFFFF",
                               "bold": false, "align": "center", "vAlign": "middle" } },
          "text": "登录",
          "image": { "asset": "a1", "fit": "contain" },   // 仅 type=image：fit=contain|cover|fill|stretch
          "path":   { "subpaths": [ [ { "x": 0, "y": 0 } ] ], "fillRule": "evenodd" },  // 仅 type=path（布尔运算结果/自由路径）
          "instance": { "master": "m1",                                     // 仅 type=instance（组件实例）
                        "overrides": { "s9": { "text": "关于我们" } } },    // 按组件内形状 id 覆盖文本/样式
          "repeater": {                                          // 仅 type=repeater（迭代器/中继器）
            "dataset": { "columns": ["title", "url"], "rows": [ { "title": "首页", "url": "…" } ] },
            "template": { "w": 335, "h": 64, "shapes": [ /* 模板形状，文本支持 {{title}} 插值 */ ] },
            "layout": { "dir": "vertical", "gap": 12, "cols": 1 }
          },
          "panel": { "states": [ { "id": "st1", "name": "默认", "shapes": [] } ] },  // 仅 type=panel
          "glue": { "begin": "s0:3", "end": "s1:0" },   // 仅 connector，锚到形状的连接点序号
          "route": "ortho",                              // straight|ortho|curve
          "meta": {                                      // ★ 注释 / 链接 / 脚本（核心需求）
            "notes": "此处为登录入口，点击跳转首页",
            "links":  [ { "type": "page", "target": "p2", "title": "去首页" },
                        { "type": "url", "target": "https://…" } ],
            "scripts": [ { "name": "校验表单", "code": "/* 在导出/预览时执行 */ …" } ]
          },
          "interactions": [                              // ★ Axure 式交互
            { "event": "click",                          // click|dblclick|mouseenter|mouseleave|pageload|keydown
              "actions": [ { "type": "openLink", "target": "p2" },
                           { "type": "show", "target": "s5", "effect": "fade" },
                           { "type": "setState", "target": "s6", "state": "st2" },
                           { "type": "setText", "target": "s7", "value": "{{username}}" },
                           { "type": "move", "target": "s8", "dx": 10, "dy": 0, "animate": 300 },
                           { "type": "setVar", "scope": "global", "name": "username", "value": "…" },   // scope: global|page|local
                           { "type": "addRow", "target": "s9", "row": { "title": "新项" } },   // 迭代器动作
                           { "type": "runScript", "ref": 0 } ] }
          ]
        }
      ]
    }
  ]
}
```

## 4. VSDX 关键技术点

VSDX = OPC 包（zip）+ VisioML。后端用 **miniz**（单文件 C 库，直接进 third_party，不引 vcpkg 新依赖）读写。

**写入的包结构（最小合法集，Visio 可直接打开）：**

```
[Content_Types].xml        ← 声明 visio 各 part 的 ContentType
_rels/.rels                ← 指向 document.xml 与 docProps
docProps/core.xml / app.xml
visio/document.xml         ← 文档级设置、样式表(StyleSheets)
visio/_rels/document.xml.rels
visio/pages/pages.xml      ← 页面列表（Page/@ID、Name、PageWidth/Height）
visio/pages/_rels/pages.xml.rels
visio/pages/page1.xml …    ← 每页一个 part：Shapes/Shape/Cell/Section(Geometry/Character/Paragraph)
```

**内部模型 ↔ Visio Cell 映射（实现时对照）：**

| 内部字段 | VisioML |
|---|---|
| x/y/w/h | `PinX / PinY / Width / Height`（**单位英寸**，默认 `LocPinX=Width*0.5`） |
| angle | `Angle`（弧度） |
| 坐标系 | **Visio 原点在左下角、Y 向上** —— 保存时 `PinY = pageH - y - h/2` 翻转，读取时反向 |
| fill/line | `FillForegnd / LineColor / LineWeight`（`#RRGGBB`） |
| 文本 | `Text` 元素 + `Character/Paragraph` Section |
| 矩形/椭圆 | `Geometry` Section（`MoveTo/LineTo/Ellipse` 行） |
| 连接线 | 1-D 形状（`BeginX/BeginY/EndX/EndY`）+ 页面 `Connects/Connect` 记录粘附关系 |
| 注释 | `Shape` 下 `Annotation` Section / `User` Section 存自定义数据 |
| 超链接 | `Hyperlink` Section（Name/Address） |
| 脚本/自定义 | 写入 `User.VisioxureMeta` Cell（Base64 的 JSON），读取时优先识别 |
| 图片 | `Foreign` Section + `ForeignData`（rel 指向包内 `/visio/media/imageN.{png\|jpg\|webp\|svg}`），媒体文件按原格式作为独立 OPC part 存储 |
| 组件实例/迭代器 | Visio 无对应概念：写 VSDX 时**展开为具体形状**，组件来源/数据集写入 `User.VisioxureMeta`，读取时按标记还原为组件/迭代器 |
| 组合 group | Visio 无真实组合：展开为各自独立 Shape，组合关系（成员 id 列表）写入 `User.VisioxureMeta`，读取时还原分组 |
| 布尔结果 path | 多子路径 `Geometry` Section（`MoveTo/LineTo` 行 × N + `NoFill`/`EvenOdd` 填充规则） |

**分阶段兼容承诺（避免"完全兼容 Visio"这个无底洞）：**
- M3：写入合法 vsdx —— Visio 能打开、形状/文本/颜色/连接线正确；
- M4：读取 Visio 保存的 vsdx —— 解析 `Shape/Cell/Geometry/Connect`，忽略 Masters 复杂模板（Master 引用先渲染为矩形占位并记录告警）；
- 后续增强：Masters 解析、主题、图层读写。

## 5. Bridge 命令清单（src/main.cpp 注册）

```cpp
bridge.RegisterCommand("file.open_dialog", …);   // 原生打开对话框 → 返回路径
bridge.RegisterCommand("file.save_dialog", …);   // 原生保存对话框 → 返回路径
bridge.RegisterCommand("vsdx.save",   …);        // args: { path, doc }  JSON→VSDX
bridge.RegisterCommand("vsdx.load",   …);        // args: { path }      VSDX→JSON
bridge.RegisterCommand("export.write", …);       // args: { path, files:[{name,b64}] | zip }  HTML/PNG/PDF/SVG 统一落盘
bridge.RegisterCommand("app.set_title", …);      // 含脏标记：标题 "… — 未保存"
bridge.RegisterCommand("app.recent_files", …);   // 最近文件读写（%APPDATA%/Visioxure）
bridge.RegisterCommand("app.close_confirm", …);  // 关窗前询问保存（OnClose 回调）
bridge.RegisterCommand("log_error", …);          // 前端诊断日志（沿用 MaseGame 模式）
```

状态推送：后端不做定时 Emit（无游戏循环）；仅 `vsdx.load` 完成后 `Emit("document_loaded", json)`。

## 6. 前端编辑器要点

- **布局**：顶部菜单栏+工具栏（文件/撤销/缩放/插入图片）｜左侧面板三个 Tab：**页面树**（Axure 站点地图式：文件夹分组、增删/重命名/拖拽排序，即多页面列表）、**组件库**、形状库（stencils，分类折叠）｜中央画布（底部页签条可选）｜右侧检查器（Tab：样式 / 交互 / 注释·链接·脚本 / 图层 / 数据集[迭代器]）｜底部状态栏（缩放%、网格开关、选中数）。
- **渲染**：Canvas 2D 双层 —— 静态层（形状本体）离屏缓存，仅 dirty 时重绘；动态层（选区/手柄/对齐线/布线预览）每次重绘。沿用 MaseGame 的按需降帧思路。页面边界随尺寸模式绘制：`fixed` 画定界框；`autoHeight` 按内容包围盒 + 边距**自动向下扩展**画布；`auto` 编辑时以定宽显示、导出时转 100% 宽。
- **标尺与参考线**：画布顶部/左侧显示标尺（原点=页面左上角，可拖动十字原点重设）；刻度随缩放自适应档位（1/5/10/50/100/500）；鼠标经过画布时标尺高亮当前坐标；从标尺**拖出参考线**（v/h），形状移动/缩放时吸附；参考线随文档保存（`page.guides`），可拖动调整、拖回标尺或 Del 删除，视图菜单可整体开关。
- **命中测试**：空间索引（网格桶）+ 点在旋转矩形内判定；连接线按距线段阈值选中。
- **变换**：8 缩放手柄 + 旋转柄；Shift 等比/15° 吸附；Alt 复制拖拽；对齐参考线（边/中心）与网格吸附。
- **组合与布尔运算**：多选 `Ctrl+G` 成组（type=group，支持嵌套）、`Ctrl+Shift+G` 解除组合；单击选组、双击进入组内编辑子形状；右键菜单提供**联合 / 相交 / 剪除**——矩形/椭圆先多边形化（Clipper 布尔），结果生成 `type=path` 形状并继承底层形状样式，原形状移除（可整体撤销）。
- **连接线**：形状四边各取连接点（`0..3`），拖出即创建；锚定后跟随源形状移动并重算布线；正交布线用 A* 网格避障（`routing.js`，纯函数便于单测）。
- **文字**：Canvas `measureText` 测量 + 自动换行 + 双击进入就地编辑（DOM textarea 覆盖在画布上，编辑完写回模型）。
- **undo/redo**：命令栈，操作以"事务"提交（一次拖动/属性批量改 = 一条），上限 200 步。
- **快捷键**：Ctrl+Z/Y、C/V/X、Ctrl+D 复制、G 成组、方向键微移、F5 预览、F12 DevTools（框架自带）。

## 7. Axure 式交互引擎（interact.js）

编辑与导出**共用同一运行时**：预览模式（F5，编辑器内全屏运行）与 HTML 导出只是外壳不同。

- **事件**：click / dblclick / mouseenter / mouseleave / pageload / keydown。
- **动作**：openLink（页面内跳转 / 外部 URL）、show/hide（含 fade/slide 动效）、setState（动态面板切状态）、setText、move（带动画）、setVar（设置变量，带作用域）、repeater 系列（addRow / deleteRow / filter / sort / 分页）、runScript。
- **变量系统（三级作用域）**：**全局变量**（`doc.variables`，文档级定义、跨页面持久、带默认值）、**页面变量**（`page.variables`，进入页面时重置为默认值，离开销毁）、**局部变量**（单条动作链内临时存在）；`{{var}}` 插值求值顺序 **local → page → global**；交互面板提供全局/页面变量列表的浏览与编辑。
- **动态面板**（type=panel）：容器内多状态，同尺寸切换，状态面板可视化编辑。
- **脚本沙箱**：自定义脚本在导出页中通过 `new Function("shape","page","vars", code)` 执行；预览与导出行为一致；文档中记录脚本仅供审阅，导出 HTML 中原样内联。
- **注释**：导出 HTML 右上角提供「注释开关」，开启后元素高亮角标，悬停/点击弹出 notes 浮层 —— 交付评审时可用。

## 8. 导出（HTML / PNG / PDF / SVG）

- **HTML**：单文件自包含 index.html（全部页面 hash 路由 `#/p1`，CSS/JS/交互运行时内联），可选「按文件夹导出」（index.html + assets/ + 每页独立 html）或 zip；形状 → 绝对定位 SVG（共用 `svg.js`）叠加 DOM 事件层（交互绑定）；内置缩放适配、页面导航条、注释面板、`{{变量}}` 绑定（全局变量随包初始化，页面变量 pageload 重置）。
- **PNG**：离屏 canvas 栅格化整页 → `toBlob` 出图；可选 **1x / 2x / 3x 倍率**与**透明背景**；导出当前页或全部页面（多页 → `page-1.png…`，打 zip）。
- **SVG**：复用 `svg.js` 将每页形状转为独立 `.svg` 文件（矢量保真，文本转 `tspan` 换行）；多页 → 多文件或 zip。
- **PDF**：前端极简 PDF writer（`pdf.js`，约 200 行，零依赖）：每页离屏渲染为 JPEG，以 `DCTDecode` Image XObject 直嵌，多页单文件；页面尺寸随页面模式换算为 pt。**P6 先交付栅格化 PDF；矢量文本可选中 PDF 列为后续增强**（svg 路径 → PDF 内容流直译 + 字体子集嵌入，单独排期）。
- 统一落盘：前端在 invoke 前组装全部字节流（base64），后端 `export.write` 只写文件 / miniz 打 zip —— 四种导出共用一条命令。

## 9. 单元测试（沿用 MaseGame ctest 模式）

- `vsdx_test.cpp`：JSON → VSDX → JSON round-trip 字段一致性；坐标 Y 翻转正确性；用最小合法 XML 断言包结构（Content_Types / rels 完整）；若仓库放入 Visio 生成的样例文件则做读取回归。
- `model_test.cpp`：Schema 校验、版本迁移、连接点粘附关系一致性（删除形状时连线处理）。
- 布线算法：`routing.js` 核心用 Exec/Node 或移植成 C++ 共享逻辑做断言（正交绕障、无重叠走线）。
- 调试：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`（CDP 截图/注入）。

## 10. 里程碑

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0 骨架** | 拷贝 TauriCPP、CMake、build.ps1、窗口+Bridge ping、编辑器布局静态稿 | `.\build.ps1` 产出单 exe，界面四栏布局可显示，Bridge 双向通 |
| **P1 画布核心** | 文档模型、渲染器、选择/移动/缩放/旋转、网格吸附、undo/redo、文本编辑、多页面签、标尺与参考线 | 拖放矩形/椭圆/文本流畅，200 步撤销正确，双页切换，标尺随缩放自适应、可拖出参考线并吸附 |
| **P2 Visio 特性** | 形状库面板、连接线+连接点吸附+正交布线、图层、样式面板、组合/解组、布尔运算（联合/相交/剪除）、对齐分布 | 流程图可画：拖形状→连线→移动形状连线跟随；布尔结果正确、组合解组往返无损 |
| **P3 VSDX** | miniz 集成、writer、reader、文件对话框、脏标记、最近文件、Ctrl+S | 保存的 vsdx 能被 **Visio 打开且形状/文字/颜色/连线正确**；能打开 Visio 保存的文件 |
| **P4 Axure 特性** | 交互面板（事件→动作）、动态面板多状态、变量系统（全局/页面/局部）、F5 预览模式 | 画 3 页原型：按钮点击跳页、面板切状态、全局/页面变量跨页传值插值，预览可跑 |
| **P5 元数据** | 注释/链接/脚本编辑面板、数据模型 meta 读写、vsdx User Cell 映射 | 每个元素可配 notes/links/scripts，保存 vsdx 后重开不丢 |
| **P6 导出** | HTML（单文件/文件夹/zip）、PNG（1x/2x/3x、透明底）、SVG（矢量单页）、PDF（栅格多页）、注释面板、导航条 | 导出 HTML 双击可交互；PNG/PDF 与画布视觉一致；SVG 可在浏览器打开且无锯齿 |
| **P7 打磨** | 亮暗主题、大文档性能（静态层缓存/降帧）、图标+版本资源、测试补齐、README | 500+ 形状文档可编辑不卡；ctest 全绿 |

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| VSDX 完全兼容是深坑（Masters/主题/继承样式） | 明确分阶段承诺（§4），Master 先占位降级；用 Visio 实测样例做回归 |
| 连接线自动布线复杂 | 先直线→再正交网格 A*→曲线垫底；布线失败退化为直角折线 |
| Canvas 文本排版（换行/对齐/字体回退） | 就地编辑用 DOM overlay，渲染用测宽分行，先支持单段落 |
| 前端代码量增长难维护 | 按 §2 模块拆文件，模型/渲染/工具三层分离，纯函数（布线、序列化）可单测 |
| 脚本功能安全边界 | 脚本仅在导出页/预览沙箱内运行（编辑器内不执行），文档明示 |
| 矢量 PDF（文本可选中）复杂度高（字体子集嵌入） | P6 先交付栅格化 PDF；矢量增强基于 svg.js → PDF 内容流直译，单独排期 |
| 布尔运算边界情况（自交多边形/贝塞尔曲线） | 统一多边形化后走 Clipper（椭圆 64 段、贝塞尔按弧长细分）；曲线布尔结果为折线近似，文档标注已知限制 |

## 12. 技术栈

`C++17` · `TauriCPP(Win32/WebView2)` · `nlohmann/json` · `miniz(zip)` · `Canvas 2D` · `vanilla ES2020` · `MSVC` · `CMake` · `ctest`

环境要求与 MaseGame 相同：VS2022 (C++ 工作负载)、CMake 3.15+、Python 3（资源打包）、vcpkg `webview2:x64-windows-static`。
