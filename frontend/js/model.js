// model.js —— 文档模型
// 结构对齐 CODEPLAN.md §3 JSON Schema；形状、页面、交互、动态面板状态等字段都在此定义与归一化
"use strict";

window.VX = window.VX || {};

(function () {
  let nextShapeId = 1;
  let nextPageId = 1;

  const listeners = {}; // event -> [fn]
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  const state = {
    selection: [],      // 选中的 shape id 列表
    selGuides: [],      // 选中的参考线（当前页内索引）
    tool: "select",
    zoom: 1,
    ox: 40, oy: 40,     // 世界原点的屏幕偏移（平移）
    grid: true,
    gridSize: 10,
    gridKind: "small",  // 网格绘制样式：small / large / dots / none（跟着页面设置走）
    mouse: { x: 0, y: 0 },   // 画布内屏幕坐标
    marquee: null,      // 框选矩形（世界坐标）
    alignLines: [],     // 吸附对齐线（世界坐标，瞬态）
    spaceDown: false,
    dirty: true,
    currentLayer: "l1", // 当前层：新形状归入
    enterGroup: null,   // 双击进入组合编辑时的组 id
    panelEdit: null,    // {panelId, stateId} 进入动态面板状态编辑
    rubberConn: null,   // 连接线拖拽预览 {begin:{x,y}, cur:{x,y}}（世界坐标，瞬态）
    hoverShapeId: null, // 鼠标悬停的形状 id（用于显示连接点，瞬态）
    hoverAnchor: null,  // 连接点吸附高亮 {id, index}（瞬态）
    hoverConnEnd: null, // 连接线端点悬停 {id, which:'begin'|'end'}（瞬态）
    connEndDrag: false, // 正在拖拽连接线端点（用于显示全部连接点）
  };

  const doc = {
    format: "visioxure",
    version: 1,
    doc: { theme: "light", variables: [] },
    assets: [],    // 图片资产：{ id, name, mime, ext, w, h, hash, dataUrl }
    library: [],   // 组件库母版：{ id, name, w, h, shapes: [] }
    pages: [],
  };

  let currentPageId = null;

  // 页面纸张的默认背景色：新建页面、新建文档、旧文件与未声明底色的 VSDX 都回退到它
  const DEFAULT_PAGE_BG = "#FFFFFF";

  // 页面网格样式：小网格（10px 细线）/ 大网格（10px 细线 + 每 50px 主线）/ 网点 / 无。
  // 只影响编辑器里的绘制与吸附，不进任何导出产物
  const GRID_KINDS = ["small", "large", "dots", "none"];

  // 当前页的网格样式落到编辑器状态：state.grid 仍是「显示 + 吸附」总开关（tools.js 靠它判断）
  function applyPageGrid(p) {
    const kind = p && GRID_KINDS.indexOf(p.grid) >= 0 ? p.grid : "small";
    state.gridKind = kind;
    state.grid = kind !== "none";
  }

  function makePage(name) {
    return {
      id: "p" + nextPageId++,
      name: name || ("页面-" + nextPageId),
      size: { mode: "fixed", w: 800, h: 1100, orientation: "portrait" },
      background: DEFAULT_PAGE_BG,  // 页面背景色
      grid: "small",        // 网格样式（页面设置里改）
      guides: [],           // {dir:'v'|'h', pos} 世界坐标
      variables: [],
      layers: [{ id: "l1", name: "默认", visible: true, locked: false }],
      shapes: [],
    };
  }

  function defaultStyle(type) {
    if (type === "text") {
      return { fill: "transparent", line: "transparent", lineWidth: 0, cornerRadius: 0, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#333333", bold: false, align: "left", vAlign: "top" } };
    }
    if (type === "path") {
      return { fill: "#7B68EE", line: "#5646B0", lineWidth: 1.5, cornerRadius: 0, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#FFFFFF", bold: false, align: "center", vAlign: "middle" } };
    }
    if (type === "connector") {
      return { line: "#37474F", lineWidth: 1.5, arrowEnd: true, arrowBegin: false,
               arrowEndKind: "arrow", arrowBeginKind: "none",
               arrowEndType: 4, arrowBeginType: 0, arrowEndSize: 2, arrowBeginSize: 2, opacity: 1,
               font: { family: "Segoe UI", size: 12, color: "#333333", bold: false, align: "center", vAlign: "middle" } };
    }
    if (type === "panel") {
      // 动态面板是透明容器，边框只在编辑器里以虚线示意
      return { fill: "transparent", line: "transparent", lineWidth: 1, cornerRadius: 0, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#333333", bold: false, align: "center", vAlign: "middle" } };
    }
    if (type === "repeater") {
      // 中继器是透明容器：内容由数据集 + 模板重复渲染，边框只在编辑器里示意
      return { fill: "transparent", line: "transparent", lineWidth: 1, cornerRadius: 0, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#333333", bold: false, align: "left", vAlign: "top" } };
    }
    if (type === "instance") {
      return null;   // 组件实例的样式由快照子形状各自持有
    }
    if (type === "image") {
      // 图片默认无填充/无边框，内容由 assetId 决定；边框仍可在样式面板打开
      return { fill: "transparent", line: "transparent", lineWidth: 1, cornerRadius: 0, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#333333", bold: false, align: "center", vAlign: "middle" } };
    }
    if (type === "ellipse") {
      return { fill: "#5BA85B", line: "#3D7A3D", lineWidth: 1.5, cornerRadius: 0, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#FFFFFF", bold: false, align: "center", vAlign: "middle" } };
    }
    return { fill: "#4A90D9", line: "#2B6CB0", lineWidth: 1.5, cornerRadius: 4, opacity: 1,
             font: { family: "Segoe UI", size: 14, color: "#FFFFFF", bold: false, align: "center", vAlign: "middle" } };
  }

  // path 的 subpaths 是「设计尺寸」下的局部坐标；创建/载入时把当时的包围盒固化为 design，
  // 之后改 w/h 就是相对 design 缩放图形（见 Geometry.pathScale）。
  // 必须在数据进入模型时物化：留到绘制时才取默认值的话，默认值会跟着新 w/h 一起变，缩放永远是 1
  function ensurePathDesign(s) {
    if (s && s.type === "path" && s.path && !s.path.design) s.path.design = { w: s.w, h: s.h };
  }

  // ---- 动态面板：数据契约与树操作 ----
  // shape.name = 面板名（状态编辑页签标题）；panel = { states, active, clip }
  // 状态里的子形状用世界坐标，面板本身是「视口」：移动时整体平移，改尺寸只改视口。
  function defaultPanel() {
    return { states: [{ id: "st1", name: "状态 1", shapes: [] }], active: "st1", clip: true };
  }

  // 新建面板的显示名：按文档里已用过的名字递增，避免「动态面板 1」重名
  function nextPanelName() {
    const used = new Set();
    const walk = (arr) => {
      for (const s of arr || []) {
        if (s.type === "panel" && s.name) used.add(s.name);
        walk(s.children);
        for (const st of (s.panel && s.panel.states) || []) walk(st.shapes);
        for (const t of (s.repeater && s.repeater.template) || []) walk(t);
      }
    };
    for (const p of doc.pages || []) walk(p.shapes);
    let n = 1;
    while (used.has("动态面板 " + n)) n++;
    return "动态面板 " + n;
  }

  // 所有入口（新建 / 载入 / VSDX 读回）都过这一层：旧文件可能缺 states、active、
  // 状态 id、shapes，甚至还是 P4 之前的 {action,targets} 旧 schema。
  // defaultClip=false 用于「载入旧文档」：旧文件本来不裁剪，强行开启会让坐标漂移到
  // 视口外的内容（历史版本移动面板不带动子形状留下的）突然全部消失。
  function normalizePanel(s, defaultClip) {
    if (!s || s.type !== "panel") return;
    // 先记下原文件是否显式声明过 clip：整段重建（旧 schema）时 defaultPanel 的 true 不能盖过它
    const raw = s.panel;
    const declaredClip = raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.clip === "boolean"
      ? raw.clip : null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.states)) {
      s.panel = defaultPanel();
    }
    const p = s.panel;
    p.states = p.states.filter((st) => st && typeof st === "object");
    if (!p.states.length) p.states = [{ id: "st1", name: "状态 1", shapes: [] }];
    const used = new Set();
    p.states.forEach((st, i) => {
      if (!st.id || used.has(st.id)) {
        let id = "st" + (i + 1) + "_" + i;
        let n = 1;
        while (used.has(id)) id = "st" + (i + 1) + "_" + (n++);
        st.id = id;
      }
      used.add(st.id);
      if (!st.name) st.name = "状态 " + (i + 1);
      if (!Array.isArray(st.shapes)) st.shapes = [];
    });
    if (!p.states.some((st) => st.id === p.active)) p.active = p.states[0].id;
    p.clip = declaredClip === null ? (defaultClip !== false) : declaredClip;
    if (!s.name) s.name = nextPanelName();
  }

  // 平移整棵子树：容器子形状（含连接线端点/折点、嵌套面板、中继器模板）都要跟着走
  function translateShapeTree(s, dx, dy) {
    if (!s) return;
    s.x = (s.x || 0) + dx;
    s.y = (s.y || 0) + dy;
    if (s.type === "connector") {
      for (const k of ["begin", "end"]) if (s[k]) { s[k].x += dx; s[k].y += dy; }
      for (const p of s.points || []) { p.x += dx; p.y += dy; }
    }
    for (const ch of s.children || []) translateShapeTree(ch, dx, dy);
    for (const st of (s.panel && s.panel.states) || []) for (const ch of st.shapes || []) translateShapeTree(ch, dx, dy);
    for (const t of (s.repeater && s.repeater.template) || []) translateShapeTree(t, dx, dy);
  }

  const Model = {
    doc,
    state,
    on,
    emit,
    defaultStyleFor: defaultStyle, // 供形状库合并模板差异样式
    DEFAULT_PAGE_BG,               // 页面纸张默认背景色（新建文档/新页面共用同一个值）

    init() {
      const p = makePage("页面-1");
      doc.pages.push(p);
      currentPageId = p.id;
      applyPageGrid(p);
      state.dirty = true;
    },

    // ---- 页面 ----
    page(id) { return doc.pages.find((p) => p.id === (id || currentPageId)); },
    currentPageId() { return currentPageId; },
    setCurrentPage(id) {
      if (doc.pages.some((p) => p.id === id)) {
        currentPageId = id;
        applyPageGrid(this.page(id));   // 网格样式是每页的设置
        state.selection = [];
        state.selGuides = [];
        state.panelEdit = null;  // 状态编辑上下文属于某一页，换页后必须失效
        state.enterGroup = null;
        state.dirty = true;
        emit("pagechange");
      }
    },
    addPage() {
      const p = makePage("页面-" + (doc.pages.length + 1));
      doc.pages.push(p);
      currentPageId = p.id;
      applyPageGrid(p);
      state.selection = [];
      state.selGuides = [];
      state.dirty = true;
      emit("pagechange");
      emit("change");
      return p;
    },
    renamePage(id, name) {
      const p = this.page(id);
      if (p && name) { p.name = name; state.dirty = true; emit("pagechange"); emit("change"); }
    },
    deletePage(id) {
      if (doc.pages.length <= 1) return false;
      const i = doc.pages.findIndex((p) => p.id === id);
      if (i < 0) return false;
      doc.pages.splice(i, 1);
      if (currentPageId === id) {
        currentPageId = doc.pages[Math.min(i, doc.pages.length - 1)].id;
        applyPageGrid(this.page(currentPageId));
        state.selection = [];
        state.selGuides = [];
      }
      state.dirty = true;
      emit("pagechange");
      emit("change");
      return true;
    },
    // 把页面直接挪到指定下标（拖拽排序用）；下标先夹到合法范围，原地不动则返回 false
    movePageTo(id, index) {
      const i = doc.pages.findIndex((p) => p.id === id);
      if (i < 0) return false;
      const j = Math.max(0, Math.min(doc.pages.length - 1, Math.floor(index)));
      if (j === i) return false;
      const [p] = doc.pages.splice(i, 1);
      doc.pages.splice(j, 0, p);
      state.dirty = true;
      emit("pagechange");
      emit("change");
      return true;
    },
    movePage(id, delta) {
      const i = doc.pages.findIndex((p) => p.id === id);
      if (i < 0) return false;
      return this.movePageTo(id, i + delta);
    },
    // 页面网格样式：small / large / dots / none（非法值回退小网格）
    setPageGrid(kind) {
      const p = this.page();
      if (!p) return;
      p.grid = GRID_KINDS.indexOf(kind) >= 0 ? kind : "small";
      applyPageGrid(p);
      state.dirty = true;
      emit("pagechange");
      emit("change");
    },
    // 页面尺寸（px）：宽/高写入 size，横竖方向随之推导
    setPageSize(w, h) {
      const p = this.page();
      if (!p) return;
      if (!p.size) p.size = { mode: "fixed", w: 800, h: 1100 };
      if (typeof w === "number" && isFinite(w) && w > 0) p.size.w = w;
      if (typeof h === "number" && isFinite(h) && h > 0) p.size.h = h;
      p.size.orientation = p.size.w > p.size.h ? "landscape" : "portrait";
      state.dirty = true;
      emit("pagechange");
      emit("change");
    },
    // 页面背景色：留空回落到白色
    setPageBackground(color) {
      const p = this.page();
      if (!p) return;
      p.background = color || "#FFFFFF";
      state.dirty = true;
      emit("pagechange");
      emit("change");
    },

    // ---- 形状 ----
    shapes() { return this.page().shapes; },
    // 当前编辑容器：动态面板状态编辑中新形状进该状态，其余进当前页
    shapeList() {
      const pe = state.panelEdit;
      if (pe) {
        const panel = this.shape(pe.panelId);
        const st = panel && this.panelStateById(panel, pe.stateId);
        if (st) {
          if (!Array.isArray(st.shapes)) st.shapes = [];
          return st.shapes;
        }
      }
      return this.page().shapes;
    },
    shape(id) {
      const find = (arr) => {
        for (const s of arr || []) {
          if (s.id === id) return s;
          if (s.type === "group" || s.type === "instance") { const f = find(s.children); if (f) return f; }
          if (s.type === "panel") {
            for (const st of (s.panel && s.panel.states) || []) {
              const f = find(st.shapes);
              if (f) return f;
            }
          }
        }
        return null;
      };
      return find(this.page().shapes);
    },
    maxZ() {
      const mx = (arr) => (arr || []).reduce((m, s) => Math.max(m, s.z || 0), 0);
      let m = mx(this.page().shapes);
      const pe = state.panelEdit;
      if (pe) {
        const p = this.shape(pe.panelId);
        const st = p && this.panelStateById(p, pe.stateId);
        if (st) m = mx(st.shapes);
      }
      return m;
    },

    // ---- 动态面板 ----
    normalizePanel,
    panelStates(s) { return (s && s.type === "panel" && s.panel && Array.isArray(s.panel.states)) ? s.panel.states : []; },
    panelStateById(panel, id) { return this.panelStates(panel).find((x) => x.id === id) || null; },
    panelState(panel) {
      const st = this.panelStates(panel);
      if (!st.length) return null;
      const hit = st.find((x) => x.id === (panel.panel && panel.panel.active));
      return hit || st[0];
    },
    activePanelShapes(panel) {
      const st = this.panelState(panel);
      if (!st) return [];
      if (!Array.isArray(st.shapes)) st.shapes = [];
      return st.shapes;
    },
    // 缺省裁剪（视口语义）；显式 clip:false 才让内容溢出显示
    panelClip(s) { return !!(s && s.type === "panel" && (!s.panel || s.panel.clip !== false)); },
    // 状态编辑页签标题：面板名（旧文件没有 name 时用 id 兜底）
    panelName(s) { return (s && (s.name || (s.type === "panel" ? "动态面板 " + s.id : s.id))) || "动态面板"; },
    addPanelState(panel, name, copyFromId) {
      normalizePanel(panel);
      const p = panel.panel;
      const src = copyFromId ? this.panelStateById(panel, copyFromId) : null;
      let shapes = [];
      if (src) {
        shapes = JSON.parse(JSON.stringify(src.shapes || []));
        const reid = (x) => {
          x.id = this.nextId();
          for (const c of x.children || []) reid(c);
          for (const st of (x.panel && x.panel.states) || []) for (const c of st.shapes || []) reid(c);
          for (const t of (x.repeater && x.repeater.template) || []) reid(t);
        };
        shapes.forEach(reid);
      }
      const st = { id: "st" + Date.now().toString(36) + "_" + (p.states.length + 1),
                   name: name || ("状态 " + (p.states.length + 1)), shapes };
      p.states.push(st);
      p.active = st.id;
      state.dirty = true;
      emit("change");
      return st;
    },
    removePanelState(panel, id) {
      normalizePanel(panel);
      const p = panel.panel;
      if (p.states.length <= 1) return false;   // 至少保留一个状态
      const i = p.states.findIndex((x) => x.id === id);
      if (i < 0) return false;
      p.states.splice(i, 1);
      if (p.active === id) p.active = p.states[Math.min(i, p.states.length - 1)].id;
      const pe = state.panelEdit;
      if (pe && pe.panelId === panel.id && pe.stateId === id) {
        pe.stateId = p.active;
        state.selection = [];
      }
      state.dirty = true;
      emit("change");
      return true;
    },
    // 状态排序（拖拽/上移下移）：只改顺序，不影响 active 与内容
    movePanelState(panel, id, delta) {
      normalizePanel(panel);
      const arr = panel.panel.states;
      const i = arr.findIndex((x) => x.id === id);
      if (i < 0) return false;
      const j = Math.max(0, Math.min(arr.length - 1, i + delta));
      if (i === j) return false;
      const [st] = arr.splice(i, 1);
      arr.splice(j, 0, st);
      state.dirty = true;
      emit("change");
      return true;
    },
    setPanelState(panel, id) {
      if (this.panelStateById(panel, id)) {
        panel.panel.active = id;
        const pe = state.panelEdit;
        if (pe && pe.panelId === panel.id) pe.stateId = id;
        state.dirty = true;
        emit("change");
      }
    },
    // 全部状态内容的包围盒并集（用于「适应内容尺寸」；容器子形状按自身包围盒计）
    panelContentBounds(panel) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const add = (s) => {
        if (s.type === "connector") {
          for (const p of [s.begin, s.end]) {
            if (!p) continue;
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          }
          return;
        }
        minX = Math.min(minX, s.x || 0); minY = Math.min(minY, s.y || 0);
        maxX = Math.max(maxX, (s.x || 0) + (s.w || 0)); maxY = Math.max(maxY, (s.y || 0) + (s.h || 0));
      };
      for (const st of this.panelStates(panel)) for (const ch of st.shapes || []) add(ch);
      return minX === Infinity ? null : { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    },
    // 视口对齐内容：内容保持世界坐标不动，只改面板的 x/y/w/h
    fitPanelToContent(panel) {
      const b = this.panelContentBounds(panel);
      if (!b) return false;
      panel.x = b.x; panel.y = b.y; panel.w = b.w; panel.h = b.h;
      state.dirty = true;
      emit("change");
      return true;
    },

    addShape(type, props) {
      const s = Object.assign({
        id: this.nextId(),
        type,
        x: 0, y: 0, w: 120, h: 80, angle: 0,
        z: this.maxZ() + 1,
        layer: state.currentLayer,
        lock: false,
        text: type === "text" ? "文本" : "",
        style: defaultStyle(type),
      }, props || {});
      ensurePathDesign(s);
      if (type === "panel") {
        if (!props || !props.panel) s.panel = defaultPanel();
        normalizePanel(s);   // 形状库/外部 JSON 的 panel 也统一补齐 active/clip
      }
      // 面板状态编辑中：新形状归入该状态，其余归页面
      this.shapeList().push(s);
      state.dirty = true;
      return s;
    },

    // 形状 id 分配（形状库创建组合子形状时复用）
    nextId() { return "s" + nextShapeId++; },

    updateShape(id, props) {
      const s = this.shape(id);
      if (s) { Object.assign(s, props); state.dirty = true; }
      return s;
    },

    // Ctrl+D：把当前选中的形状深拷贝一份，偏移 (+10,+10)
    duplicateShape(id) { return this.insertShapeCopy(this.shape(id), 10, 10); },

    // 插入形状快照（Ctrl+C/V 剪贴板、Ctrl+D 共用）：重新分配 id、整体平移、放入当前编辑容器
    insertShapeCopy(src, dx, dy) {
      if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      const reid = (x) => {
        x.id = this.nextId();
        for (const c of x.children || []) reid(c);
        for (const st of (x.panel && x.panel.states) || []) for (const c of st.shapes || []) reid(c);
        for (const t of (x.repeater && x.repeater.template) || []) reid(t);
      };
      reid(copy);
      // 容器子形状/连接线端点/中继器模板都是世界坐标：副本整体偏移时它们必须一起走
      translateShapeTree(copy, dx, dy);
      copy.z = this.maxZ() + 1;
      this.shapeList().push(copy);
      if (copy.type === "panel") copy.name = nextPanelName();
      state.dirty = true;
      return copy;
    },

    removeShapes(ids) {
      const set = new Set(ids);
      // 面板状态编辑中：只删除该状态内的形状
      const pe = state.panelEdit;
      if (pe) {
        const panel = this.shape(pe.panelId);
        const st = panel && this.panelStateById(panel, pe.stateId);
        if (st) {
          st.shapes = (st.shapes || []).filter((s) => !set.has(s.id));
          state.selection = state.selection.filter((id) => !set.has(id));
          state.dirty = true;
          return;
        }
      }
      const pg = this.page();
      // 递归过滤：支持组编辑模式下删除子形状；删除后同步组包围盒
      const filt = (arr) => {
        const out = [];
        for (const s of arr) {
          if ((s.type === "group" || s.type === "instance") && s.children) s.children = filt(s.children);
          if (!set.has(s.id)) out.push(s);
        }
        return out;
      };
      pg.shapes = filt(pg.shapes);
      for (const s of pg.shapes) if (s.type === "group" || s.type === "instance") this.syncGroupBounds(s);
      state.selection = state.selection.filter((id) => !set.has(id));
      state.dirty = true;
    },

    // ---- P2：组合 / 解组 / 布尔 / 对齐 ----
    // 平移形状：组合/实例/动态面板的子形状都是世界坐标，必须整体跟随
    moveShapeBy(s, dx, dy) {
      if (!s) return;
      s.x += dx; s.y += dy;
      if (s.type === "group" || s.type === "instance") {
        for (const ch of s.children || []) translateShapeTree(ch, dx, dy);
      } else if (s.type === "panel") {
        for (const st of this.panelStates(s)) for (const ch of st.shapes || []) translateShapeTree(ch, dx, dy);
      }
    },

    // 组包围盒 = 子形状 AABB 并集（旋转形状按其 AABB，P2 简化）
    syncGroupBounds(g) {
      if (!g || g.type !== "group") return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ch of g.children || []) {
        if (ch.type === "group") this.syncGroupBounds(ch);
        minX = Math.min(minX, ch.x); minY = Math.min(minY, ch.y);
        maxX = Math.max(maxX, ch.x + ch.w); maxY = Math.max(maxY, ch.y + ch.h);
      }
      if (minX === Infinity) return;
      g.x = minX; g.y = minY; g.w = maxX - minX; g.h = maxY - minY;
    },

    group(ids) {
      const shapes = (ids || state.selection).map((id) => this.shape(id)).filter(Boolean);
      if (shapes.length < 2) return null;
      const list = this.shapeList();
      const z = Math.max(...shapes.map((s) => s.z || 0));
      const set = new Set(shapes.map((s) => s.id));
      const g = {
        id: "s" + nextShapeId++,
        type: "group",
        x: 0, y: 0, w: 0, h: 0, angle: 0,
        z: z,
        layer: state.currentLayer,
        lock: false, text: "", style: null,
        children: shapes,
      };
      this.syncGroupBounds(g);
      for (let i = list.length - 1; i >= 0; i--) if (set.has(list[i].id)) list.splice(i, 1);
      list.push(g);
      state.selection = [g.id];
      state.enterGroup = null;
      state.dirty = true;
      emit("change");
      return g;
    },

    ungroup(ids) {
      const list = this.shapeList();
      const out = [];
      for (const id of (ids || state.selection)) {
        const g = this.shape(id);
        if (!g || g.type !== "group") continue;
        const at = list.indexOf(g);
        if (at < 0) continue;   // 组不在当前编辑容器里则跳过
        // 子形状回到容器（z 保持），插入到组原来所在位置之前
        for (const ch of (g.children || []).slice().reverse()) list.splice(at, 0, ch);
        list.splice(list.indexOf(g), 1);
        out.push(...(g.children || []).map((c) => c.id));
      }
      state.selection = out;
      state.enterGroup = null;
      state.dirty = true;
      emit("change");
      return out;
    },

    // 布尔运算：kind = 'union' | 'intersect' | 'subtract'
    booleanOp(kind) {
      const shapes = state.selection.map((id) => this.shape(id))
        .filter(Boolean)
        .filter((s) => ["rect", "ellipse", "path", "text"].includes(s.type))
        .sort((a, b) => (a.z || 0) - (b.z || 0)); // z 升序：底层为 subject
      if (shapes.length < 2) return null;
      const props = VX.Geometry.booleanShape(kind, shapes);
      if (!props) return null;
      const pg = this.page();
      const at = pg.shapes.indexOf(shapes[0]); // 结果占据最底层形状的位置
      const ids = new Set(shapes.map((s) => s.id));
      const s = this.addShape("path", props);
      pg.shapes = pg.shapes.filter((x) => !ids.has(x.id));
      pg.shapes.splice(Math.max(0, at), 0, s);
      state.selection = [s.id];
      state.dirty = true;
      emit("change");
      return s;
    },

    // 多选对齐：kind = left|hcenter|right|top|vcenter|bottom
    align(kind) {
      const shapes = state.selection.map((id) => this.shape(id)).filter(Boolean);
      if (shapes.length < 2) return;
      const minX = Math.min(...shapes.map((s) => s.x));
      const maxX = Math.max(...shapes.map((s) => s.x + s.w));
      const minY = Math.min(...shapes.map((s) => s.y));
      const maxY = Math.max(...shapes.map((s) => s.y + s.h));
      for (const s of shapes) {
        if (kind === "left") this.moveShapeBy(s, minX - s.x, 0);
        else if (kind === "right") this.moveShapeBy(s, maxX - (s.x + s.w), 0);
        else if (kind === "hcenter") this.moveShapeBy(s, (minX + maxX) / 2 - (s.x + s.w / 2), 0);
        else if (kind === "top") this.moveShapeBy(s, 0, minY - s.y);
        else if (kind === "bottom") this.moveShapeBy(s, 0, maxY - (s.y + s.h));
        else if (kind === "vcenter") this.moveShapeBy(s, 0, (minY + maxY) / 2 - (s.y + s.h / 2));
      }
      state.dirty = true;
      emit("change");
    },

    // 均分：axis = 'h' | 'v'（按包围盒，至少 3 个）
    distribute(axis) {
      const shapes = state.selection.map((id) => this.shape(id)).filter(Boolean);
      if (shapes.length < 3) return;
      if (axis === "h") {
        shapes.sort((a, b) => a.x - b.x);
        const total = (shapes[shapes.length - 1].x) - shapes[0].x;
        const sumW = shapes.reduce((m, s) => m + s.w, 0);
        const gap = (total - sumW) / (shapes.length - 1);
        let cur = shapes[0].x;
        for (const s of shapes) { this.moveShapeBy(s, cur - s.x, 0); cur += s.w + gap; }
      } else {
        shapes.sort((a, b) => a.y - b.y);
        const total = (shapes[shapes.length - 1].y) - shapes[0].y;
        const sumH = shapes.reduce((m, s) => m + s.h, 0);
        const gap = (total - sumH) / (shapes.length - 1);
        let cur = shapes[0].y;
        for (const s of shapes) { this.moveShapeBy(s, 0, cur - s.y); cur += s.h + gap; }
      }
      state.dirty = true;
      emit("change");
    },

    // ---- P2：图层 ----
    layers() { return this.page().layers; },
    addLayer(name) {
      const ls = this.page().layers;
      const l = { id: "l" + (ls.length + 1) + "_" + Date.now().toString(36), name: name || ("图层-" + (ls.length + 1)), visible: true, locked: false };
      ls.push(l);
      state.dirty = true;
      emit("change");
      return l;
    },
    setCurrentLayer(id) { state.currentLayer = id; emit("layers"); },
    toggleLayer(id, key) {
      const l = this.page().layers.find((x) => x.id === id);
      if (l) { l[key] = !l[key]; state.dirty = true; emit("change"); }
    },

    // ---- 序列化 ----
    serialize() { return JSON.stringify(doc); },
    load(json) {
      const d = JSON.parse(json);
      if (d.format !== "visioxure") throw new Error("bad format");
      doc.pages = d.pages;
      doc.doc = d.doc || doc.doc;
      // 图片资产与组件库（P6.5）：缺失时补空数组，旧文件不受影响
      doc.assets = Array.isArray(d.assets) ? d.assets : [];
      doc.library = Array.isArray(d.library) ? d.library : [];
      // 重置 id 计数避免冲突（含组合/面板/实例/中继器模板子形状）
      nextShapeId = 1; nextPageId = 1;
      const panelStateIds = new Map();     // panelId -> { ids, first }
      const stateActions = [];             // 旧文件里需要迁移的 setState 动作
      const scan = (arr) => {
        for (const s of arr || []) {
          ensurePathDesign(s);   // 旧文件与导入的 vsdx 没有 design，按当前包围盒固化
          const sid = parseInt(String(s.id).slice(1), 10) || 1;
          nextShapeId = Math.max(nextShapeId, sid + 1);
          for (const it of s.interactions || []) {
            for (const a of (it && it.actions) || []) if (a && a.type === "setState") stateActions.push(a);
          }
          if (s.type === "group") scan(s.children);
          if (s.type === "panel") {
            normalizePanel(s, false);   // 旧文件保持「不裁剪」，避免历史内容突然不可见
            panelStateIds.set(s.id, {
              ids: new Set(s.panel.states.map((x) => x.id)),
              first: s.panel.states[0].id,
            });
            for (const st of s.panel.states) scan(st.shapes);
          }
          if (s.type === "instance") scan(s.children);
          // 中继器模板是一组形状（重复渲染时按行插值），模板 id 也要计入
          if (s.type === "repeater" && s.repeater) scan(s.repeater.template);
        }
      };
      doc.pages.forEach((p) => {
        // 页面缺底色（旧文件 / 手写 JSON / 未声明 FillForegnd 的导入件）时回退白纸
        if (!p.background) p.background = DEFAULT_PAGE_BG;
        // 旧文件没有网格样式，统一补小网格
        if (GRID_KINDS.indexOf(p.grid) < 0) p.grid = "small";
        const pid = parseInt(String(p.id).slice(1), 10) || 1;
        nextPageId = Math.max(nextPageId, pid + 1);
        scan(p.shapes);
      });
      // 旧版「切换面板状态」下拉在没手动改过时只显示第一态、却不写入 state，文档里存成 ""。
      // 旧运行时把它当成「回到默认态」，于是按钮点了看不出变化。载入时物化成明确的状态 id，
      // 顺便把指向已删除状态的动作修正到第一态（next/prev/cycle 是合法的特殊值，保留）。
      for (const a of stateActions) {
        const info = panelStateIds.get(a.target);
        if (!info) continue;
        const key = String(a.state == null ? "" : a.state).trim();
        if (key !== "next" && key !== "prev" && key !== "cycle" && (!key || !info.ids.has(key))) {
          a.state = info.first;
        }
      }
      currentPageId = doc.pages[0] ? doc.pages[0].id : null;
      applyPageGrid(doc.pages[0]);
      state.selection = [];
      state.selGuides = [];
      state.panelEdit = null;   // 载入新文档后旧的状态编辑上下文必须失效
      state.hoverShapeId = null;
      state.hoverAnchor = null;
      state.hoverConnEnd = null;
      state.connEndDrag = false;
      state.dirty = true;
      emit("pagechange");
      emit("change");
    },
  };

  VX.Model = Model;
  VX.state = state;
  VX.Events = { on, emit };
})();
