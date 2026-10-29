// style.js —— 右侧「样式」属性页
// 填充色 / 边框色 / 线宽；支持多选批量修改，全部改动走 History 事务（可撤销）
"use strict";

(function () {
  const S = () => VX.state;
  const TYPE_NAMES = {
    rect: "矩形", ellipse: "圆形", path: "路径", text: "文本",
    connector: "连接线", image: "图片", panel: "动态面板",
  };

  let root = null;

  // 展开组合/动态面板，收集可样式化的形状（组本身不带 style）
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
      if (s.type === "panel") {
        for (const st of (s.panel && s.panel.states) || []) {
          for (const ch of st.shapes || []) walk(ch);
        }
      }
    };
    for (const id of S().selection) walk(VX.Model.shape(id));
    return out;
  }

  function commonVal(list, get) {
    if (!list.length) return { mixed: false, value: undefined };
    const v0 = get(list[0]);
    for (let i = 1; i < list.length; i++) {
      if (get(list[i]) !== v0) return { mixed: true, value: null };
    }
    return { mixed: false, value: v0 };
  }

  function isNone(v) { return !v || v === "transparent"; }

  function applyStyle(list, patch, label) {
    if (!list.length) return;
    VX.History.run(label, () => {
      for (const s of list) s.style = Object.assign({}, s.style || {}, patch);
      S().dirty = true;
    });
    VX.Model.emit("change");
    VX.Renderer.invalidate();
  }

  function sectionTitle(text) {
    const d = document.createElement("div");
    d.className = "prop-section";
    d.textContent = text;
    return d;
  }

  // 颜色行：色块 + 十六进制文本，点击弹出 Office 调色板
  function colorRow(labelText, list, key, opts) {
    const row = document.createElement("div");
    row.className = "sp-row";

    const label = document.createElement("span");
    label.className = "sp-label";
    label.textContent = labelText;

    const cv = commonVal(list, (s) => (s.style ? s.style[key] : undefined));
    const color = cv.mixed ? null : cv.value;
    const none = !cv.mixed && isNone(color);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sp-color";
    const chip = document.createElement("span");
    chip.className = "sp-chip" + (cv.mixed ? " mixed" : none ? " none" : "");
    if (!cv.mixed && !none) chip.style.background = color;
    const text = document.createElement("span");
    text.className = "sp-color-text";
    text.textContent = cv.mixed ? "多个值" : none ? (opts.clearLabel || "无") : String(color).toUpperCase();
    btn.appendChild(chip);
    btn.appendChild(text);

    btn.addEventListener("click", () => {
      VX.ColorPicker.open(btn, {
        title: labelText,
        value: cv.mixed || none ? "" : color,
        clearLabel: opts.clearLabel,
        onPick: (c) => applyStyle(list, { [key]: c }, opts.label),
        onClear: opts.clearLabel ? () => applyStyle(list, { [key]: "transparent" }, opts.label) : null,
      });
    });

    row.appendChild(label);
    row.appendChild(btn);
    return row;
  }

  // 线宽行：数值输入（px）
  function widthRow(list) {
    const row = document.createElement("div");
    row.className = "sp-row";

    const label = document.createElement("span");
    label.className = "sp-label";
    label.textContent = "线宽";

    const wrap = document.createElement("span");
    wrap.className = "sp-num-wrap";

    const cv = commonVal(list, (s) => {
      const v = s.style ? s.style.lineWidth : undefined;
      return typeof v === "number" ? v : parseFloat(v) || 0;
    });
    const input = document.createElement("input");
    input.type = "number";
    input.className = "sp-num";
    input.min = "0";
    input.max = "20";
    input.step = "0.5";
    input.value = cv.mixed ? "" : String(cv.value != null ? cv.value : "");
    input.placeholder = cv.mixed ? "多个值" : "";
    input.title = "边框粗细（px），0 表示无线条";

    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      let n = parseFloat(input.value);
      if (!isFinite(n)) { render(); return; }
      n = Math.max(0, Math.min(20, n));
      applyStyle(list, { lineWidth: n }, "修改线宽");
    });

    const unit = document.createElement("span");
    unit.className = "sp-unit";
    unit.textContent = "px";

    wrap.appendChild(input);
    wrap.appendChild(unit);
    row.appendChild(label);
    row.appendChild(wrap);
    return row;
  }

  // ---------- 连接线：线型（直线/折线/曲线） + 两端箭头形状 ----------
  const ROUTE_OPTS = [
    { v: "straight", t: "直线" },
    { v: "ortho", t: "折线" },
    { v: "curve", t: "曲线" },
  ];
  const ARROW_OPTS = [
    { v: "none", t: "无" },
    { v: "arrow", t: "实心箭头" },
    { v: "open", t: "开口箭头" },
    { v: "triangle", t: "空心三角" },
    { v: "dot", t: "圆点" },
    { v: "diamond", t: "空心菱形" },
    { v: "square", t: "实心方块" },
    { v: "bar", t: "斜线" },
  ];

  // 内部箭头形状名 → Visio 箭头类型号（保存时写回 BeginArrow/EndArrow）
  const ARROW_TYPES = { none: 0, open: 1, arrow: 4, triangle: 14, dot: 10, diamond: 22, square: 11, bar: 9 };
  // Visio 箭头尺寸级别 0~6（2 为默认）
  const ARROW_SIZE_OPTS = [
    { v: 0, t: "最小" },
    { v: 1, t: "很小" },
    { v: 2, t: "中" },
    { v: 3, t: "大" },
    { v: 4, t: "很大" },
    { v: 5, t: "特大" },
    { v: 6, t: "最大" },
  ];

  // 旧文件的 arrowBegin/arrowEnd 是布尔值，新值为 kind 字符
  function arrowMode(s, which) {
    const st = s.style || {};
    const kind = which === "begin" ? st.arrowBeginKind : st.arrowEndKind;
    if (typeof kind === "string" && kind) return kind;
    const flag = which === "begin" ? !!st.arrowBegin : st.arrowEnd !== false;
    return flag ? "arrow" : "none";
  }

  function arrowSizeOf(s, which) {
    const st = s.style || {};
    const v = which === "begin" ? st.arrowBeginSize : st.arrowEndSize;
    return typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(6, Math.round(v))) : 2;
  }

  // 线型：分段按钮（手拖过的折线按“折线”显示）
  function routeRow(list) {
    const row = document.createElement("div");
    row.className = "sp-row";
    const label = document.createElement("span");
    label.className = "sp-label";
    label.textContent = "线型";

    const seg = document.createElement("div");
    seg.className = "sp-seg";
    const cv = commonVal(list, (s) => (s.route === "manual" || !s.route ? "ortho" : s.route));
    for (const o of ROUTE_OPTS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sp-seg-btn" + (!cv.mixed && cv.value === o.v ? " active" : "");
      b.textContent = o.t;
      b.addEventListener("click", () => {
        if (!cv.mixed && cv.value === o.v) return;
        VX.History.run("修改线型", () => {
          for (const s of list) {
            s.route = o.v;
            delete s.points; // 放弃手拖折点，避免切回手动布线时用到旧点
          }
          S().dirty = true;
        });
        VX.Model.emit("change");
        VX.Renderer.invalidate();
      });
      seg.appendChild(b);
    }

    row.appendChild(label);
    row.appendChild(seg);
    return row;
  }

  // 箭头行：下拉选择形状
  function arrowRow(labelText, list, which) {
    const row = document.createElement("div");
    row.className = "sp-row";
    const label = document.createElement("span");
    label.className = "sp-label";
    label.textContent = labelText;

    const sel = document.createElement("select");
    sel.className = "sp-select";
    for (const o of ARROW_OPTS) {
      const opt = document.createElement("option");
      opt.value = o.v;
      opt.textContent = o.t;
      sel.appendChild(opt);
    }
    const cv = commonVal(list, (s) => arrowMode(s, which));
    if (cv.mixed) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "多个值";
      sel.appendChild(opt);
      sel.value = "";
    } else {
      sel.value = cv.value;
    }

    sel.addEventListener("change", () => {
      const kind = sel.value;
      if (!kind) return;
      VX.History.run("修改箭头", () => {
        for (const s of list) {
          const st = Object.assign({}, s.style || {});
          if (which === "begin") {
            st.arrowBeginKind = kind;
            st.arrowBegin = kind !== "none";
            st.arrowBeginType = ARROW_TYPES[kind] || 0;
          } else {
            st.arrowEndKind = kind;
            st.arrowEnd = kind !== "none";
            st.arrowEndType = ARROW_TYPES[kind] || 0;
          }
          s.style = st;
        }
        S().dirty = true;
      });
      VX.Model.emit("change");
      VX.Renderer.invalidate();
    });

    row.appendChild(label);
    row.appendChild(sel);

    const sizeSel = document.createElement("select");
    sizeSel.className = "sp-select sp-select-size";
    for (const o of ARROW_SIZE_OPTS) {
      const opt = document.createElement("option");
      opt.value = String(o.v);
      opt.textContent = o.t;
      sizeSel.appendChild(opt);
    }
    const cs = commonVal(list, (s) => arrowSizeOf(s, which));
    if (cs.mixed) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "多个值";
      sizeSel.appendChild(opt);
      sizeSel.value = "";
    } else {
      sizeSel.value = String(cs.value);
    }
    sizeSel.addEventListener("change", () => {
      if (sizeSel.value === "") return;
      const size = Number(sizeSel.value);
      VX.History.run("修改箭头大小", () => {
        for (const s of list) {
          const st = Object.assign({}, s.style || {});
          if (which === "begin") st.arrowBeginSize = size; else st.arrowEndSize = size;
          s.style = st;
        }
        S().dirty = true;
      });
      VX.Model.emit("change");
      VX.Renderer.invalidate();
    });
    row.appendChild(sizeSel);
    return row;
  }

  function render() {
    if (!root) return;
    const list = targets();
    root.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "prop-empty";
      empty.textContent = "未选中对象";
      root.appendChild(empty);
      const hint = document.createElement("div");
      hint.className = "panel-hint";
      hint.textContent = "选中形状后可调整填充与边框";
      root.appendChild(hint);
      return;
    }

    const head = document.createElement("div");
    head.className = "sp-head";
    head.textContent = list.length === 1
      ? (TYPE_NAMES[list[0].type] || list[0].type)
      : list.length + " 个对象";
    root.appendChild(head);

    // 填充（连接线没有填充）
    const conns = list.filter((s) => s.type === "connector");
    const fills = list.filter((s) => s.type !== "connector");
    if (fills.length) {
      root.appendChild(sectionTitle("填充"));
      root.appendChild(colorRow("填充颜色", fills, "fill", {
        label: "修改填充颜色",
        clearLabel: "无填充",
      }));
    }

    // 边框 / 线条
    const onlyConn = conns.length && !fills.length;
    root.appendChild(sectionTitle(onlyConn ? "线条" : "边框"));
    root.appendChild(colorRow(onlyConn ? "线条颜色" : "边框颜色", list, "line", {
      label: "修改边框颜色",
      clearLabel: "无线条",
    }));
    root.appendChild(widthRow(list));

    // 连接线专用：线型 + 两端箭头
    if (conns.length) {
      root.appendChild(sectionTitle("连接线"));
      root.appendChild(routeRow(conns));
      root.appendChild(arrowRow("起点箭头", conns, "begin"));
      root.appendChild(arrowRow("终点箭头", conns, "end"));
    }
  }

  const StylePanel = {
    init(el) {
      root = el || document.getElementById("style-panel");
      if (!root) return;
      VX.Model.on("selection", render);
      VX.Model.on("pagechange", render);
      VX.Model.on("change", render);
      render();
    },
    render,
  };

  VX.StylePanel = StylePanel;
})();
