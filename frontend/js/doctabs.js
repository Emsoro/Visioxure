// doctabs.js —— 画布上方的文档页签：页面 + 动态面板状态编辑（Axure 式）
// 进入某个动态面板的状态编辑时自动开一个页签，标题是面板名 + 状态名；
// 点页签切换编辑上下文，点 × 关闭，点页面页签回到页面。VX.state.panelEdit 仍是唯一事实源。
"use strict";

(function () {
  let host = null;
  let tabs = [];            // [{ panelId, stateId }] 已打开的状态编辑页签
  let activePanelId = null; // null = 页面页签

  const S = () => VX.state;
  function status(msg) {
    const el = document.getElementById("status-msg");
    if (el) el.textContent = msg;
  }
  function stateName(panel, stateId) {
    const st = VX.Model.panelStateById(panel, stateId) || VX.Model.panelState(panel);
    return st ? st.name : "—";
  }

  function openTab(panelId, stateId) {
    const t = tabs.find((x) => x.panelId === panelId);
    if (t) t.stateId = stateId;
    else tabs.push({ panelId, stateId });
    activePanelId = panelId;
  }

  // 从 VX.state.panelEdit 同步页签（双击面板 / 交互面板按钮 / Esc / 撤销都走这里）
  function sync() {
    const pe = S().panelEdit;
    // 面板被删掉或换了页：对应页签失效
    tabs = tabs.filter((t) => {
      const p = VX.Model.shape(t.panelId);
      return !!p && p.type === "panel";
    });
    const panel = pe ? VX.Model.shape(pe.panelId) : null;
    if (pe && panel && panel.type === "panel") {
      openTab(panel.id, pe.stateId);
    } else {
      activePanelId = null;
      if (pe) S().panelEdit = null;
    }
    render();
  }

  function setContext(panelId, stateId) {
    const panel = panelId ? VX.Model.shape(panelId) : null;
    if (panelId && (!panel || panel.type !== "panel")) { sync(); return; }
    S().panelEdit = panel ? { panelId, stateId: stateId || (VX.Model.panelState(panel) || {}).id } : null;
    S().enterGroup = null;
    S().selection = [];
    if (panel) openTab(panelId, S().panelEdit.stateId);
    else activePanelId = null;
    VX.Events.emit("paneledit");
    VX.Events.emit("selection");
    VX.Renderer.invalidate();
    status(panel
      ? `正在编辑「${VX.Model.panelName(panel)} · ${stateName(panel, S().panelEdit.stateId)}」，Esc 返回页面`
      : "已返回页面编辑");
    render();
  }

  function closeTab(panelId) {
    tabs = tabs.filter((x) => x.panelId !== panelId);
    if (activePanelId === panelId) setContext(null);
    else render();
  }

  function render() {
    if (!host) return;
    host.innerHTML = "";
    const pg = VX.Model.page();
    const pageTab = document.createElement("div");
    pageTab.className = "doc-tab doc-tab-page" + (activePanelId === null ? " active" : "");
    pageTab.dataset.panelId = "";
    pageTab.textContent = pg ? pg.name : "页面";
    pageTab.title = "返回页面编辑";
    host.appendChild(pageTab);

    for (const t of tabs) {
      const panel = VX.Model.shape(t.panelId);
      if (!panel || panel.type !== "panel") continue;
      const name = VX.Model.panelName(panel);
      const st = stateName(panel, t.stateId);
      const tab = document.createElement("div");
      tab.className = "doc-tab" + (activePanelId === t.panelId ? " active" : "");
      tab.dataset.panelId = t.panelId;
      tab.title = name + " · " + st + "（状态编辑）";

      const label = document.createElement("span");
      label.className = "doc-tab-label";
      label.textContent = name;
      const sub = document.createElement("span");
      sub.className = "doc-tab-state";
      sub.textContent = st;
      const close = document.createElement("span");
      close.className = "doc-tab-close";
      close.dataset.close = t.panelId;
      close.textContent = "×";
      close.title = "关闭状态编辑页签";
      tab.append(label, sub, close);
      host.appendChild(tab);
    }
  }

  const DocTabs = {
    init(el) {
      host = el || document.getElementById("doc-tabs");
      if (!host) return;
      host.addEventListener("click", (e) => {
        const close = e.target.closest(".doc-tab-close");
        if (close) { closeTab(close.dataset.close); return; }
        const tab = e.target.closest(".doc-tab");
        if (!tab) return;
        const id = tab.dataset.panelId;
        if (!id) { setContext(null); return; }
        const t = tabs.find((x) => x.panelId === id);
        setContext(id, t ? t.stateId : null);
      });
      // 换页 / 载入新文档：状态编辑上下文整体失效
      VX.Model.on("pagechange", () => { tabs = []; activePanelId = null; render(); });
      VX.Events.on("paneledit", sync);
      VX.Model.on("change", sync);
      VX.Events.on("history", sync);
      render();
    },
    render,
    tabs: () => tabs.slice(),
  };

  VX.DocTabs = DocTabs;
})();
