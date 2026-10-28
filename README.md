# Visioxure

Visio + Axure 结合体的桌面原型设计工具：**画得出 Visio 的图，也能像 Axure 一样跑交互**。

- 桌面端：C++17 / Win32 / WebView2（TauriCPP 框架）+ Canvas 2D 前端，单 exe 分发
- 文档模型：前端 JSON 为唯一事实源，后端只做文件 IO 与 VSDX 编解码
- 文件格式：`.vsdx`（OPC 包 + VisioML），保存后可用 Microsoft Visio 直接打开

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 窗口骨架 + Bridge 双向通信 | ✅ |
| P1 | 画布/选择/变换/文本/撤销重做/多页面/参考线/标尺 | ✅ |
| P2 | 路径与布尔运算、组合/解组、连接线与布线、形状库、图层、对齐分布 | ✅ |
| P3 | VSDX 读写（miniz）、文件对话框、脏标记、最近文件、Ctrl+S | ✅ |
| P4 | 交互面板（事件→动作）、动态面板多状态、三级变量、F5 预览 | ✅ |
| P5 | 注释 / 链接 / 脚本面板、meta 读写 | ⏳ |
| P6 | 导出 HTML / PNG / SVG / PDF | ⏳ |
| P7 | 主题、性能、图标、测试补齐、文档 | ⏳ |

详细设计见 [CODEPLAN.md](CODEPLAN.md)。

## 功能一览

**绘图（Visio 向）**

- 矩形 / 圆角矩形 / 椭圆 / 文本 / 图片 / 自由路径（含孔洞，even-odd）
- 组合（Ctrl+G）/ 解组（Ctrl+Shift+G）、布尔运算（联合 / 相交 / 剪除，基于 Clipper）
- 连接线：四边连接点吸附、直线 / 直角折线、移动形状自动跟随、**选中后可拖拽任意线段手动调整折线**
- 形状库（基本形状 / 流程图 / 动态面板），统一黑色边框、无填充
- 图层显隐与锁定、网格与参考线吸附、多页面页签

**VSDX 读写（P3/P4）**

- 保存：可以生成结构合法的 VSDX，Visio 打开后形状 / 文字 / 颜色 / 连线正确
- 打开：支持真实 Visio 文件（样式表继承、母版几何、原生组合、相对坐标、1-D 连接线、背景页跳过）
- 自定义数据通过 User 段保存：组合链、连接线粘附、手动折线、交互、面板状态、变量

**交互原型（Axure 向，P4）**

- 右侧「交互」Tab：事件 → 动作编辑器；全局变量 / 页面变量编辑
- 事件：点击 / 双击 / 鼠标移入 / 移出 / 页面载入 / 按键
- 动作：打开链接（跳页或 URL）/ 显示 / 隐藏（含淡入淡出）/ 切换面板状态 / 设置文本 / 移动（可带动画）/ 设置变量 / 运行脚本
- 动态面板：多状态编辑与切换，双击面板进入状态编辑，新建形状自动归入当前状态
- 变量插值 `{{name}}`：local → page → global，全局变量跨页持久、页面变量进入页面时重置
- **F5 全屏预览**：与后续 HTML 导出共用同一交互运行时，Esc 退出

## 构建与运行

### 环境

- Windows 10/11
- Visual Studio 2022（C++ 桌面工作负载）
- CMake 3.15+
- Python 3（前端资源打包进 `.rc`）
- vcpkg 静态库：`webview2:x64-windows-static`

### 命令

```powershell
# 构建 Release（内部调用 CMake + MSBuild）
powershell -ExecutionPolicy Bypass -File .\build.ps1

# 产物
build\Release\Visioxure.exe
```

首次构建会自动把 `frontend/` 下的 HTML/CSS/JS 打包进资源；修改前端后需重新构建。

### 测试

```powershell
cd build
ctest -C Release --output-on-failure
```

- `vsdx_test`：JSON → VSDX → JSON 往返一致性、包结构断言、坐标 Y 翻转、组合/连接线粘附/二次往返
- 样例文件在 `test/sample/`（Visio 生成的原生 VSDX 与对应 SVG，可用于读取回归与渲染对照）

## 目录结构

```
src/                 应用入口 + VSDX 编解码
  main.cpp           Bridge 命令：文件对话框 / vsdx.save / vsdx.load / 最近文件
  vsdx/              xml(极简 DOM) / package(OPC) / writer / reader
frontend/            前端（编译期嵌入 exe）
  index.html         菜单 / 工具栏 / 三栏布局
  js/model.js        文档模型（页面 / 形状 / 面板 / 图层 / 变量）
  js/canvas/         viewport / hit / renderer / overlay
  js/tools.js        选择 / 创建 / 连接线 / 线段拖拽
  js/editor.js       快捷键 / 菜单 / 页面页签 / 状态栏
  js/interact.js     交互运行时（事件 → 动作、变量、动效）
  js/preview.js      F5 预览
  js/inspect.js      右侧「交互」面板
  js/fileio.js       打开 / 保存 / 脏标记 / 最近文件
TauriCPP/            窗口 + WebView2 + Bridge 框架（随仓库提供）
third_party/miniz/   单文件 zip 库（OPC 打包）
test/                vsdx_test 与 Visio 原生样例
```

## 技术要点

- **坐标**：内部 96 DPI、左上原点、Y 向下；Visio 为英寸、左下原点、Y 向上，写入/读取时做 Pin 与角度翻转
- **布线**：端口法向 + LEAD 出线段 + 折线算法，编辑器与 VSDX 输出一致
- **母版**：按母版自身宽高解析 Geometry，再缩放到页面形状；页面行覆盖按 IX 合并
- **持久化**：交互 / 面板 / 变量以 User 单元格 JSON 保存，Visio 侧仅作为不可见数据，不影响打开

## 已知限制

- 圆弧 / 贝塞尔按折线近似：胶囊形会显示为圆角矩形，虚线边框绘制为实线
- 连接线走自研直角折线算法，个别长连线与 Visio 内置走向不同（可手动分段调整）
- 只导入非背景页；背景页内容不合并
- 组合级交互不随保存写入；迭代器（Repeater）动作尚未实现
- 富文本多段落只保留首段样式

## 仓库

- Gitee：https://gitee.com/masonwu21/Visioxure
- GitHub：https://github.com/Emsoro/Visioxure

`TauriCPP` 框架自带其 LICENSE，见 [TauriCPP/LICENSE](TauriCPP/LICENSE)。
