// interact.js —— Axure 式交互运行时（P4）
// 预览（F5）与后续 HTML 导出共用：事件 → 动作、三级变量作用域、动态面板状态、动效
"use strict";

(function () {
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 递归查找形状（含组合、面板各状态）
  function findShape(arr, id) {
    for (const s of arr || []) {
      if (s.id === id) return s;
      if (s.type === "group" || s.type === "instance") {
        const f = findShape(s.children, id);
        if (f) return f;
      }
      if (s.type === "panel") {
        for (const st of (s.panel && s.panel.states) || []) {
          const f = findShape(st.shapes, id);
          if (f) return f;
        }
      }
    }
    return null;
  }

  // 遍历页面形状树。传 stateOf(shape) 时动态面板只遍历当前激活状态（页面载入/键盘事件），
  // 不传则遍历全部状态（查找形状、兼容旧调用）
  function walk(arr, fn, stateOf) {
    for (const s of arr || []) {
      fn(s);
      if (s.type === "group" || s.type === "instance") walk(s.children, fn, stateOf);
      if (s.type === "panel") {
        const states = (s.panel && s.panel.states) || [];
        const sid = stateOf ? stateOf(s) : null;
        const one = sid ? states.find((x) => x.id === sid) : null;
        for (const st of (one ? [one] : states)) walk(st.shapes, fn, stateOf);
      }
    }
  }

  function create(srcDoc) {
    const doc = clone(srcDoc);
    // 与编辑器 Model.load 同口径：旧文件/手写 JSON 的面板在运行时也要补齐 states/active/clip
    if (VX.Model && VX.Model.normalizePanel) {
      for (const p of doc.pages || []) walk(p.shapes, (s) => VX.Model.normalizePanel(s, false));
    }
    const vars = { global: {}, page: {}, local: {} };
    const overrides = new Map();   // shapeId → { visible,text,state,dx,dy,opacity,panelFx }
    const anims = [];
    let pageId = doc.pages && doc.pages[0] ? doc.pages[0].id : null;
    let eventDepth = 0;            // OnStateChange → setState 递归保护

    const byId = (id) => (doc.pages || []).find((p) => p.id === id) || null;
    const page = () => byId(pageId);
    const ov = (id) => {
      let o = overrides.get(id);
      if (!o) { o = {}; overrides.set(id, o); }
      return o;
    };

    // 中继器动作的目标解析：只认 repeater 形状（普通形状不响应这些动作）
    function repeaterOf(id) {
      const s = findShape((page() || {}).shapes, id);
      return s && s.type === "repeater" ? s : null;
    }
    function relayoutRepeater(s) { if (VX.Repeater) VX.Repeater.relayout(s); }

    function applyDefaults(list, target) {
      for (const v of list || []) {
        if (v && v.name) target[v.name] = v.default != null ? v.default : "";
      }
    }

    // {{var}} 插值：local → page → global
    function interpolate(text) {
      if (typeof text !== "string") return text == null ? "" : String(text);
      return text.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (m, name) => {
        if (vars.local[name] != null) return String(vars.local[name]);
        if (vars.page[name] != null) return String(vars.page[name]);
        if (vars.global[name] != null) return String(vars.global[name]);
        return m;
      });
    }

    function displayText(shape) {
      const o = overrides.get(shape.id);
      const raw = o && o.text != null ? o.text : shape.text;
      return raw != null ? interpolate(raw) : "";
    }

    function over(shape) {
      const o = overrides.get(shape.id) || {};
      const hasText = shape.text != null || o.text != null;
      return {
        visible: o.visible,
        text: hasText ? displayText(shape) : null,
        state: o.state,
        dx: o.dx,
        dy: o.dy,
        opacity: o.opacity,
        panelFx: o.panelFx,
      };
    }

    // 遍历可见形状树时取面板的当前状态（运行时覆盖优先，设计态 active 兜底）
    const activeStateOf = (s) => {
      const o = overrides.get(s.id);
      const st = (o && o.state && VX.Model.panelStateById(s, o.state)) || VX.Model.panelState(s);
      return st ? st.id : null;
    };

    function animate(o, prop, from, to, dur, done) {
      anims.push({ o, prop, from, to, dur: Math.max(1, dur), t: 0, done });
    }

    function tick(dt) {
      let active = false;
      for (let i = anims.length - 1; i >= 0; i--) {
        const a = anims[i];
        a.t += dt;
        const k = Math.min(1, a.t / a.dur);
        a.o[a.prop] = a.from + (a.to - a.from) * k;
        if (k >= 1) {
          anims.splice(i, 1);
          if (a.done) a.done();
        }
        active = true;
      }
      return active;
    }

    function runAction(a, shape) {
      if (!a || !a.type) return;
      switch (a.type) {
        case "openLink": {
          if (a.url) { window.open(a.url, "_blank"); return; }
          if (a.target) goPage(a.target);
          return;
        }
        case "show":
        case "hide": {
          const ids = String(a.target || "").split(",").map((x) => x.trim()).filter(Boolean);
          for (const id of ids) {
            const o = ov(id);
            if (a.type === "hide") {
              if (a.effect === "fade") {
                animate(o, "opacity", o.opacity == null ? 1 : o.opacity, 0, 220, () => { o.visible = false; o.opacity = 1; });
              } else {
                o.visible = false;
              }
            } else {
              o.visible = true;
              if (a.effect === "fade") {
                o.opacity = 0;
                animate(o, "opacity", 0, 1, 220);
              } else {
                o.opacity = 1;
              }
            }
          }
          return;
        }
        case "setState": {
          const panel = findShape((page() || {}).shapes, a.target);
          if (!panel || panel.type !== "panel") return;
          const states = (panel.panel && panel.panel.states) || [];
          if (!states.length) return;
          const o = ov(panel.id);
          const curSt = (o.state && VX.Model.panelStateById(panel, o.state)) ||
                        VX.Model.panelState(panel) || states[0];
          const cur = curSt.id;
          const i = Math.max(0, states.findIndex((x) => x.id === cur));
          const key = String(a.state == null ? "" : a.state).trim();
          let to = states[0];   // 旧文件里空的 state 依旧表示「第一个状态」
          if (key === "next") to = states[Math.min(i + 1, states.length - 1)];
          else if (key === "prev") to = states[Math.max(i - 1, 0)];
          else if (key === "cycle") to = states[(i + 1) % states.length];
          else if (key) to = states.find((x) => x.id === key || x.name === key) || states[0];

          const effect = (a.effect === "fade" || a.effect === "slide") ? a.effect : "none";
          const dur = Math.max(1, Number(a.duration) || 300);
          // 同面板连续切换：撤掉上一段过渡，避免它的收尾回调删掉新过渡
          if (o.panelFx) {
            for (let k = anims.length - 1; k >= 0; k--) if (anims[k].o === o.panelFx) anims.splice(k, 1);
          }
          o.state = to.id;
          if (effect === "none" || to.id === cur) {
            delete o.panelFx;
          } else {
            const fx = {
              from: cur, to: to.id, effect,
              dir: ["left", "right", "up", "down"].indexOf(a.direction) >= 0 ? a.direction : "left",
              progress: 0,
            };
            o.panelFx = fx;
            animate(fx, "progress", 0, 1, dur, () => { if (o.panelFx === fx) delete o.panelFx; });
          }
          // OnStateChange 事件（可用 {{panelStateName}} 等局部变量）
          const fromSt = states.find((x) => x.id === cur);
          vars.local.panelState = to.id;
          vars.local.panelStateName = to.name || "";
          vars.local.panelStateFrom = cur;
          vars.local.panelStateFromName = fromSt ? (fromSt.name || "") : "";
          dispatch(panel, "statechange");
          return;
        }
        case "setText": {
          if (a.target) ov(a.target).text = interpolate(a.value != null ? String(a.value) : "");
          return;
        }
        case "setVar": {
          const scope = vars[a.scope] ? a.scope : "global";
          vars[scope][a.name] = interpolate(a.value != null ? String(a.value) : "");
          return;
        }
        case "move": {
          if (!a.target) return;
          const o = ov(a.target);
          const fx = o.dx || 0, fy = o.dy || 0;
          const ddx = Number(a.dx) || 0, ddy = Number(a.dy) || 0;
          if (a.animate) {
            animate(o, "dx", fx, fx + ddx, a.animate);
            animate(o, "dy", fy, fy + ddy, a.animate);
          } else {
            o.dx = fx + ddx;
            o.dy = fy + ddy;
          }
          return;
        }
        case "runScript": {
          try {
            // 预览沙箱：仅传入 shape/page/vars
            new Function("shape", "page", "vars", a.code || "")(shape, page(), vars);
          } catch (e) {
            console.warn("runScript 失败:", e);
          }
          return;
        }
        // ---------- 中继器（A2）：数据集增删 / 过滤 / 排序 / 翻页 ----------
        case "repAddRow": {
          const r = repeaterOf(a.target);
          if (!r) return;
          const rep = r.repeater || (r.repeater = { dataset: [], columns: [], template: [] });
          if (!Array.isArray(rep.dataset)) rep.dataset = [];
          let row = {};
          if (a.row) {
            try {
              const parsed = JSON.parse(interpolate(String(a.row)));
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) row = parsed;
            } catch (e) {
              console.warn("repAddRow 的行数据不是合法 JSON：", a.row);
            }
          }
          rep.dataset.push(row);
          relayoutRepeater(r);
          return;
        }
        case "repDelRow": {
          const r = repeaterOf(a.target);
          if (!r || !r.repeater || !Array.isArray(r.repeater.dataset)) return;
          const ds = r.repeater.dataset;
          // index 从 1 开始；留空/0 表示删除最后一行
          const n = Number(a.index) || 0;
          const i = n > 0 ? n - 1 : ds.length - 1;
          if (i >= 0 && i < ds.length) ds.splice(i, 1);
          relayoutRepeater(r);
          return;
        }
        case "repFilter": {
          const r = repeaterOf(a.target);
          if (!r || !r.repeater) return;
          const rep = r.repeater;
          rep.view = rep.view || {};
          rep.view.page = 0;
          // 列名留空 = 清除过滤
          rep.view.filter = a.column
            ? { column: String(a.column), op: a.op || "contains",
                value: interpolate(a.value != null ? String(a.value) : "") }
            : null;
          return;
        }
        case "repSort": {
          const r = repeaterOf(a.target);
          if (!r || !r.repeater) return;
          const rep = r.repeater;
          rep.view = rep.view || {};
          rep.view.page = 0;
          // 列名留空 = 清除排序
          rep.view.sort = a.column ? { column: String(a.column), dir: a.dir === "desc" ? "desc" : "asc" } : null;
          return;
        }
        case "repPage": {
          const r = repeaterOf(a.target);
          if (!r || !r.repeater || !VX.Repeater) return;
          const rep = r.repeater;
          rep.view = rep.view || {};
          const last = Math.max(0, VX.Repeater.visibleRows(rep).pageCount - 1);
          const cur = Math.min(Math.max(0, Number(rep.view.page) || 0), last);
          const p = String(a.page == null || a.page === "" ? "next" : a.page).trim().toLowerCase();
          let next = cur;
          if (p === "next") next = Math.min(last, cur + 1);
          else if (p === "prev") next = Math.max(0, cur - 1);
          else if (p === "first" || p === "reset") next = 0;
          else if (p === "last") next = last;
          else next = Math.min(last, Math.max(0, (Number(p) || 1) - 1)); // 数字按 1 基页码
          rep.view.page = next;
          return;
        }
        default:
          return;
      }
    }

    // 局部变量在「一次顶层事件」内共享（含它派发的 OnStateChange），由 dispatch 统一开合
    function runActions(list, shape) {
      for (const a of list || []) runAction(a, shape);
    }

    // P5：元素级脚本（meta.scripts）在同一事件触发时执行，沙箱同 runScript
    function runScripts(shape, event) {
      const list = (shape.meta && shape.meta.scripts) || [];
      for (const sc of list) {
        if (!sc || !sc.code) continue;
        if ((sc.event || "click") !== event) continue;
        try {
          new Function("shape", "page", "vars", sc.code)(shape, page(), vars);
        } catch (e) {
          console.warn("元素脚本失败:", e);
        }
      }
    }

    function runPageLoad() {
      const p = page();
      if (!p) return;
      // 只派发当前可见状态：非激活状态里的形状不该收到页面载入事件
      walk(p.shapes, (s) => dispatch(s, "pageload"), activeStateOf);
    }

    function goPage(id) {
      const p = byId(id);
      if (!p) return false;
      pageId = id;
      vars.page = {};
      applyDefaults(p.variables, vars.page);
      overrides.clear();
      anims.length = 0;
      runPageLoad();
      return true;
    }

    function dispatch(shape, event) {
      if (!shape || eventDepth > 6) return;   // OnStateChange 里再切状态的递归保护
      const top = eventDepth === 0;
      if (top) vars.local = {};
      eventDepth++;
      try {
        const list = (shape.interactions || []).filter((i) => (i.event || "click") === event);
        for (const it of list) runActions(it.actions, shape);
        runScripts(shape, event);
      } finally {
        eventDepth--;
        if (top) vars.local = {};
      }
    }

    function init() {
      vars.global = {};
      applyDefaults(doc.doc && doc.doc.variables, vars.global);
      const p = page();
      vars.page = {};
      if (p) applyDefaults(p.variables, vars.page);
      runPageLoad();
    }

    return {
      doc, vars, overrides, page, pageId: () => pageId, goPage, dispatch, over,
      displayText, interpolate, tick, init,
      walk: (arr, fn) => walk(arr, fn, activeStateOf),
      findShape: (id) => findShape((page() || {}).shapes, id),
    };
  }

  VX.Interact = { create, walk };
})();
