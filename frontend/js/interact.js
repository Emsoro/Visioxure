// interact.js —— Axure 式交互运行时（P4）
// 预览（F5）与后续 HTML 导出共用：事件 → 动作、三级变量作用域、动态面板状态、动效
"use strict";

(function () {
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 递归查找形状（含组合、面板各状态）
  function findShape(arr, id) {
    for (const s of arr || []) {
      if (s.id === id) return s;
      if (s.type === "group") {
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

  // 遍历页面形状树（含面板全部状态）
  function walk(arr, fn) {
    for (const s of arr || []) {
      fn(s);
      if (s.type === "group") walk(s.children, fn);
      if (s.type === "panel") for (const st of (s.panel && s.panel.states) || []) walk(st.shapes, fn);
    }
  }

  function create(srcDoc) {
    const doc = clone(srcDoc);
    const vars = { global: {}, page: {}, local: {} };
    const overrides = new Map();   // shapeId → { visible,text,state,dx,dy,opacity }
    const anims = [];
    let pageId = doc.pages && doc.pages[0] ? doc.pages[0].id : null;

    const byId = (id) => (doc.pages || []).find((p) => p.id === id) || null;
    const page = () => byId(pageId);
    const ov = (id) => {
      let o = overrides.get(id);
      if (!o) { o = {}; overrides.set(id, o); }
      return o;
    };

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
      };
    }

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
          if (a.target) ov(a.target).state = a.state;
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
        default:
          return;
      }
    }

    function runActions(list, shape) {
      vars.local = {};
      for (const a of list || []) runAction(a, shape);
      vars.local = {};
    }

    function runPageLoad() {
      const p = page();
      if (!p) return;
      walk(p.shapes, (s) => {
        const list = (s.interactions || []).filter((i) => i.event === "pageload");
        for (const it of list) runActions(it.actions, s);
      });
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
      if (!shape) return;
      const list = (shape.interactions || []).filter((i) => (i.event || "click") === event);
      for (const it of list) runActions(it.actions, shape);
    }

    function init() {
      vars.global = {};
      applyDefaults(doc.doc && doc.doc.variables, vars.global);
      const p = page();
      vars.page = {};
      if (p) applyDefaults(p.variables, vars.page);
      runPageLoad();
    }

    return { doc, vars, overrides, page, pageId: () => pageId, goPage, dispatch, over, displayText, interpolate, tick, init, findShape: (id) => findShape((page() || {}).shapes, id) };
  }

  VX.Interact = { create, walk };
})();
