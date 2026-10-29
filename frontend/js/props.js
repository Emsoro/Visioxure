// props.js —— 右侧「属性」面板（S2）：位置/尺寸/旋转/圆角/不透明度 + 文本样式
// 几何字段直接读写 shape.x/y/w/h/angle，样式落 shape.style；全部改动走 History 事务，可撤销。
// 多选时按字段求公共值，不一致显示「多个值」并留空，避免把混合状态误写成同一个值。
"use strict";

(function () {
  const S = () => VX.state;
  const DEG = 180 / Math.PI;
  const TYPE_NAMES = {
    rect: "矩形", ellipse: "圆形", path: "路径", text: "文本",
    connector: "连接线", image: "图片", panel: "动态面板",
  };
  // 常用字体：Visio 导出的文件多用前两项，缺字体时渲染器会回退到 Arial/雅黑
  const FONTS = [
    "Segoe UI", "Microsoft YaHei", "Arial", "Helvetica", "Tahoma", "Calibri",
    "宋体", "黑体", "楷体", "等线",
  ];

  let root = null;
  let key = "";     // 当前 DOM 对应的选择签名（id + 类型），变化时重建控件
  let rows = [];    // 需要就地同步数值的控件

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 数值显示：去掉多余小数（拖拽出来的 119.99999 显示成 120）
  function fmt(v, digits) {
    if (typeof v !== "number" || !isFinite(v)) return "";
    const p = Math.pow(10, digits == null ? 1 : digits);
    return String(Math.round(v * p) / p);
  }

  // 可编辑目标：展开组合、展开动态面板的当前状态（与画布所见一致）。
  // 组本身不带几何编辑语义（改 x 不会带动子形状），所以只暴露叶子形状。
  function targets() {
    const out = [];
    const seen = new Set();
    const walk = (s) => {
      if (!s || seen.has(s.id)) return;
      seen.add(s.id);
      if (s.type === "group") {
        for (const ch of s.children || []) walk(ch);
        return;
      }
      if (s.type === "panel") {
        const st = VX.Model.panelState(s);
        for (const ch of (st && st.shapes) || []) walk(ch);
        return;
      }
      out.push(s);
    };
    for (const id of S().selection) walk(VX.Model.shape(id));
    return out;
  }

  function selectionKey() {
    return S().selection.join(",") + "|" + targets().map((s) => s.type).join(",");
  }

  function commonVal(list, get) {
    if (!list.length) return { mixed: false, value: undefined };
    const v0 = get(list[0]);
    for (let i = 1; i < list.length; i++) {
      if (get(list[i]) !== v0) return { mixed: true, value: null };
    }
    return { mixed: false, value: v0 };
  }

  // 统一提交口：一次修改 = 一条撤销记录；提交后刷新其它面板与画布
  function commit(label, fn) {
    if (!targets().length) return;
    VX.History.run(label, () => {
      fn();
      S().dirty = true;
    });
    VX.Model.emit("change");
    VX.Renderer.invalidate();
  }

  function styleOf(s) { return s.style || (s.style = {}); }
  function fontOf(s) {
    const st = styleOf(s);
    return st.font || (st.font = {});
  }

  // ---------- 文本样式写入 ----------
  function setFont(label, patch) {
    const list = targets();
    commit(label, () => {
      for (const s of list) Object.assign(fontOf(s), patch);
    });
  }

  // ---------- 通用行 ----------
  // 数值行：回车或失焦生效；步进按钮也能触发 change
  function numberRow(o) {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", o.label));

    const wrap = el("span", "sp-num-wrap");
    const input = document.createElement("input");
    input.type = "number";
    input.className = "sp-num";
    input.min = String(o.min != null ? o.min : -100000);
    input.max = String(o.max != null ? o.max : 100000);
    input.step = String(o.step != null ? o.step : 1);
    if (o.title) input.title = o.title;
    // 面板输入框里的 Delete/方向键不能穿透到画布（否则会删形状/微移），
    // 但 Ctrl/⌘ 组合键要放行，否则在输入框里按 Ctrl+Z 无法撤销
    input.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
    });
    input.addEventListener("change", () => {
      let v = parseFloat(input.value);
      if (!isFinite(v)) { syncSelf(); return; }
      v = clamp(v, o.min != null ? o.min : -100000, o.max != null ? o.max : 100000);
      if (o.digits === 0) v = Math.round(v);
      const list = targets();
      commit(o.action || ("修改" + o.label), () => {
        for (const s of list) o.set(s, v);
      });
    });

    wrap.appendChild(input);
    if (o.unit) wrap.appendChild(el("span", "sp-unit", o.unit));
    row.appendChild(wrap);

    function syncSelf() {
      const list = targets();
      if (document.activeElement === input) return;
      const cv = commonVal(list, o.get);
      input.value = cv.mixed ? "" : fmt(cv.value, o.digits);
      input.placeholder = cv.mixed ? "多个值" : "";
    }
    rows.push({ sync: syncSelf });
    return row;
  }

  // 分段按钮行（对齐/加粗等枚举值）
  function segRow(labelText, opts, get, set) {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", labelText));

    const seg = el("div", "sp-seg");
    const btns = [];
    for (const o of opts) {
      const b = el("button", "sp-seg-btn", o.t);
      b.type = "button";
      b.addEventListener("click", () => {
        const list = targets();
        const cv = commonVal(list, get);
        if (!cv.mixed && cv.value === o.v) return;
        commit("修改" + labelText, () => {
          for (const s of list) set(s, o.v);
        });
      });
      btns.push({ btn: b, v: o.v });
      seg.appendChild(b);
    }
    row.appendChild(seg);

    function syncSelf() {
      const cv = commonVal(targets(), get);
      for (const b of btns) b.btn.classList.toggle("active", !cv.mixed && cv.value === b.v);
    }
    rows.push({ sync: syncSelf });
    return row;
  }

  // 文本颜色：复用 Office 调色板
  function fontColorRow() {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", "字色"));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sp-color";
    const chip = el("span", "sp-chip");
    const text = el("span", "sp-color-text");
    btn.appendChild(chip);
    btn.appendChild(text);

    btn.addEventListener("click", () => {
      const cv = commonVal(targets(), (s) => fontOf(s).color);
      VX.ColorPicker.open(btn, {
        title: "文本颜色",
        value: cv.mixed ? "" : cv.value,
        onPick: (c) => setFont("修改文本颜色", { color: c }),
      });
    });

    row.appendChild(btn);

    function syncSelf() {
      const cv = commonVal(targets(), (s) => fontOf(s).color);
      chip.classList.toggle("mixed", cv.mixed);
      chip.style.background = cv.mixed ? "" : (cv.value || "#333333");
      text.textContent = cv.mixed ? "多个值" : String(cv.value || "#333333").toUpperCase();
    }
    rows.push({ sync: syncSelf });
    return row;
  }

  // 字体族：下拉里补一项当前文件的非常用字体，避免打开 Visio 文件后值被“吃掉”
  function fontFamilyRow() {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", "字体"));

    const sel = document.createElement("select");
    sel.className = "sp-select";
    const cv = commonVal(targets(), (s) => fontOf(s).family);
    const list = FONTS.slice();
    if (!cv.mixed && cv.value && list.indexOf(cv.value) < 0) list.unshift(cv.value);
    for (const f of list) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      sel.appendChild(opt);
    }
    if (cv.mixed) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "多个值";
      sel.appendChild(opt);
    }
    sel.value = cv.mixed ? "" : (cv.value || "Segoe UI");
    sel.addEventListener("keydown", (e) => {
      // 同数值输入框：方向键留在下拉里选字体，Ctrl+Z/Y 继续走文档撤销
      if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
    });
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      setFont("修改字体", { family: sel.value });
    });

    row.appendChild(sel);

    function syncSelf() {
      if (document.activeElement === sel) return;
      const c = commonVal(targets(), (s) => fontOf(s).family);
      if (c.mixed) { sel.value = ""; return; }
      const v = c.value || "Segoe UI";
      if (!Array.from(sel.options).some((o) => o.value === v)) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.insertBefore(opt, sel.firstChild);
      }
      sel.value = v;
    }
    rows.push({ sync: syncSelf });
    return row;
  }

  // ---------- 面板构建 ----------
  function buildGeometry(list) {
    const geo = list.filter((s) => s.type !== "connector");
    if (!geo.length) return;

    const wrap = document.createDocumentFragment();
    wrap.appendChild(el("div", "prop-section", "位置与大小"));
    wrap.appendChild(numberRow({
      label: "X", unit: "px", digits: 1, action: "修改位置",
      get: (s) => s.x, set: (s, v) => { s.x = v; },
      title: "形状左上角 X（世界坐标 px）",
    }));
    wrap.appendChild(numberRow({
      label: "Y", unit: "px", digits: 1, action: "修改位置",
      get: (s) => s.y, set: (s, v) => { s.y = v; },
      title: "形状左上角 Y（世界坐标 px）",
    }));
    // 纯路径形状也可改宽高：几何按 path.design 缩放，图形会跟着包围盒一起变
    wrap.appendChild(numberRow({
      label: "宽", unit: "px", digits: 1, min: 4, action: "修改尺寸",
      get: (s) => s.w, set: (s, v) => { s.w = Math.max(4, v); },
    }));
    wrap.appendChild(numberRow({
      label: "高", unit: "px", digits: 1, min: 4, action: "修改尺寸",
      get: (s) => s.h, set: (s, v) => { s.h = Math.max(4, v); },
    }));
    wrap.appendChild(numberRow({
      label: "旋转", unit: "°", digits: 1, step: 15, min: -3600, max: 3600, action: "修改旋转",
      get: (s) => (s.angle || 0) * DEG,
      set: (s, v) => { s.angle = v / DEG; },
      title: "顺时针角度；拖旋转柄时按住 Shift 按 15° 吸附",
    }));
    if (geo.every((s) => s.type === "rect" || s.type === "path")) {
      wrap.appendChild(numberRow({
        label: "圆角", unit: "px", digits: 0, min: 0, max: 400, action: "修改圆角",
        get: (s) => (s.style && s.style.cornerRadius) || 0,
        set: (s, v) => { styleOf(s).cornerRadius = v; },
      }));
    }
    wrap.appendChild(numberRow({
      label: "不透明度", unit: "%", digits: 0, min: 0, max: 100, action: "修改不透明度",
      get: (s) => {
        const v = s.style && s.style.opacity;
        return v == null ? 100 : v * 100;
      },
      set: (s, v) => { styleOf(s).opacity = v / 100; },
    }));
    root.appendChild(wrap);
  }

  function buildText(list) {
    root.appendChild(el("div", "prop-section", "文本"));
    if (!list.some((s) => s.text)) {
      root.appendChild(el("div", "panel-hint", "所选形状暂未输入文字；双击形状可直接编辑。"));
    }
    root.appendChild(fontFamilyRow());
    root.appendChild(numberRow({
      label: "字号", unit: "px", digits: 0, min: 4, max: 400, action: "修改字号",
      get: (s) => fontOf(s).size || 14,
      set: (s, v) => { fontOf(s).size = v; },
    }));
    root.appendChild(segRow("加粗",
      [{ v: true, t: "加粗" }, { v: false, t: "常规" }],
      (s) => !!fontOf(s).bold,
      (s, v) => { fontOf(s).bold = v; }));
    root.appendChild(fontColorRow());
    root.appendChild(segRow("水平",
      [{ v: "left", t: "左" }, { v: "center", t: "中" }, { v: "right", t: "右" }],
      (s) => fontOf(s).align || "left",
      (s, v) => { fontOf(s).align = v; }));
    root.appendChild(segRow("垂直",
      [{ v: "top", t: "上" }, { v: "middle", t: "中" }, { v: "bottom", t: "下" }],
      (s) => fontOf(s).vAlign || "top",
      (s, v) => { fontOf(s).vAlign = v; }));
  }

  function render() {
    if (!root) return;
    const list = targets();
    key = selectionKey();
    rows = [];
    root.innerHTML = "";

    if (!list.length) {
      root.appendChild(el("div", "prop-empty", "未选中对象"));
      root.appendChild(el("div", "panel-hint", "选中形状后可精确输入位置、尺寸与文本样式。"));
      return;
    }

    const head = el("div", "sp-head");
    head.textContent = list.length === 1
      ? (TYPE_NAMES[list[0].type] || list[0].type)
      : list.length + " 个对象";
    root.appendChild(head);

    if (list.every((s) => s.type === "connector")) {
      root.appendChild(el("div", "panel-hint", "连接线的位置由两端粘附点决定；线型与箭头在「样式」面板。"));
    } else {
      buildGeometry(list);
    }
    buildText(list);
    root.appendChild(el("div", "panel-hint", "数值回车或失焦生效 · 所有修改可 Ctrl+Z 撤销"));

    sync();
  }

  // 画布拖动/撤销等外部改动：只刷新数值，不重建 DOM（否则会打断正在输入的光标）
  function sync() {
    if (!root) return;
    if (selectionKey() !== key) { render(); return; }
    for (const r of rows) r.sync();
  }

  const Props = {
    init(host) {
      root = host || document.getElementById("props-panel");
      if (!root) return;
      VX.Model.on("selection", render);
      VX.Model.on("pagechange", render);
      VX.Model.on("paneledit", render);
      VX.Model.on("change", sync);
      VX.Events.on("history", sync);
      render();
    },
    render,
    sync,
  };

  VX.Props = Props;
})();
