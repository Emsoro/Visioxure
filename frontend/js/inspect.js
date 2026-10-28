// inspect.js —— 右侧「交互」面板：交互（事件→动作）/ 动态面板状态 / 变量（P4）
"use strict";

(function () {
  let host = null;

  const EVENTS = [
    ["click", "点击"], ["dblclick", "双击"], ["mouseenter", "鼠标移入"],
    ["mouseleave", "鼠标移出"], ["pageload", "页面载入"], ["keydown", "按键"],
  ];
  const ACTION_TYPES = [
    ["openLink", "打开链接/跳页"], ["show", "显示"], ["hide", "隐藏"],
    ["setState", "切换面板状态"], ["setText", "设置文本"],
    ["move", "移动"], ["setVar", "设置变量"], ["runScript", "运行脚本"],
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function select(options, value, onChange) {
    const s = el("select", "ip-sel");
    for (const [v, label] of options) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      s.appendChild(o);
    }
    if (value != null) s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }

  function input(value, onChange, placeholder, type) {
    const i = el("input", "ip-input");
    i.type = type || "text";
    if (placeholder) i.placeholder = placeholder;
    i.value = value == null ? "" : value;
    i.addEventListener("change", () => onChange(i.value));
    return i;
  }

  function button(label, onClick, title) {
    const b = el("button", "ip-btn", label);
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function number(value, onChange, step) {
    const i = input(value, (v) => onChange(Number(v) || 0), "", "number");
    i.step = step || "1";
    return i;
  }

  // 页面内所有形状（含组合/面板状态），用于目标下拉
  function allShapes() {
    const out = [];
    const walk = (arr) => {
      for (const s of arr || []) {
        out.push(s);
        if (s.type === "group") walk(s.children);
        if (s.type === "panel") for (const st of (s.panel && s.panel.states) || []) walk(st.shapes);
      }
    };
    walk(VX.Model.page() ? VX.Model.page().shapes : []);
    return out;
  }

  function shapeLabel(s) {
    const t = (s.text || "").replace(/\s+/g, " ").trim();
    return `${s.id}${t ? " · " + t.slice(0, 10) : " · " + s.type}`;
  }

  function shapeOptions(includeEmpty) {
    const opts = includeEmpty ? [["", "（无）"]] : [];
    for (const s of allShapes()) {
      if (s.type === "connector") continue;
      opts.push([s.id, shapeLabel(s)]);
    }
    return opts;
  }

  function pageOptions(includeEmpty) {
    const opts = includeEmpty ? [["", "（无）"]] : [];
    for (const p of VX.Model.doc.pages) opts.push([p.id, p.name]);
    return opts;
  }

  function markDirty() {
    VX.state.dirty = true;
    VX.Renderer.invalidate();
  }

  // ---------- 动作编辑 ----------
  function actionFields(shape, a, rerender) {
    const box = el("div", "ip-col");
    const row = () => el("div", "ip-row");

    if (a.type === "openLink") {
      const r1 = row();
      r1.appendChild(el("span", "ip-muted", "页面"));
      r1.appendChild(select(pageOptions(true), a.target || "", (v) => { a.target = v; }));
      box.appendChild(r1);
      const r2 = row();
      r2.appendChild(el("span", "ip-muted", "URL"));
      r2.appendChild(input(a.url || "", (v) => { a.url = v; }, "https://…"));
      box.appendChild(r2);
    } else if (a.type === "show" || a.type === "hide") {
      const r1 = row();
      r1.appendChild(el("span", "ip-muted", "目标"));
      r1.appendChild(select(shapeOptions(true), a.target || "", (v) => { a.target = v; }));
      r1.appendChild(select([["none", "无动效"], ["fade", "淡入淡出"]], a.effect || "none", (v) => { a.effect = v; }));
      box.appendChild(r1);
    } else if (a.type === "setState") {
      const panels = allShapes().filter((s) => s.type === "panel");
      const panelOpts = [["", "（选择面板）"]].concat(panels.map((p) => [p.id, shapeLabel(p)]));
      const r1 = row();
      r1.appendChild(el("span", "ip-muted", "面板"));
      r1.appendChild(select(panelOpts, a.target || "", (v) => { a.target = v; a.state = ""; rerender(); }));
      box.appendChild(r1);
      const panel = panels.find((p) => p.id === a.target);
      const states = (panel && panel.panel && panel.panel.states) || [];
      const r2 = row();
      r2.appendChild(el("span", "ip-muted", "状态"));
      if (states.length) {
        r2.appendChild(select(states.map((st) => [st.id, st.name]), a.state || states[0].id, (v) => { a.state = v; }));
      } else {
        r2.appendChild(el("span", "ip-muted", "该面板没有状态"));
      }
      box.appendChild(r2);
    } else if (a.type === "setText") {
      const r1 = row();
      r1.appendChild(el("span", "ip-muted", "目标"));
      r1.appendChild(select(shapeOptions(true), a.target || "", (v) => { a.target = v; }));
      box.appendChild(r1);
      const r2 = row();
      r2.appendChild(el("span", "ip-muted", "文本"));
      r2.appendChild(input(a.value || "", (v) => { a.value = v; }, "支持 {{变量}}"));
      box.appendChild(r2);
    } else if (a.type === "move") {
      const r1 = row();
      r1.appendChild(el("span", "ip-muted", "目标"));
      r1.appendChild(select(shapeOptions(true), a.target || "", (v) => { a.target = v; }));
      box.appendChild(r1);
      const r2 = row();
      r2.appendChild(el("span", "ip-muted", "dx"));
      r2.appendChild(number(a.dx || 0, (v) => { a.dx = v; }));
      r2.appendChild(el("span", "ip-muted", "dy"));
      r2.appendChild(number(a.dy || 0, (v) => { a.dy = v; }));
      r2.appendChild(el("span", "ip-muted", "时长"));
      r2.appendChild(number(a.animate || 0, (v) => { a.animate = v; }, "50"));
      box.appendChild(r2);
    } else if (a.type === "setVar") {
      const r1 = row();
      r1.appendChild(select([["global", "全局"], ["page", "页面"], ["local", "局部"]], a.scope || "global", (v) => { a.scope = v; }));
      r1.appendChild(input(a.name || "", (v) => { a.name = v; }, "变量名"));
      box.appendChild(r1);
      const r2 = row();
      r2.appendChild(el("span", "ip-muted", "值"));
      r2.appendChild(input(a.value || "", (v) => { a.value = v; }, "支持 {{变量}}"));
      box.appendChild(r2);
      // 已有变量名提示
      const known = [];
      for (const v of (VX.Model.doc.doc.variables || [])) known.push("全局:" + v.name);
      for (const v of ((VX.Model.page() || {}).variables || [])) known.push("页面:" + v.name);
      if (known.length) box.appendChild(el("div", "ip-muted", "已有变量：" + known.join("，")));
    } else if (a.type === "runScript") {
      const ta = el("textarea", "ip-input");
      Object.assign(ta.style, { width: "100%", minHeight: "54px", fontFamily: "Consolas, monospace" });
      ta.value = a.code || "";
      ta.addEventListener("change", () => { a.code = ta.value; });
      box.appendChild(ta);
      box.appendChild(el("div", "ip-muted", "脚本内可用 shape / page / vars（预览与导出时执行）"));
    }
    return box;
  }

  function renderInteractions(shape) {
    const sec = el("div", "ip-card");
    const list = shape.interactions || (shape.interactions = []);
    if (!list.length) sec.appendChild(el("div", "ip-muted", "暂无交互，点击下方按钮添加事件。"));

    list.forEach((it, ei) => {
      const card = el("div", "ip-card");
      const head = el("div", "ip-row");
      head.appendChild(select(EVENTS, it.event || "click", (v) => { it.event = v; }));
      head.appendChild(button("删除事件", () => {
        VX.History.run("删除交互", () => { list.splice(ei, 1); });
        render();
      }));
      card.appendChild(head);

      it.actions = it.actions || [];
      it.actions.forEach((a, ai) => {
        const rowHead = el("div", "ip-row");
        rowHead.appendChild(select(ACTION_TYPES, a.type || "openLink", (v) => {
          // 换类型时保留 target，清掉其余字段
          const keep = a.target;
          for (const k of Object.keys(a)) if (k !== "type" && k !== "target") delete a[k];
          a.type = v;
          if (keep != null) a.target = keep;
          render();
        }));
        rowHead.appendChild(button("删除", () => {
          VX.History.run("删除动作", () => { it.actions.splice(ai, 1); });
          render();
        }));
        card.appendChild(rowHead);
        card.appendChild(actionFields(shape, a, render));
      });

      card.appendChild(button("+ 动作", () => {
        it.actions.push({ type: "openLink", target: "" });
        render();
      }, "为此事件添加动作"));
      sec.appendChild(card);
    });

    sec.appendChild(button("+ 事件", () => {
      list.push({ event: "click", actions: [{ type: "openLink", target: "" }] });
      render();
    }));
    return sec;
  }

  // ---------- 面板状态 ----------
  function renderPanelStates(shape) {
    const sec = el("div", "ip-card");
    const states = VX.Model.panelStates(shape);
    const active = VX.Model.panelState(shape);
    const editing = VX.state.panelEdit && VX.state.panelEdit.panelId === shape.id;

    states.forEach((st) => {
      const row = el("div", "ip-row");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "panel-state-" + shape.id;
      radio.checked = active && st.id === active.id;
      radio.addEventListener("change", () => {
        VX.Model.setPanelState(shape, st.id);
        if (VX.state.panelEdit) VX.state.panelEdit.stateId = st.id;
        markDirty();
        render();
      });
      row.appendChild(radio);
      row.appendChild(input(st.name, (v) => { st.name = v; markDirty(); }, "状态名"));
      row.appendChild(el("span", "ip-muted", `${(st.shapes || []).length} 个形状`));
      if (states.length > 1) {
        row.appendChild(button("删除", () => {
          VX.History.run("删除面板状态", () => VX.Model.removePanelState(shape, st.id));
          markDirty();
          render();
        }));
      }
      sec.appendChild(row);
    });
    sec.appendChild(button("+ 添加状态", () => {
      VX.History.run("添加面板状态", () => VX.Model.addPanelState(shape));
      markDirty();
      render();
    }));
    sec.appendChild(button(editing ? "退出状态编辑" : "进入状态编辑", () => {
      if (editing) {
        VX.state.panelEdit = null;
      } else {
        const st = VX.Model.panelState(shape);
        VX.state.panelEdit = { panelId: shape.id, stateId: st ? st.id : null };
        VX.state.selection = [];
      }
      VX.Events.emit("paneledit");
      VX.Events.emit("selection");
      markDirty();
      render();
    }, "进入后画布上新建的形状会归入当前状态"));
    return sec;
  }

  // ---------- 变量 ----------
  function renderVars(rows, list, label, rerender) {
    const sec = el("div", "ip-card");
    if (!list.length) sec.appendChild(el("div", "ip-muted", "（无）"));
    list.forEach((v, i) => {
      const row = el("div", "ip-row");
      row.appendChild(input(v.name, (x) => { v.name = x.trim(); rerender(); }, "名称"));
      row.appendChild(input(v.default, (x) => { v.default = x; }, "默认值"));
      row.appendChild(button("×", () => {
        VX.History.run("删除变量", () => { list.splice(i, 1); });
        rerender();
      }, "删除"));
      sec.appendChild(row);
    });
    sec.appendChild(button("+ 添加" + label, () => {
      VX.History.run("添加变量", () => list.push({ name: "", default: "" }));
      rerender();
    }));
    return sec;
  }

  // ---------- 汇总渲染 ----------
  function render() {
    if (!host) return;
    host.innerHTML = "";
    const sel = VX.state.selection;
    const shape = sel.length === 1 ? VX.Model.shape(sel[0]) : null;
    const page = VX.Model.page();

    // 变量（始终显示）
    host.appendChild(el("div", "ip-sec", "全局变量"));
    host.appendChild(renderVars(null, VX.Model.doc.doc.variables || (VX.Model.doc.doc.variables = []), "全局变量", render));

    host.appendChild(el("div", "ip-sec", "页面变量 · " + (page ? page.name : "")));
    host.appendChild(renderVars(null, (page && (page.variables || (page.variables = []))) || [], "页面变量", render));

    // 面板状态
    if (shape && shape.type === "panel") {
      host.appendChild(el("div", "ip-sec", "动态面板状态 · " + shape.id));
      host.appendChild(renderPanelStates(shape));
    }

    // 交互
    host.appendChild(el("div", "ip-sec", "交互 · " + (shape ? shape.id : "未选中对象")));
    if (!shape) {
      host.appendChild(el("div", "ip-muted", "选中一个形状后可编辑「事件 → 动作」。"));
    } else {
      host.appendChild(renderInteractions(shape));
    }
  }

  const Inspect = {
    init(el0) {
      host = el0 || document.getElementById("interact-panel");
      if (!host) return;
      VX.Model.on("selection", render);
      VX.Model.on("pagechange", render);
      VX.Model.on("change", () => { /* 结构变化时刷新目标列表 */ render(); });
      VX.Events.on("paneledit", render);
      render();
    },
    render,
  };

  VX.Inspect = Inspect;
})();
