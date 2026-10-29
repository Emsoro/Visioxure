// model.js —— 文档模型（P1）
// 结构对齐 CODEPLAN.md §3 JSON Schema；P1 支持 fixed 页面尺寸 / 矩形·椭圆·文本 / 参考线
// 其余字段（image/path/panel/repeater/meta/interactions）在后续里程碑扩展
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
    pages: [],
  };

  let currentPageId = null;

  function makePage(name) {
    return {
      id: "p" + nextPageId++,
      name: name || ("页面-" + nextPageId),
      size: { mode: "fixed", w: 800, h: 1100, orientation: "portrait" },
      background: "#FFFFFF",  // 页面背景色
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

  const Model = {
    doc,
    state,
    on,
    emit,
    defaultStyleFor: defaultStyle, // 供形状库合并模板差异样式

    init() {
      const p = makePage("页面-1");
      doc.pages.push(p);
      currentPageId = p.id;
      state.dirty = true;
    },

    // ---- 页面 ----
    page(id) { return doc.pages.find((p) => p.id === (id || currentPageId)); },
    currentPageId() { return currentPageId; },
    setCurrentPage(id) {
      if (doc.pages.some((p) => p.id === id)) {
        currentPageId = id;
        state.selection = [];
        state.selGuides = [];
        state.dirty = true;
        emit("pagechange");
      }
    },
    addPage() {
      const p = makePage("页面-" + (doc.pages.length + 1));
      doc.pages.push(p);
      currentPageId = p.id;
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
        state.selection = [];
        state.selGuides = [];
      }
      state.dirty = true;
      emit("pagechange");
      emit("change");
      return true;
    },
    movePage(id, delta) {
      const i = doc.pages.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= doc.pages.length) return false;
      const [p] = doc.pages.splice(i, 1);
      doc.pages.splice(j, 0, p);
      state.dirty = true;
      emit("pagechange");
      emit("change");
      return true;
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
    shape(id) {
      const find = (arr) => {
        for (const s of arr || []) {
          if (s.id === id) return s;
          if (s.type === "group") { const f = find(s.children); if (f) return f; }
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

    // ---- 动态面板（P4）----
    panelStates(s) {
      return (s && s.type === "panel" && s.panel && Array.isArray(s.panel.states)) ? s.panel.states : [];
    },
    panelStateById(panel, id) { return this.panelStates(panel).find((x) => x.id === id) || null; },
    panelState(panel) {
      const st = this.panelStates(panel);
      if (!st.length) return null;
      if (panel.panel.active) {
        const hit = st.find((x) => x.id === panel.panel.active);
        if (hit) return hit;
      }
      return st[0];
    },
    activePanelShapes(panel) {
      const st = this.panelState(panel);
      if (!st) return [];
      if (!Array.isArray(st.shapes)) st.shapes = [];
      return st.shapes;
    },
    addPanelState(panel, name) {
      if (!panel.panel) panel.panel = { states: [] };
      const n = panel.panel.states.length + 1;
      const st = { id: "st" + Date.now().toString(36) + n, name: name || ("状态 " + n), shapes: [] };
      panel.panel.states.push(st);
      panel.panel.active = st.id;
      state.dirty = true;
      emit("change");
      return st;
    },
    removePanelState(panel, id) {
      if (!panel.panel || !Array.isArray(panel.panel.states)) return;
      panel.panel.states = panel.panel.states.filter((x) => x.id !== id);
      if (!panel.panel.states.length) panel.panel.states.push({ id: "st1", name: "状态 1", shapes: [] });
      if (panel.panel.active === id) panel.panel.active = panel.panel.states[0].id;
      state.dirty = true;
      emit("change");
    },
    setPanelState(panel, id) {
      if (this.panelStateById(panel, id)) {
        panel.panel.active = id;
        state.dirty = true;
        emit("change");
      }
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
      // 面板状态编辑中：新形状归入该状态，其余归页面
      const pe = state.panelEdit;
      if (pe) {
        const panel = this.shape(pe.panelId);
        const st = panel && this.panelStateById(panel, pe.stateId);
        if (st) {
          if (!Array.isArray(st.shapes)) st.shapes = [];
          st.shapes.push(s);
          state.dirty = true;
          return s;
        }
      }
      this.page().shapes.push(s);
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

    // 深拷贝形状（组递归重生成 id，避免复制后 id 冲突），偏移 (+10,+10)
    duplicateShape(id) {
      const src = this.shape(id);
      if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      const reid = (x) => {
        x.id = "s" + nextShapeId++;
        if (x.type === "group" && x.children) x.children.forEach(reid);
        return x;
      };
      reid(copy);
      copy.x += 10; copy.y += 10;
      copy.z = this.maxZ() + 1;
      this.page().shapes.push(copy);
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
          if (s.type === "group" && s.children) s.children = filt(s.children);
          if (!set.has(s.id)) out.push(s);
        }
        return out;
      };
      pg.shapes = filt(pg.shapes);
      for (const s of pg.shapes) if (s.type === "group") this.syncGroupBounds(s);
      state.selection = state.selection.filter((id) => !set.has(id));
      state.dirty = true;
    },

    // ---- P2：组合 / 解组 / 布尔 / 对齐 ----
    // 平移形状（group 递归平移子形状并同步包围盒）
    moveShapeBy(s, dx, dy) {
      if (!s) return;
      s.x += dx; s.y += dy;
      if (s.type === "group") {
        for (const ch of s.children || []) this.moveShapeBy(ch, dx, dy);
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
      const pg = this.page();
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
      pg.shapes = pg.shapes.filter((s) => !set.has(s.id));
      pg.shapes.push(g);
      state.selection = [g.id];
      state.enterGroup = null;
      state.dirty = true;
      emit("change");
      return g;
    },

    ungroup(ids) {
      const pg = this.page();
      const out = [];
      for (const id of (ids || state.selection)) {
        const g = this.shape(id);
        if (!g || g.type !== "group") continue;
        // 子形状回到页面（z 保持），插入到组原来所在位置之前
        const at = pg.shapes.indexOf(g);
        for (const ch of (g.children || []).reverse()) {
          pg.shapes.splice(at, 0, ch);
        }
        pg.shapes = pg.shapes.filter((s) => s !== g);
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
      // 重置 id 计数避免冲突（含组合/面板子形状）
      nextShapeId = 1; nextPageId = 1;
      const scan = (arr) => {
        for (const s of arr || []) {
          ensurePathDesign(s);   // 旧文件与导入的 vsdx 没有 design，按当前包围盒固化
          const sid = parseInt(String(s.id).slice(1), 10) || 1;
          nextShapeId = Math.max(nextShapeId, sid + 1);
          if (s.type === "group") scan(s.children);
          if (s.type === "panel") for (const st of (s.panel && s.panel.states) || []) scan(st.shapes);
        }
      };
      doc.pages.forEach((p) => {
        const pid = parseInt(String(p.id).slice(1), 10) || 1;
        nextPageId = Math.max(nextPageId, pid + 1);
        scan(p.shapes);
      });
      currentPageId = doc.pages[0] ? doc.pages[0].id : null;
      state.selection = [];
      state.selGuides = [];
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
