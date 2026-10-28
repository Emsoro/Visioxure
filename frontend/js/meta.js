// meta.js —— 右侧「注释」面板：元素注释 / 链接 / 脚本（P5）
// 数据模型：shape.meta = { notes, links:[{label,url}], scripts:[{name,event,code}] }
"use strict";

(function () {
  let host = null;

  const EVENTS = [
    ["click", "点击"], ["dblclick", "双击"], ["mouseenter", "鼠标移入"],
    ["mouseleave", "鼠标移出"], ["pageload", "页面载入"], ["keydown", "按键"],
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function input(value, onChange, placeholder) {
    const i = el("input", "ip-input");
    if (placeholder) i.placeholder = placeholder;
    i.value = value == null ? "" : value;
    i.addEventListener("change", () => onChange(i.value));
    return i;
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

  function textarea(value, onChange, placeholder) {
    const t = el("textarea", "ip-input");
    Object.assign(t.style, { width: "100%", minHeight: "56px", resize: "vertical", fontFamily: "inherit" });
    if (placeholder) t.placeholder = placeholder;
    t.value = value == null ? "" : value;
    t.addEventListener("change", () => onChange(t.value));
    return t;
  }

  function button(label, onClick, title) {
    const b = el("button", "ip-btn", label);
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function metaOf(shape) {
    if (!shape.meta || typeof shape.meta !== "object") shape.meta = {};
    const m = shape.meta;
    if (typeof m.notes !== "string") m.notes = "";
    if (!Array.isArray(m.links)) m.links = [];
    if (!Array.isArray(m.scripts)) m.scripts = [];
    return m;
  }

  // 全部清空时移除 meta，避免给未配置的元素留下空字段
  function prune(shape) {
    const m = shape.meta;
    if (!m) return;
    const emptyNotes = !m.notes;
    if (emptyNotes && !m.links.length && !m.scripts.length) delete shape.meta;
  }

  function commit(shape, label, fn) {
    VX.History.run(label, () => {
      fn();
      prune(shape);
      VX.state.dirty = true;
      VX.Renderer.invalidate();
    });
  }

  // ---------- 注释 ----------
  function renderNotes(shape, m, rerender) {
    const sec = el("div", "ip-card");
    sec.appendChild(textarea(m.notes, (v) => {
      commit(shape, "修改注释", () => { metaOf(shape).notes = v; });
      rerender();
    }, "给此元素写说明，导出评审时可通过注释面板查看"));
    return sec;
  }

  // ---------- 链接 ----------
  function renderLinks(shape, m, rerender) {
    const sec = el("div", "ip-card");
    if (!m.links.length) sec.appendChild(el("div", "ip-muted", "暂无链接。"));

    m.links.forEach((link, i) => {
      const row = el("div", "ip-row");
      row.appendChild(input(link.label || "", (v) => commit(shape, "修改链接", () => { link.label = v; }), "名称"));
      const url = input(link.url || "", (v) => commit(shape, "修改链接", () => { link.url = v; }), "https://…");
      Object.assign(url.style, { flex: "1 1 120px", minWidth: "0" });
      row.appendChild(url);
      row.appendChild(button("×", () => {
        commit(shape, "删除链接", () => { metaOf(shape).links.splice(i, 1); });
        rerender();
      }, "删除链接"));
      sec.appendChild(row);
    });

    sec.appendChild(button("+ 添加链接", () => {
      commit(shape, "添加链接", () => { metaOf(shape).links.push({ label: "", url: "" }); });
      rerender();
    }));
    return sec;
  }

  // ---------- 脚本 ----------
  function renderScripts(shape, m, rerender) {
    const sec = el("div", "ip-card");
    if (!m.scripts.length) sec.appendChild(el("div", "ip-muted", "暂无脚本。"));

    m.scripts.forEach((sc, i) => {
      const card = el("div", "ip-card");
      const head = el("div", "ip-row");
      head.appendChild(input(sc.name || "", (v) => commit(shape, "修改脚本", () => { sc.name = v; }), "名称"));
      head.appendChild(select(EVENTS, sc.event || "click", (v) => commit(shape, "修改脚本", () => { sc.event = v; })));
      head.appendChild(button("×", () => {
        commit(shape, "删除脚本", () => { metaOf(shape).scripts.splice(i, 1); });
        rerender();
      }, "删除脚本"));
      card.appendChild(head);

      const code = el("textarea", "ip-input");
      Object.assign(code.style, { width: "100%", minHeight: "54px", fontFamily: "Consolas, monospace" });
      code.value = sc.code || "";
      code.addEventListener("change", () => {
        commit(shape, "修改脚本", () => { sc.code = code.value; });
      });
      card.appendChild(code);
      sec.appendChild(card);
    });

    sec.appendChild(button("+ 添加脚本", () => {
      commit(shape, "添加脚本", () => {
        metaOf(shape).scripts.push({ name: "脚本" + (metaOf(shape).scripts.length + 1), event: "click", code: "" });
      });
      rerender();
    }));
    return sec;
  }

  // ---------- 汇总渲染 ----------
  function render() {
    if (!host) return;
    host.innerHTML = "";
    const sel = VX.state.selection;
    if (!sel.length) {
      host.appendChild(el("div", "panel-hint", "选中一个元素后，可配置它的注释 / 链接 / 脚本。"));
      return;
    }
    if (sel.length > 1) {
      host.appendChild(el("div", "panel-hint", "已选中 " + sel.length + " 个元素，请单选后编辑元数据。"));
      return;
    }

    const shape = VX.Model.shape(sel[0]);
    if (!shape) return;
    const m = metaOf(shape);

    host.appendChild(el("div", "ip-sec", "注释 · " + shape.id));
    host.appendChild(renderNotes(shape, m, render));

    host.appendChild(el("div", "ip-sec", "链接"));
    host.appendChild(renderLinks(shape, m, render));

    host.appendChild(el("div", "ip-sec", "脚本"));
    host.appendChild(renderScripts(shape, m, render));
    host.appendChild(el("div", "ip-muted", "脚本在预览 / 导出页面中，于所选事件触发时执行（可用 shape / page / vars，变量写入 vars.global / vars.page）。"));
  }

  const Meta = {
    init(el0) {
      host = el0 || document.getElementById("notes-panel");
      if (!host) return;
      VX.Model.on("selection", render);
      VX.Model.on("pagechange", render);
      render();
    },
    render,
  };

  VX.Meta = Meta;
})();
