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
    repeater: "中继器", instance: "组件实例",
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

  // 可编辑目标：展开组合（组本身不带几何编辑语义），动态面板保留容器自身
  // ——面板有自己的几何/裁剪属性区，展开成子形状会让「改 X」误改到内容上
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

  // 表格是「组合」型构件：选中它时属性面板改为表格自身的行列数，
  // 而不是展开后的单元格几何（展开会变成「N 个对象」且改宽高不会带动网格）
  function tableTarget() {
    if (S().selection.length !== 1) return null;
    const s = VX.Model.shape(S().selection[0]);
    return (VX.Table && VX.Table.isTable(s)) ? s : null;
  }

  // 动态面板是容器：选中它时显示面板自身的位置/尺寸/裁剪，而不是当前状态的叶子形状
  function panelTarget() {
    if (S().selection.length !== 1) return null;
    const s = VX.Model.shape(S().selection[0]);
    return s && s.type === "panel" ? s : null;
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
      const list = o.list ? o.list() : targets();
      commit(o.action || ("修改" + o.label), () => {
        for (const s of list) o.set(s, v);
      });
      // 强制回写：有些字段会被模型侧夹紧（如表格的最小高度），输入框得显示实际生效值
      syncSelf(true);
    });

    wrap.appendChild(input);
    if (o.unit) wrap.appendChild(el("span", "sp-unit", o.unit));
    row.appendChild(wrap);

    function syncSelf(force) {
      const list = o.list ? o.list() : targets();
      if (!force && document.activeElement === input) return;
      const cv = commonVal(list, o.get);
      input.value = cv.mixed ? "" : fmt(cv.value, o.digits);
      input.placeholder = cv.mixed ? "多个值" : "";
    }
    rows.push({ sync: syncSelf });
    return row;
  }

  // 分段按钮行（对齐/加粗等枚举值）；listFn 可指定作用对象（表格传自己的组）
  function segRow(labelText, opts, get, set, listFn) {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", labelText));

    const seg = el("div", "sp-seg");
    const btns = [];
    for (const o of opts) {
      const b = el("button", "sp-seg-btn", o.t);
      b.type = "button";
      b.addEventListener("click", () => {
        const list = listFn ? listFn() : targets();
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
      const cv = commonVal(listFn ? listFn() : targets(), get);
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
    // 组合/组件实例的子形状是世界坐标：改位置要连带平移子形状，否则内容会留在原地
    const moveTo = (s, v, axis) => {
      if (s.type === "group" || s.type === "instance" || s.type === "panel") {
        VX.Model.moveShapeBy(s, axis === "x" ? v - s.x : 0, axis === "y" ? v - s.y : 0);
      } else s[axis] = v;
    };
    wrap.appendChild(numberRow({
      label: "X", unit: "px", digits: 1, action: "修改位置",
      get: (s) => s.x, set: (s, v) => moveTo(s, v, "x"),
      title: "形状左上角 X（世界坐标 px）",
    }));
    wrap.appendChild(numberRow({
      label: "Y", unit: "px", digits: 1, action: "修改位置",
      get: (s) => s.y, set: (s, v) => moveTo(s, v, "y"),
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

  // ---------- 图片属性（S3） ----------
  // fit 决定图片在框内的摆放方式：contain 等比内嵌 / cover 等比裁剪 / fill=拉伸
  function buildImage(list) {
    const only = () => targets().filter((s) => s.type === "image");
    if (!list.some((s) => s.type === "image")) return;

    root.appendChild(el("div", "prop-section", "图片"));
    root.appendChild(segRow("适应",
      [{ v: "contain", t: "适应" }, { v: "cover", t: "裁剪" }, { v: "fill", t: "拉伸" }],
      (s) => s.fit || "contain",
      (s, v) => { s.fit = v; }, only));
    root.appendChild(el("div", "panel-hint", "适应：等比缩放并留白 · 裁剪：铺满后裁掉超出 · 拉伸：不保持宽高比"));
  }

  // ---------- 中继器属性（A2） ----------
  // 数据用 CSV 编辑：首行列名，其余每行一条记录；模板文字里的 {{列名}} 会逐行替换
  function buildRepeater(s) {
    const R = VX.Repeater;
    if (!R) return;
    const rep = s.repeater || (s.repeater = { dataset: [], columns: [], layout: {}, template: [] });
    const one = () => [s];

    root.appendChild(el("div", "prop-section", "中继器"));

    const ta = document.createElement("textarea");
    ta.className = "sp-textarea";
    Object.assign(ta.style, { width: "100%", minHeight: "96px", boxSizing: "border-box",
      fontFamily: "Consolas, monospace", fontSize: "12px" });
    ta.value = R.toCsv(rep);
    ta.title = "首行是列名，其后每行一条数据；支持逗号分隔与双引号转义";
    ta.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
    });
    ta.addEventListener("change", () => {
      commit("修改中继器数据", () => {
        if (R.setCsv(rep, ta.value)) R.relayout(s);
      });
    });
    root.appendChild(el("div", "sp-label", "数据（CSV）"));
    root.appendChild(ta);

    root.appendChild(segRow("布局",
      [{ v: "vertical", t: "竖向" }, { v: "grid", t: "网格" }],
      (x) => ((x.repeater.layout || {}).mode || "vertical"),
      (x, v) => { (x.repeater.layout = x.repeater.layout || {}).mode = v; R.relayout(x); }, one));
    root.appendChild(numberRow({
      label: "列数", digits: 0, min: 1, max: 20, action: "修改中继器列数", list: one,
      get: (x) => (x.repeater.layout || {}).cols || 1,
      set: (x, v) => { (x.repeater.layout = x.repeater.layout || {}).cols = Math.max(1, Math.round(v)); },
      title: "仅网格布局生效",
    }));
    root.appendChild(numberRow({
      label: "行高", unit: "px", digits: 0, min: 8, max: 2000, action: "修改中继器行高", list: one,
      get: (x) => (x.repeater.layout || {}).rowHeight || 0,
      set: (x, v) => { (x.repeater.layout = x.repeater.layout || {}).rowHeight = Math.max(8, v); R.relayout(x); },
      title: "竖向布局时每条数据占用的高度",
    }));
    root.appendChild(numberRow({
      label: "间距", unit: "px", digits: 0, min: 0, max: 200, action: "修改中继器间距", list: one,
      get: (x) => (x.repeater.layout || {}).gap || 0,
      set: (x, v) => { (x.repeater.layout = x.repeater.layout || {}).gap = Math.max(0, v); },
      title: "网格布局的横/纵间距（可用 gapX/gapY 单独设置）",
    }));
    root.appendChild(numberRow({
      label: "每页", unit: "行", digits: 0, min: 0, max: 500, action: "修改中继器分页", list: one,
      get: (x) => (x.repeater.pageSize || 0),
      set: (x, v) => { x.repeater.pageSize = Math.max(0, Math.round(v)); },
      title: "0 = 不分页；大于 0 时按页显示",
    }));

    const n = (rep.dataset || []).length;
    const items = R.items(s);
    root.appendChild(el("div", "panel-hint",
      "模板文字可用 {{列名}} 插值；当前 " + n + " 条数据" +
      (items.pageCount > 1 ? "，分 " + items.pageCount + " 页" : "") +
      "。交互动作可加行/删行/过滤/排序/翻页。"));
  }

  // ---------- 组件实例属性（A3） ----------
  function buildInstance(s) {
    root.appendChild(el("div", "prop-section", "组件"));
    const m = VX.Library ? VX.Library.master(s.masterId) : null;
    root.appendChild(el("div", "panel-hint",
      m ? "母版：" + m.name + "（" + Math.round(m.w) + " × " + Math.round(m.h) + "）"
        : "母版已丢失（可能来自旧文件）；实例内容仍可编辑。"));
    const btn = el("button", "btn-full", "解除链接");
    btn.type = "button";
    btn.title = "把实例拆成独立形状，之后改它不会再与母版有任何关联";
    btn.addEventListener("click", () => {
      if (VX.Library) VX.Library.unlink(s.id);
      render();
    });
    root.appendChild(btn);
    root.appendChild(el("div", "panel-hint", "双击实例进入内部编辑：改文本/样式只作用于这个实例。"));
  }

  // ---------- 表格属性（P7） ----------
  // 行列数写在 group.table 上，改变时由 VX.Table 重建单元格（按行列坐标保留已填文字）
  function buildTable(g) {
    const T = VX.Table;
    const one = () => [g];

    const geo = document.createDocumentFragment();
    geo.appendChild(el("div", "prop-section", "位置与大小"));
    // 组的子形状是世界坐标：改位置/尺寸必须交给 VX.Table.resize 重建，否则网格会留在原地
    geo.appendChild(numberRow({
      label: "X", unit: "px", digits: 1, action: "修改位置", list: one,
      get: (s) => s.x, set: (s, v) => T.resize(s, { x: v }),
      title: "表格左上角 X（世界坐标 px）",
    }));
    geo.appendChild(numberRow({
      label: "Y", unit: "px", digits: 1, action: "修改位置", list: one,
      get: (s) => s.y, set: (s, v) => T.resize(s, { y: v }),
    }));
    geo.appendChild(numberRow({
      label: "宽", unit: "px", digits: 1, min: T.minSize(g).w, action: "修改尺寸", list: one,
      get: (s) => s.w, set: (s, v) => T.resize(s, { w: v }),
      title: "改宽度时列宽等分重算（最小 = 列数 × " + T.MIN_COL_W + "px）",
    }));
    geo.appendChild(numberRow({
      label: "高", unit: "px", digits: 1, min: T.minSize(g).h, action: "修改尺寸", list: one,
      get: (s) => s.h, set: (s, v) => T.resize(s, { h: v }),
      title: "改高度时行高等分重算（最小 = 行数 × " + T.MIN_ROW_H + "px）",
    }));
    root.appendChild(geo);

    root.appendChild(el("div", "prop-section", "表格"));
    root.appendChild(numberRow({
      label: "行数", digits: 0, min: T.MIN, max: T.MAX, action: "修改行数", list: one,
      get: (s) => s.table.rows, set: (s, v) => T.setGrid(s, v, s.table.cols),
      title: "含表头行；加行时表格向下扩展，行高不变",
    }));
    root.appendChild(numberRow({
      label: "列数", digits: 0, min: T.MIN, max: T.MAX, action: "修改列数", list: one,
      get: (s) => s.table.cols, set: (s, v) => T.setGrid(s, s.table.rows, v),
      title: "加列时表格向右扩展，列宽不变",
    }));
    root.appendChild(segRow("首行",
      [{ v: true, t: "表头" }, { v: false, t: "数据" }],
      (s) => !!s.table.header,
      (s, v) => T.setHeader(s, v), one));
  }

  // ---------- 动态面板属性 ----------
  // 面板是「视口」：移动带动全部状态的内容，宽高只改视口范围（不缩放内容）
  function buildPanel(s) {
    VX.Model.normalizePanel(s);
    const one = () => [s];

    root.appendChild(el("div", "prop-section", "动态面板"));
    const nameRow = el("div", "sp-row");
    nameRow.appendChild(el("span", "sp-label", "名称"));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "sp-text";
    nameInput.value = VX.Model.panelName(s);
    nameInput.title = "状态编辑页签上显示的名称";
    nameInput.addEventListener("keydown", (e) => { if (!(e.ctrlKey || e.metaKey)) e.stopPropagation(); });
    nameInput.addEventListener("change", () => {
      const v = nameInput.value.trim();
      commit("重命名动态面板", () => { s.name = v || VX.Model.panelName(s); });
    });
    nameRow.appendChild(nameInput);
    root.appendChild(nameRow);

    const geo = document.createDocumentFragment();
    geo.appendChild(el("div", "prop-section", "位置与大小"));
    geo.appendChild(numberRow({
      label: "X", unit: "px", digits: 1, action: "修改位置", list: one,
      get: (x) => x.x, set: (x, v) => VX.Model.moveShapeBy(x, v - x.x, 0),
      title: "视口左上角 X；移动会带动全部状态内的形状",
    }));
    geo.appendChild(numberRow({
      label: "Y", unit: "px", digits: 1, action: "修改位置", list: one,
      get: (x) => x.y, set: (x, v) => VX.Model.moveShapeBy(x, 0, v - x.y),
      title: "视口左上角 Y；移动会带动全部状态内的形状",
    }));
    geo.appendChild(numberRow({
      label: "宽", unit: "px", digits: 1, min: 4, action: "修改尺寸", list: one,
      get: (x) => x.w, set: (x, v) => { x.w = Math.max(4, v); },
      title: "只改变视口宽度，不缩放状态内容",
    }));
    geo.appendChild(numberRow({
      label: "高", unit: "px", digits: 1, min: 4, action: "修改尺寸", list: one,
      get: (x) => x.h, set: (x, v) => { x.h = Math.max(4, v); },
      title: "只改变视口高度，不缩放状态内容",
    }));
    root.appendChild(geo);

    root.appendChild(el("div", "prop-section", "视口与状态"));
    root.appendChild(segRow("内容裁剪",
      [{ v: true, t: "裁剪" }, { v: false, t: "不裁剪" }],
      (x) => VX.Model.panelClip(x),
      (x, v) => { x.panel.clip = v; }, one));
    const fit = el("button", "btn-full", "适应内容尺寸");
    fit.type = "button";
    fit.title = "把视口调整为全部状态内容的包围盒并集（内容保持不动）";
    fit.addEventListener("click", () => {
      commit("面板适应内容尺寸", () => VX.Model.fitPanelToContent(s));
    });
    root.appendChild(fit);

    const editing = VX.state.panelEdit && VX.state.panelEdit.panelId === s.id;
    const editBtn = el("button", "btn-full", editing ? "退出状态编辑" : "进入状态编辑（打开页签）");
    editBtn.type = "button";
    editBtn.title = "在画布上方打开这个动态面板的状态编辑页签";
    editBtn.addEventListener("click", () => {
      const st = VX.Model.panelState(s);
      VX.state.panelEdit = editing ? null : { panelId: s.id, stateId: st ? st.id : null };
      VX.state.selection = [];
      VX.Events.emit("paneledit");
      VX.Events.emit("selection");
      VX.Renderer.invalidate();
      render();
    });
    root.appendChild(editBtn);

    const states = VX.Model.panelStates(s);
    const cur = VX.Model.panelState(s);
    root.appendChild(el("div", "panel-hint",
      `${states.length} 个状态 · 当前 ${cur ? cur.name : "—"}；状态的新增/复制/排序与切换在「交互」面板。`));
    root.appendChild(el("div", "panel-hint",
      "双击面板或点上方按钮打开状态编辑页签；移动面板会带动全部状态内容，改尺寸只改变视口，不缩放内容。"));
    if (VX.Model.panelClip(s)) {
      root.appendChild(el("div", "panel-hint",
        "已开启裁剪：视口外的内容不会显示、也不会被点中。旧文档里坐标漂移的内容可关掉裁剪，或用「适应内容尺寸」对齐。"));
    }
    root.appendChild(el("div", "panel-hint", "数值回车或失焦生效 · 所有修改可 Ctrl+Z 撤销"));
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
    const tb = tableTarget();
    const pnl = panelTarget();
    head.textContent = tb ? "表格" : pnl ? "动态面板"
      : list.length === 1 ? (TYPE_NAMES[list[0].type] || list[0].type)
      : list.length + " 个对象";
    root.appendChild(head);

    if (tb) {
      buildTable(tb);
      root.appendChild(el("div", "panel-hint", "双击表格进入组合，再双击单元格可改文字 · 行列数改动可 Ctrl+Z 撤销"));
      sync();
      return;
    }
    if (pnl) {
      buildPanel(pnl);
      sync();
      return;
    }

    if (list.every((s) => s.type === "connector")) {
      root.appendChild(el("div", "panel-hint", "连接线的位置由两端粘附点决定；线型与箭头在「样式」面板。"));
    } else {
      buildGeometry(list);
    }
    // 中继器/组件实例有自己的专用面板，不再走通用的图片/文本区块
    if (list.length === 1 && list[0].type === "repeater") {
      buildRepeater(list[0]);
    } else if (list.length === 1 && list[0].type === "instance") {
      buildInstance(list[0]);
    } else {
      buildImage(list);
      buildText(list);
    }
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
