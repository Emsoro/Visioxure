// stencils.js —— 形状库（P2）
// 分类：基本形状 / 流程图 / 交互原型；点击条目在当前视口中心创建
// path 子路径为局部坐标（原点=形状中心），与 renderer/hit/geometry 约定一致
// 组合条目的 children 使用「左上角 = 0,0」的局部坐标，插入时整体平移
"use strict";

(function () {
  function polyDef(pts, w, h) {
    return { type: "path", w, h, path: { subpaths: [pts], fillRule: "evenodd" } };
  }

  // ---------- 形状库视觉规范 ----------
  // 缩略图与插入后的形状共用这一套色板，保证“所见即所得”且整库风格一致：
  // 统一主描边 ink / 次要描边 inkSoft / 中性浅底 surface，语义色（热区）单独保留。
  const SK = {
    ink: "#39434F",
    inkSoft: "#8B96A5",
    blob: "#C2CBD8",
    surface: "#EEF1F6",
    paper: "#FFFFFF",
    text: "#4A5462",
    textDim: "#8B96A5",
    warnFill: "#FFF3D1",
    warnLine: "#D9A62E",
    warnText: "#A87B0F",
    lineWidth: 1.4,
  };

  // ---------- 交互原型色板（对齐 prototype/ 样图） ----------
  // 样图语言：白底卡片 + 极细描边 + 深墨蓝主色 + 浅灰骨架占位，
  // 与基本形状的「灰蓝线框」区分开，插入后即接近成品界面观感。
  const PR = {
    line: "#E2E5EA",        // 卡片/列表项描边
    lineSoft: "#EDEFF3",    // 分隔线（比描边更淡）
    fieldLine: "#D5D9E1",   // 表单控件/机身描边（略深，保证细线可见）
    text: "#22252B",        // 主文字
    textDim: "#6E737D",     // 次要文字/占位文字（白底对比 ≥4.5:1）
    white: "#FFFFFF",
    surface: "#F3F4F7",     // 浅灰底：搜索框/标签/选中导航项
    skeleton: "#E7E9EE",    // 骨架占位块
    skeletonDeep: "#CBD0DA", // 占位图里的图标/次要色块
    navy: "#2B2A4C",        // 深墨蓝主色：主按钮/强调卡片
    navySoft: "#4B4A72",    // 深色卡片上的次级色块
    // 占位图（对齐 图片占位.svg / 照片占位.svg 样图的中性灰，区别于蓝调的骨架色）
    phFill: "#F2F2F2",      // 占位卡片/圆形底
    phInk: "#A5A5A5",       // 占位图前景（山形、人像剪影）
  };

  // ---------- 交互原型：组合构件的局部坐标小工具 ----------
  const FONT = { family: "Segoe UI", size: 13, color: PR.text, bold: false, align: "center", vAlign: "middle" };
  function font(patch) { return Object.assign({}, FONT, patch || {}); }
  function box(x, y, w, h, style) { return { type: "rect", x, y, w, h, style }; }
  function ellipse(x, y, w, h, style) { return { type: "ellipse", x, y, w, h, style }; }
  function poly(pts, x, y, w, h, style) {
    return { type: "path", x, y, w, h, path: { subpaths: [pts], fillRule: "evenodd" }, style };
  }
  function label(text, x, y, w, h, fontPatch) {
    return {
      type: "text", x, y, w, h, text,
      style: { fill: "transparent", line: "transparent", lineWidth: 0, font: font(Object.assign({ align: "left" }, fontPatch || {})) },
    };
  }

  // 线段 → 填充四边形（局部坐标以包围盒中心为原点）：画放大镜柄、关闭叉等细节时
  // 不必依赖形状旋转，缩略图与画布渲染结果保持一致
  function seg(x1, y1, x2, y2, t, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * t / 2, ny = (dx / len) * t / 2;
    const x = Math.min(x1, x2) - t / 2, y = Math.min(y1, y2) - t / 2;
    const w = Math.abs(dx) + t, h = Math.abs(dy) + t;
    const cx = x + w / 2, cy = y + h / 2;
    const ring = [
      { x: x1 + nx, y: y1 + ny }, { x: x2 + nx, y: y2 + ny },
      { x: x2 - nx, y: y2 - ny }, { x: x1 - nx, y: y1 - ny },
    ].map((p) => ({ x: p.x - cx, y: p.y - cy }));
    return {
      type: "path", x, y, w, h, path: { subpaths: [ring], fillRule: "evenodd" },
      style: { fill: color, line: "transparent", lineWidth: 0 },
    };
  }

  // 拱形轮廓（下平上拱 + 底部小圆角）：照片占位里的人物肩部。
  // 圆角矩形会把顶部近似成半圆、肩线过陡，这里按样图采样成多边形
  function archPoly(w, h) {
    const ry = h * 0.62;                        // 拱高
    const rb = Math.min(h - ry, w * 0.12);      // 底部圆角半径
    const pts = [];
    const arc = (cx, cy, rx, ryy, a0, a1, n) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ryy });
      }
    };
    arc(w / 2, ry, w / 2, ry, Math.PI, Math.PI * 2, 10);   // 顶部椭圆弧：左 → 右
    arc(w - rb, h - rb, rb, rb, 0, Math.PI / 2, 3);        // 右下圆角
    arc(rb, h - rb, rb, rb, Math.PI / 2, Math.PI, 3);      // 底边 → 左下圆角
    return pts.map((p) => ({ x: p.x - w / 2, y: p.y - h / 2 }));
  }

  // 下拉箭头：闭合多边形模拟细线「v」形（开放路径会被闭合，不能直接画折线）
  function chevron(x, y, w, h, color) {
    const t = Math.max(1.2, h * 0.3);
    const pts = [
      { x: -w / 2, y: -h / 2 }, { x: 0, y: h / 2 - t }, { x: w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 + t }, { x: 0, y: h / 2 }, { x: -w / 2, y: -h / 2 + t },
    ];
    return poly(pts, x, y, w, h, { fill: color, line: "transparent", lineWidth: 0 });
  }

  const categories = [
    {
      name: "基本形状",
      items: [
        { id: "rect", name: "矩形", def: { type: "rect", w: 120, h: 80 } },
        { id: "roundrect", name: "圆角矩形", def: { type: "rect", w: 120, h: 80, style: { cornerRadius: 12 } } },
        { id: "circle", name: "圆形", def: { type: "ellipse", w: 100, h: 100 } },
        { id: "triangle", name: "三角形", def: polyDef([{ x: -60, y: 45 }, { x: 0, y: -45 }, { x: 60, y: 45 }], 120, 90) },
        { id: "trapezoid", name: "梯形", def: polyDef([{ x: -45, y: -35 }, { x: 45, y: -35 }, { x: 60, y: 35 }, { x: -60, y: 35 }], 120, 70) },
        { id: "diamond", name: "菱形", def: polyDef([{ x: 0, y: -45 }, { x: 60, y: 0 }, { x: 0, y: 45 }, { x: -60, y: 0 }], 120, 90) },
      ],
    },
    {
      name: "流程图",
      items: [
        // 连接线：带箭头的正交折线（两端可在画布上拖动吸附到形状连接点）
        {
          id: "flow-connector", name: "连接线",
          def: { type: "connector", w: 160, h: 0, begin: { x: 0, y: 0 }, end: { x: 160, y: 0 }, route: "ortho" },
        },
        // 箭头：块状箭头（可缩放，常用于流程指向）
        {
          id: "flow-arrow", name: "箭头",
          def: polyDef([{ x: -60, y: -10 }, { x: 10, y: -10 }, { x: 10, y: -25 },
            { x: 60, y: 0 }, { x: 10, y: 25 }, { x: 10, y: 10 }, { x: -60, y: 10 }], 120, 50),
        },
        // 双向箭头：两端带箭头的块状箭头（用于双向流程/数据流）
        {
          id: "flow-arrow-double", name: "双向箭头",
          def: polyDef([{ x: -60, y: 0 }, { x: -20, y: -25 }, { x: -20, y: -10 },
            { x: 20, y: -10 }, { x: 20, y: -25 }, { x: 60, y: 0 },
            { x: 20, y: 25 }, { x: 20, y: 10 }, { x: -20, y: 10 }, { x: -20, y: 25 }], 120, 50),
        },
      ],
    },
    {
      name: "交互原型",
      items: [
        // 移动端画板：白底圆角机身 + 状态栏 + 标题 + 内容占位 + 底部主按钮
        {
          id: "proto-phone", name: "手机画板",
          def: {
            type: "group", w: 320, h: 640,
            children: [
              box(0, 0, 320, 640, { fill: PR.white, line: PR.fieldLine, lineWidth: 1.5, cornerRadius: 26 }),
              label("9:41", 26, 16, 60, 16, { size: 12, bold: true }),
              label("页面标题", 26, 54, 240, 26, { size: 17, bold: true }),
              box(26, 96, 268, 128, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 10 }),
              box(26, 240, 190, 12, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 6 }),
              box(26, 262, 232, 12, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 6 }),
              box(26, 560, 268, 44, { fill: PR.navy, line: "transparent", lineWidth: 0, cornerRadius: 8 }),
              label("按钮", 26, 560, 268, 44, { size: 14, align: "center", color: PR.white }),
              box(120, 622, 80, 4, { fill: PR.fieldLine, line: "transparent", lineWidth: 0, cornerRadius: 2 }),
            ],
          },
        },
        // 主按钮：深墨蓝实心 + 白字（样图里的 Read Blogs / Save / Update details）
        {
          id: "proto-button", name: "主按钮",
          def: {
            type: "rect", w: 120, h: 40, text: "按钮",
            style: { cornerRadius: 8, fill: PR.navy, line: "transparent", lineWidth: 0, font: font({ size: 14, color: PR.white }) },
          },
        },
        // 次按钮：白底细边 + 深色字（样图里的 Cancel / Today）
        {
          id: "proto-button-secondary", name: "次按钮",
          def: {
            type: "rect", w: 120, h: 40, text: "次按钮",
            style: { cornerRadius: 8, fill: PR.white, line: PR.fieldLine, lineWidth: 1, font: font({ size: 14, color: PR.text }) },
          },
        },
        {
          id: "proto-textlabel", name: "文本标签",
          def: {
            type: "text", w: 140, h: 24, text: "文本标签",
            style: { fill: "transparent", line: "transparent", lineWidth: 0, font: font({ align: "left", size: 13, color: PR.text }) },
          },
        },
        {
          id: "proto-textbox", name: "文本框",
          def: {
            type: "rect", w: 220, h: 40, text: "请输入内容",
            style: { cornerRadius: 6, fill: PR.white, line: PR.fieldLine, lineWidth: 1, font: font({ align: "left", size: 13, color: PR.textDim }) },
          },
        },
        // 表单字段：标题在上、输入框在下的字段组（样图 2 的表单行）
        {
          id: "proto-field", name: "表单字段",
          def: {
            type: "group", w: 240, h: 70,
            children: [
              label("字段名称", 0, 0, 240, 20, { size: 12 }),
              box(0, 28, 240, 38, { fill: PR.white, line: PR.fieldLine, lineWidth: 1, cornerRadius: 6 }),
              label("请输入…", 10, 28, 218, 38, { size: 13, color: PR.textDim }),
            ],
          },
        },
        {
          id: "proto-select", name: "下拉列表",
          def: {
            type: "group", w: 220, h: 38,
            children: [
              box(0, 0, 220, 38, { fill: PR.white, line: PR.fieldLine, lineWidth: 1, cornerRadius: 6 }),
              label("请选择", 10, 0, 170, 38, { size: 13, color: PR.textDim }),
              chevron(194, 16, 10, 6, PR.textDim),
            ],
          },
        },
        {
          id: "proto-checkbox", name: "复选框",
          def: {
            type: "group", w: 160, h: 24,
            children: [
              box(0, 3, 18, 18, { fill: PR.white, line: PR.fieldLine, lineWidth: 1.2, cornerRadius: 4 }),
              label("复选项", 28, 0, 132, 24, { size: 13 }),
            ],
          },
        },
        {
          id: "proto-radio", name: "单选按钮",
          def: {
            type: "group", w: 160, h: 24,
            children: [
              ellipse(0, 3, 18, 18, { fill: PR.white, line: PR.fieldLine, lineWidth: 1.2 }),
              label("单选项", 28, 0, 132, 24, { size: 13 }),
            ],
          },
        },
        // 搜索框：浅灰胶囊 + 放大镜（样图 3 顶部的 Search for anything…）
        {
          id: "proto-search", name: "搜索框",
          def: {
            type: "group", w: 260, h: 40,
            children: [
              box(0, 0, 260, 40, { fill: PR.surface, line: "transparent", lineWidth: 0, cornerRadius: 20 }),
              ellipse(14, 12, 14, 14, { fill: "transparent", line: PR.textDim, lineWidth: 1.6 }),
              seg(24.5, 23.5, 30.5, 29.5, 1.6, PR.textDim),
              label("搜索…", 42, 0, 200, 40, { size: 13, color: PR.textDim }),
            ],
          },
        },
        // 导航项：选中态浅灰底 + 图标位 + 文字（样图 3 左侧菜单）
        {
          id: "proto-navitem", name: "导航项",
          def: {
            type: "group", w: 200, h: 42,
            children: [
              box(0, 0, 200, 42, { fill: PR.surface, line: "transparent", lineWidth: 0, cornerRadius: 8 }),
              box(14, 13, 16, 16, { fill: PR.skeletonDeep, line: "transparent", lineWidth: 0, cornerRadius: 4 }),
              label("导航项", 42, 0, 144, 42, { size: 13, bold: true }),
            ],
          },
        },
        // 列表项：缩略图 + 标题 + 次要说明（样图 1 的文章列表行）
        {
          id: "proto-listitem", name: "列表项",
          def: {
            type: "group", w: 320, h: 76,
            children: [
              box(0, 0, 320, 76, { fill: PR.white, line: PR.line, lineWidth: 1, cornerRadius: 10 }),
              box(14, 14, 48, 48, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 10 }),
              label("列表标题", 76, 14, 230, 26, { size: 13, bold: true }),
              box(76, 46, 170, 9, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 4 }),
            ],
          },
        },
        // 表格：组合承载的网格，单元格由 table.rows/cols 推导生成（见 table.js），
        // 行列数在属性面板调整；children 在插入时按包围盒实时生成
        {
          id: "proto-table", name: "表格",
          def: {
            type: "group", w: 320, h: 160,
            table: { rows: 4, cols: 3, header: true },
            children: [],
          },
        },
        // 卡片：白底细边容器 + 标题 + 骨架正文条
        {
          id: "proto-card", name: "卡片",
          def: {
            type: "group", w: 280, h: 168,
            children: [
              box(0, 0, 280, 168, { fill: PR.white, line: PR.line, lineWidth: 1, cornerRadius: 12 }),
              label("卡片标题", 18, 16, 244, 24, { size: 14, bold: true }),
              box(18, 54, 176, 10, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 5 }),
              box(18, 72, 138, 10, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 5 }),
              box(18, 122, 64, 26, { fill: PR.surface, line: "transparent", lineWidth: 0, cornerRadius: 13 }),
              label("标签", 18, 122, 64, 26, { size: 12, align: "center" }),
            ],
          },
        },
        // 深色卡片：深墨蓝底 + 白字 + 白色小按钮（样图 1 的 Start Learning 卡）
        {
          id: "proto-darkcard", name: "深色卡片",
          def: {
            type: "group", w: 260, h: 156,
            children: [
              box(0, 0, 260, 156, { fill: PR.navy, line: "transparent", lineWidth: 0, cornerRadius: 12 }),
              label("深色卡片", 18, 18, 180, 22, { size: 15, bold: true, color: PR.white }),
              box(18, 50, 150, 10, { fill: PR.navySoft, line: "transparent", lineWidth: 0, cornerRadius: 5 }),
              box(18, 68, 148, 10, { fill: PR.navySoft, line: "transparent", lineWidth: 0, cornerRadius: 5 }),
              box(200, 44, 42, 42, { fill: "#3F3E64", line: "transparent", lineWidth: 0, cornerRadius: 8 }),
              box(18, 106, 96, 32, { fill: PR.white, line: "transparent", lineWidth: 0, cornerRadius: 7 }),
              label("查看详情", 18, 106, 96, 32, { size: 12, bold: true, align: "center", color: PR.navy }),
            ],
          },
        },
        // 对话框：标题 + 关闭叉 + 表单字段 + 分隔线 + 取消/保存（样图 2 的弹窗）
        {
          id: "proto-dialog", name: "对话框",
          def: {
            type: "group", w: 340, h: 240,
            children: [
              box(0, 0, 340, 240, { fill: PR.white, line: PR.line, lineWidth: 1, cornerRadius: 14 }),
              label("对话框标题", 24, 14, 250, 34, { size: 15, bold: true }),
              seg(298, 22, 308, 32, 2, PR.textDim),
              seg(308, 22, 298, 32, 2, PR.textDim),
              label("字段名称", 24, 58, 200, 18, { size: 12, color: PR.textDim }),
              box(24, 78, 292, 36, { fill: PR.white, line: PR.fieldLine, lineWidth: 1, cornerRadius: 6 }),
              label("请输入…", 34, 78, 272, 36, { size: 13, color: PR.textDim }),
              box(24, 126, 280, 10, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 5 }),
              box(24, 146, 220, 10, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 5 }),
              box(0, 180, 340, 1, { fill: PR.skeleton, line: "transparent", lineWidth: 0 }),
              box(168, 196, 72, 34, { fill: PR.white, line: PR.fieldLine, lineWidth: 1, cornerRadius: 8 }),
              label("取消", 168, 196, 72, 34, { size: 13, align: "center" }),
              box(252, 196, 72, 34, { fill: PR.navy, line: "transparent", lineWidth: 0, cornerRadius: 8 }),
              label("保存", 252, 196, 72, 34, { size: 13, align: "center", color: PR.white }),
            ],
          },
        },
        {
          id: "proto-badge", name: "标签",
          def: {
            type: "rect", w: 76, h: 26, text: "标签",
            style: { cornerRadius: 13, fill: PR.surface, line: "transparent", lineWidth: 0, font: font({ size: 12, color: PR.text }) },
          },
        },
        // 数据指标：小标题 + 大数值（样图 3 的 Planned hours / 42:00）
        {
          id: "proto-stat", name: "数据指标",
          def: {
            type: "group", w: 180, h: 70,
            children: [
              label("指标名称", 0, 0, 180, 20, { size: 12, color: PR.textDim }),
              label("42:00", 0, 22, 180, 36, { size: 20, bold: true }),
              box(0, 62, 120, 8, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 4 }),
            ],
          },
        },
        // 日历事件：左侧色条 + 标题 + 骨架说明 + 时间（样图 3 的周视图事件块）
        {
          id: "proto-event", name: "日历事件",
          def: {
            type: "group", w: 200, h: 112,
            children: [
              box(0, 0, 200, 112, { fill: PR.white, line: PR.line, lineWidth: 1, cornerRadius: 10 }),
              box(1, 12, 3, 30, { fill: PR.navy, line: "transparent", lineWidth: 0, cornerRadius: 2 }),
              label("事件标题", 16, 14, 160, 20, { size: 13, bold: true }),
              box(16, 42, 120, 9, { fill: PR.skeleton, line: "transparent", lineWidth: 0, cornerRadius: 4 }),
              label("08:00 - 12:00", 16, 78, 150, 18, { size: 11, color: PR.textDim }),
            ],
          },
        },
        // 图片占位：浅灰卡片 + 居中的山形剪影（对齐 图片占位.svg：圆点太阳 + 前后两座山）
        {
          id: "proto-image", name: "图片占位",
          def: {
            type: "group", w: 140, h: 100,
            children: [
              box(0, 0, 140, 100, { fill: PR.phFill, line: "transparent", lineWidth: 0, cornerRadius: 6 }),
              // 后山（右）：包围盒 24×19.5，位于卡片 44%~61% 宽
              poly([{ x: 0, y: -9.75 }, { x: 12, y: 9.75 }, { x: -12, y: 9.75 }], 61.6, 43, 24, 19.5,
                { fill: PR.phInk, line: "transparent", lineWidth: 0 }),
              // 前山（左）：包围盒 18.4×14.9，压在后山左侧形成山峦层次
              poly([{ x: 0, y: -7.45 }, { x: 9.2, y: 7.45 }, { x: -9.2, y: 7.45 }], 53.4, 47.6, 18.4, 14.9,
                { fill: PR.phInk, line: "transparent", lineWidth: 0 }),
              // 太阳：直径 ≈ 卡片宽 4%，贴在前山左上方
              ellipse(61.05, 38.65, 5.5, 5.5, { fill: PR.phInk, line: "transparent", lineWidth: 0 }),
            ],
          },
        },
        // 照片占位：圆形底 + 人像剪影（对齐 照片占位.svg：头 17% 直径、肩宽 35%）
        {
          id: "proto-avatar", name: "照片占位",
          def: {
            type: "group", w: 76, h: 76,
            children: [
              ellipse(0, 0, 76, 76, { fill: PR.phFill, line: "transparent", lineWidth: 0 }),
              ellipse(31.42, 20.05, 13.16, 13.16, { fill: PR.phInk, line: "transparent", lineWidth: 0 }),
              poly(archPoly(26.9, 7.4), 24.55, 41.8, 26.9, 7.4,
                { fill: PR.phInk, line: "transparent", lineWidth: 0 }),
            ],
          },
        },
        {
          id: "proto-placeholder", name: "通用占位",
          def: {
            type: "rect", w: 140, h: 100, text: "占位符",
            style: { cornerRadius: 8, fill: "#F1F2F5", line: "transparent", lineWidth: 0, font: font({ size: 13, color: PR.textDim }) },
          },
        },
        // 骨架占位条：正文/标题占位（样图里大量的灰色圆角条）
        {
          id: "proto-skeleton", name: "骨架占位条",
          def: {
            type: "rect", w: 200, h: 12,
            style: { cornerRadius: 6, fill: PR.skeleton, line: "transparent", lineWidth: 0 },
          },
        },
        {
          id: "proto-panel", name: "动态面板",
          def: {
            type: "panel", w: 240, h: 160,
            // 显式透明描边：否则会被 stencilStyle 补上主描边，缩略图变成与矩形无异的粗实线框
            style: { fill: "transparent", line: "transparent", lineWidth: 0 },
            panel: { states: [{ id: "st1", name: "状态 1", shapes: [] }] },
          },
        },
        {
          id: "proto-repeater", name: "中继器",
          def: {
            type: "rect", w: 220, h: 140, text: "中继器",
            style: { cornerRadius: 10, fill: PR.white, line: PR.line, lineWidth: 1, font: font({ color: PR.textDim }) },
          },
        },
        {
          id: "proto-hotspot", name: "热区",
          def: {
            type: "rect", w: 160, h: 90, text: "热区",
            style: { cornerRadius: 6, fill: SK.warnFill, line: SK.warnLine, lineWidth: 1, font: font({ color: SK.warnText }) },
          },
        },
      ],
    },
  ];

  // ---------- 创建：深拷贝模板 + 补齐默认字段 ----------
  function offsetChildren(list, dx, dy) {
    for (const s of list || []) {
      s.x += dx; s.y += dy;
      if (s.type === "group") offsetChildren(s.children, dx, dy);
    }
  }

  function assignIds(list) {
    for (const s of list || []) {
      s.id = VX.Model.nextId();
      if (s.type === "group") assignIds(s.children);
    }
  }

  // 条目实际样式：默认「无填充 + 深灰描边」，条目 def.style 覆盖；
  // 无填充时字色落成深色（否则默认白字在白纸上不可见）
  function stencilStyle(def) {
    const base = VX.Model.defaultStyleFor ? VX.Model.defaultStyleFor(def.type) : {};
    const defStyle = def.style || {};
    const out = Object.assign(base, { fill: "transparent", line: SK.ink, lineWidth: SK.lineWidth }, defStyle);
    if (!defStyle.font && out.fill === "transparent") {
      out.font = Object.assign({}, base.font || {}, { color: SK.text });
    }
    return out;
  }

  // item.def 是共享模板——创建时深拷贝并补默认字段
  // 默认样式：黑色边框 + 无填充；条目 def.style 可覆盖（原型控件的浅底/灰字等）
  function makeShapeProps(item, x, y) {
    const props = JSON.parse(JSON.stringify(item.def));
    props.x = x; props.y = y;
    props.style = stencilStyle(props);

    if (props.type === "connector") {
      const b = props.begin || { x: 0, y: 0 };
      const e = props.end || { x: props.w || 160, y: 0 };
      props.begin = { x: x + b.x, y: y + b.y };
      props.end = { x: x + e.x, y: y + e.y };
      props.route = props.route || "ortho";
    }
    // 表格：单元格按世界坐标由包围盒推导，不走「左上角=0,0 + 整体平移」的组合插入路径
    if (props.table && VX.Table) {
      VX.Table.build(props);
      return props;
    }
    if (props.children) {
      offsetChildren(props.children, x, y);
      assignIds(props.children);
    }
    return props;
  }

  // 左面板渲染：分类标题 + 缩略图网格
  function renderPanel(rootEl) {
    rootEl.innerHTML = "";
    for (const cat of categories) {
      const head = document.createElement("div");
      head.className = "stencil-cat";
      head.textContent = cat.name;
      rootEl.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "stencil-grid";
      for (const item of cat.items) {
        const cell = document.createElement("div");
        cell.className = "stencil-item";
        cell.title = item.name;
        const cv = document.createElement("canvas");
        // 单条缩略图出错不能拖垮整个面板（否则后面的条目会整批消失）
        try {
          drawThumb(cv, item.def);
        } catch (e) {
          console.warn("stencil thumb failed:", item.id, e);
        }
        const labelEl = document.createElement("div");
        labelEl.className = "stencil-name";
        labelEl.textContent = item.name;
        cell.appendChild(cv);
        cell.appendChild(labelEl);
        cell.addEventListener("click", () => {
          // 在当前视口中心创建（网格吸附）
          const c = document.getElementById("canvas");
          const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
          const wpt = VX.Viewport.s2w(cx, cy);
          const def = item.def;
          const x = Math.round((wpt.x - def.w / 2) / VX.state.gridSize) * VX.state.gridSize;
          const y = Math.round((wpt.y - def.h / 2) / VX.state.gridSize) * VX.state.gridSize;
          let id;
          VX.History.run("插入" + item.name, () => {
            id = VX.Model.addShape(def.type, makeShapeProps(item, x, y)).id;
          });
          VX.state.selection = [id];
          VX.state.enterGroup = null;
          VX.Events.emit("selection");
          VX.Renderer.invalidate();
        });
        grid.appendChild(cell);
      }
      rootEl.appendChild(grid);
    }
  }

  // ---------- 缩略图：按包围盒等比缩放，与插入后的样式一致 ----------
  // 缩略图画布逻辑尺寸（CSS px）；实际像素按 devicePixelRatio 放大，保证高分屏下线条不模糊
  const THUMB_W = 72, THUMB_H = 48;

  function drawThumb(cv, def) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(THUMB_W * dpr);
    cv.height = Math.round(THUMB_H * dpr);
    cv.style.aspectRatio = THUMB_W + " / " + THUMB_H;

    const c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineJoin = "round";
    c.lineCap = "round";

    // 统一的内边距：所有条目在单元格里留白一致，视觉重心才会齐
    const pad = 7;
    const w = Math.max(def.w || 1, 1), h = Math.max(def.h || 1, 1);
    const k = Math.min((THUMB_W - pad * 2) / w, (THUMB_H - pad * 2) / h);
    const ox = (THUMB_W - w * k) / 2, oy = (THUMB_H - h * k) / 2;
    c.save();
    c.translate(ox, oy);
    c.scale(k, k);
    drawThumbNode(c, def, k);
    c.restore();
  }

  // 节点绘制：坐标为条目局部坐标（左上角 = 0,0）
  // 圆角矩形：老版本 WebView2 没有 ctx.roundRect，退化为手写路径
  function thumbRoundRect(c, x, y, w, h, r) {
    if (typeof c.roundRect === "function") { c.roundRect(x, y, w, h, r || 0); return; }
    const rad = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    c.moveTo(x + rad, y);
    c.lineTo(x + w - rad, y);
    c.arcTo(x + w, y, x + w, y + rad, rad);
    c.lineTo(x + w, y + h - rad);
    c.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    c.lineTo(x + rad, y + h);
    c.arcTo(x, y + h, x, y + h - rad, rad);
    c.lineTo(x, y + rad);
    c.arcTo(x, y, x + rad, y, rad);
    c.closePath();
  }

  function drawThumbNode(c, s, k) {
    // 缩略图与插入后的效果一致：模板没写 style 的条目也套用统一色板的主描边
    const st = Object.assign(stencilStyle(s), s.style || {});
    // 表格：缩略图用同一套构建逻辑生成单元格，保证与插入后所见一致
    if (s.table && VX.Table) {
      const tmp = { type: "group", x: 0, y: 0, w: s.w, h: s.h, table: s.table, children: [] };
      VX.Table.build(tmp, { ids: false });
      for (const ch of tmp.children || []) drawThumbNode(c, ch, k);
      return;
    }
    if (s.type === "group") {
      for (const ch of s.children || []) drawThumbNode(c, ch, k);
      return;
    }
    if (s.type === "connector") {
      const y = (s.h || 0) / 2;
      const x1 = 4, x2 = Math.max((s.w || 120) - 4, x1 + 4);
      c.strokeStyle = SK.ink;
      c.lineWidth = SK.lineWidth / k;
      c.beginPath();
      c.moveTo(x1, y); c.lineTo(x2, y);
      c.stroke();
      const ah = 10;
      c.beginPath();
      c.moveTo(x2, y);
      c.lineTo(x2 - ah, y - ah * 0.55);
      c.lineTo(x2 - ah, y + ah * 0.55);
      c.closePath();
      c.fillStyle = SK.ink;
      c.fill();
      return;
    }
    if (s.type === "text") {
      drawThumbText(c, s, k, st, "left");
      return;
    }

    // rect / ellipse / path / panel
    const sx = s.x || 0, sy = s.y || 0;
    const cx = sx + (s.w || 0) / 2, cy = sy + (s.h || 0) / 2;
    c.save();
    c.translate(cx, cy);
    c.beginPath();
    if (s.type === "ellipse") {
      c.ellipse(0, 0, (s.w || 1) / 2, (s.h || 1) / 2, 0, 0, Math.PI * 2);
    } else if (s.type === "path") {
      // 与 renderer 同口径：默认闭合，只有显式声明 path.closed[i] === false 的开放折线不闭合
      const flags = (s.path && Array.isArray(s.path.closed)) ? s.path.closed : null;
      const ks = VX.Geometry.pathScale(s);
      const subs = (s.path && s.path.subpaths) || [];
      for (let k = 0; k < subs.length; k++) {
        const ring = subs[k];
        ring.forEach((p, i) => { if (i) c.lineTo(p.x * ks.kx, p.y * ks.ky); else c.moveTo(p.x * ks.kx, p.y * ks.ky); });
        if (!flags || flags[k] !== false) c.closePath();
      }
    } else {
      const r = Math.min(st.cornerRadius || 0, (s.w || 0) / 2, (s.h || 0) / 2);
      thumbRoundRect(c, -(s.w || 0) / 2, -(s.h || 0) / 2, s.w || 1, s.h || 1, r);
    }
    const hasFill = st.fill && st.fill !== "transparent";
    const hasLine = st.line && st.line !== "transparent" && (st.lineWidth == null || st.lineWidth > 0);
    if (hasFill) {
      c.fillStyle = st.fill;
      c.fill(s.type === "path" && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd");
    }
    if (hasLine) {
      c.strokeStyle = st.line;
      c.lineWidth = Math.max(st.lineWidth || 1, 0.5) / k;
      c.stroke();
    } else if (s.type === "panel") {
      c.strokeStyle = SK.inkSoft;
      c.lineWidth = SK.lineWidth / k;
      c.setLineDash([4 / k, 3 / k]);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();

    if (s.text) drawThumbText(c, s, k, st, st.font && st.font.align === "left" ? "left" : "center");
  }

  function drawThumbText(c, s, k, st, align) {
    const f = st.font || {};
    const size = f.size || 13;
    const sx = s.x || 0, sy = s.y || 0;
    const bw = s.w || 0, bh = s.h || 0;
    // 内边距按缩略比例反算：固定 3px 在缩小后不足 1px，字头会直接压在控件边框上
    const padX = Math.max(3, 2.5 / k);
    const availW = Math.max(bw - padX * 2, 10);
    // 字号向上放大提升可读性，但受行高约束（否则相邻两行文字会互相重叠），
    // 可读性阈值也要按放大后的字号算——按原字号算会把中等尺寸控件的文字整段跳掉
    let drawSize = Math.min(Math.max(size, Math.min(9 / k, size * 2.2)), Math.max(bh * 0.7, 1));
    if (drawSize * k < 3.2) return; // 太小，省略文字避免糊成一团
    const setFont = () => { c.font = `${f.bold ? "bold " : ""}${drawSize}px 'Segoe UI'`; };
    setFont();
    // 超宽时等比缩字而不是用 maxWidth 压扁字形
    const measured = c.measureText(s.text || "").width || 1;
    if (measured > availW) {
      drawSize *= availW / measured;
      if (drawSize * k < 3.2) return;
      setFont();
    }
    c.save();
    c.fillStyle = f.color || PR.text;
    c.textAlign = align === "center" ? "center" : "left";
    c.textBaseline = "middle";
    const tx = align === "center" ? sx + bw / 2 : sx + padX;
    c.fillText(s.text || "", tx, sy + bh / 2, availW);
    c.restore();
  }

  // tokens 同时供 table.js 复用同一套色板（表格单元格配色不另起 hex）
  VX.Stencils = { categories, renderPanel, tokens: { SK, PR } };
})();
