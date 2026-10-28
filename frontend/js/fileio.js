// fileio.js —— 文件菜单 / VSDX 读写 / 脏标记 / 最近文件（P3）
// 与后端 Bridge 约定：file.open_dialog、file.save_dialog、vsdx.save、vsdx.load、app.recent_files、app.set_title
"use strict";

(function () {
  const bridge = window.__tauricpp__;
  let docPath = null;      // 当前文件绝对路径（null = 尚未保存）
  let lastSaved = null;    // 上次保存/打开时的文档 JSON 快照
  let modified = false;

  const APP_NAME = "Visioxure";

  function status(msg) {
    const el = document.getElementById("status-msg");
    if (el) el.textContent = msg;
  }

  function baseName(path) {
    if (!path) return "未命名.vsdx";
    const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return i >= 0 ? path.slice(i + 1) : path;
  }

  function displayName() {
    return baseName(docPath);
  }

  // ---------- 脏标记 / 标题 ----------
  function isModified() {
    return lastSaved !== null && VX.Model.serialize() !== lastSaved;
  }

  function refreshTitle() {
    const dirty = isModified();
    if (dirty !== modified) modified = dirty;
    const name = displayName() + (modified ? " *" : "");
    const el = document.getElementById("doc-title");
    if (el) el.textContent = name;
    if (bridge) bridge.invoke("app.set_title", { title: `${name} — ${APP_NAME}` });
  }

  function markSaved() {
    lastSaved = VX.Model.serialize();
    modified = false;
    refreshTitle();
  }

  // ---------- 新建 ----------
  function emptyDoc() {
    return {
      format: "visioxure",
      version: 1,
      doc: { theme: "light", variables: [] },
      pages: [{
        id: "p1",
        name: "页面-1",
        size: { mode: "fixed", w: 800, h: 1100, orientation: "portrait" },
        guides: [],
        variables: [],
        layers: [{ id: "l1", name: "默认", visible: true, locked: false }],
        shapes: [],
      }],
    };
  }

  function confirmDiscard() {
    if (!isModified()) return true;
    return window.confirm("当前文档有未保存的修改，继续操作将丢失这些修改。是否继续？");
  }

  function fitCurrentPage() {
    const pg = VX.Model.page();
    if (pg && pg.size) VX.Viewport.fit(pg.size.w, pg.size.h);
  }

  function docNew() {
    if (!confirmDiscard()) return;
    VX.Model.load(JSON.stringify(emptyDoc()));
    VX.History.reset();
    docPath = null;
    markSaved();
    fitCurrentPage();
    status("已新建文档");
  }

  // ---------- 打开 ----------
  async function docOpen() {
    if (!bridge) return;
    if (!confirmDiscard()) return;
    const r = await bridge.invoke("file.open_dialog", {});
    if (!r || !r.success) return;
    await openPath(r.path);
  }

  async function openPath(path) {
    if (!bridge || !path) return;
    status("正在打开 " + baseName(path) + " …");
    try {
      const r = await bridge.invoke("vsdx.load", { path });
      if (!r || !r.success) {
        status("打开失败：" + (r && r.error ? r.error : "未知错误"));
        return;
      }
      VX.Model.load(JSON.stringify(r.doc));
      VX.History.reset();
      docPath = path;
      markSaved();
      fitCurrentPage();
      const warns = (r.warnings || []).length;
      status(warns ? `已打开 ${baseName(path)}（${warns} 条兼容性提示）` : `已打开 ${baseName(path)}`);
      if (warns) console.warn("VSDX 兼容性提示：", r.warnings);
    } catch (e) {
      status("打开失败：" + e.message);
      console.error(e);
    }
  }

  // ---------- 保存 ----------
  async function docSave(saveAs) {
    if (!bridge) return;
    let path = docPath;
    if (saveAs || !path) {
      const r = await bridge.invoke("file.save_dialog", { default_name: displayName() });
      if (!r || !r.success || !r.path) return;
      path = r.path;
    }
    status("正在保存 " + baseName(path) + " …");
    try {
      const doc = JSON.parse(VX.Model.serialize());
      const r = await bridge.invoke("vsdx.save", { path, doc });
      if (!r || !r.success) {
        status("保存失败：" + (r && r.error ? r.error : "未知错误"));
        return;
      }
      docPath = path;
      lastSaved = JSON.stringify(doc);
      modified = false;
      refreshTitle();
      status(`已保存 ${baseName(path)}（${Math.round((r.size || 0) / 1024 * 10) / 10} KB）`);
    } catch (e) {
      status("保存失败：" + e.message);
      console.error(e);
    }
  }

  // ---------- 最近文件 ----------
  async function refreshRecent() {
    const box = document.getElementById("file-recent");
    if (!box) return;
    box.innerHTML = "";
    if (!bridge) return;
    let files = [];
    try {
      const r = await bridge.invoke("app.recent_files", { action: "get" });
      files = (r && r.files) || [];
    } catch (e) {
      files = [];
    }
    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "menu-label";
      empty.textContent = "（无）";
      box.appendChild(empty);
      return;
    }
    for (const p of files) {
      const row = document.createElement("div");
      row.className = "menu-entry";
      row.dataset.path = p;
      row.title = p;
      row.textContent = baseName(p);
      box.appendChild(row);
    }
  }

  // ---------- 菜单 ----------
  function initMenu() {
    const item = document.querySelector('[data-menu="file"]');
    const drop = document.getElementById("menu-file");
    if (!item || !drop) return;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".menu-entry")) return;
      refreshRecent();
      drop.classList.toggle("hidden");
    });
    drop.addEventListener("click", (e) => {
      const entry = e.target.closest(".menu-entry");
      if (!entry) return;
      drop.classList.add("hidden");
      const act = entry.dataset.act;
      if (act === "new") docNew();
      else if (act === "open") docOpen();
      else if (act === "save") docSave(false);
      else if (act === "save-as") docSave(true);
      else if (entry.dataset.path) {
        if (confirmDiscard()) openPath(entry.dataset.path);
      }
    });
    document.addEventListener("mousedown", (e) => {
      if (!item.contains(e.target)) drop.classList.add("hidden");
    });
  }

  // ---------- 快捷键 ----------
  function initShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s" && e.shiftKey) { e.preventDefault(); docSave(true); }
      else if (k === "s") { e.preventDefault(); docSave(false); }
      else if (k === "o") { e.preventDefault(); docOpen(); }
      else if (k === "n") { e.preventDefault(); docNew(); }
    });
  }

  const FileIO = {
    init() {
      initMenu();
      initShortcuts();
      // 编辑动作（History 提交/撤销/重做）与模型变更都会刷新脏标记
      if (VX.Events) VX.Events.on("history", refreshTitle);
      if (VX.Model && VX.Model.on) VX.Model.on("change", refreshTitle);
      lastSaved = VX.Model.serialize();
      modified = false;
      refreshTitle();
    },
    save: docSave,
    open: docOpen,
    new: docNew,
    isModified,
    path: () => docPath,
  };

  VX.FileIO = FileIO;
})();
