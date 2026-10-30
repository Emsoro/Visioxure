// app.js —— 入口：模块引导（P1 起画布逻辑迁至 model/canvas/tools/editor）
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

// ---------- Bridge ----------
const bridge = window.__tauricpp__;

// ---------- 版本号：桌面端以后端 app.get_info 为准（源头是 CMakeLists 的 project(VERSION)），
// 浏览器直开没有后端时沿用它，静态兜底值在 index.html 里
async function initVersion() {
  const el = $("#app-version");
  if (!el || !bridge) return;
  try {
    const r = await bridge.invoke("app.get_info", {});
    if (r && r.version) el.textContent = "v" + r.version;
  } catch (e) {
    console.error("app.get_info failed:", e);
  }
}

// ---------- 菜单栏：一级菜单的开/关/悬停切换（各菜单项的动作仍由 fileio/exporter 自己处理） ----------
// 「文件」「导出」等多个一级菜单共用一套行为：点标题开/关并互斥、展开时悬停到别的菜单直接切换、
// 点菜单外任意处全部收起。菜单展开时派发 vx:menuopen，供「最近文件」等按需刷新
function initMenus() {
  const items = $$(".menus .menu-item[data-menu]");
  const drops = items.map((it) => it.querySelector(".menu-drop")).filter(Boolean);
  const isOpen = (d) => d && !d.classList.contains("hidden");
  const closeAll = (except) => drops.forEach((d) => { if (d !== except) d.classList.add("hidden"); });
  const open = (item, drop) => {
    closeAll(drop);
    if (isOpen(drop)) return;
    drop.classList.remove("hidden");
    document.dispatchEvent(new CustomEvent("vx:menuopen", { detail: item.dataset.menu }));
  };
  items.forEach((item) => {
    const drop = item.querySelector(".menu-drop");
    if (!drop) return;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".menu-entry")) return;   // 交给具体菜单的动作处理器
      if (isOpen(drop)) drop.classList.add("hidden");
      else open(item, drop);
    });
    // 已有菜单展开时，悬停到别的一级菜单即切换（桌面软件菜单惯例）
    item.addEventListener("mouseenter", () => { if (drops.some(isOpen)) open(item, drop); });
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".menus")) closeAll(null); });
}

// ---------- 左右面板 Tab ----------
function initPanelTabs() {
  $$("[data-tabs]").forEach((tabs) => {
    const root = tabs.parentElement;
    tabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".panel-tab");
      if (!tab) return;
      $$(".panel-tab", root).forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const name = tab.dataset.tab;
      $$(":scope > .panel-body", root).forEach((b) => {
        b.classList.toggle("hidden", b.dataset.tabPage !== name);
      });
    });
  });
}

// ---------- 工具按钮点击（状态同步在 editor.js syncToolButtons） ----------
function initTools() {
  $("#tools").addEventListener("click", (e) => {
    const btn = e.target.closest(".tool-btn");
    if (!btn || !btn.dataset.tool) return;
    VX.Tools.set(btn.dataset.tool);
  });
}

// ---------- 品牌链接：交给后端用系统浏览器打开（在 WebView 内跳转会顶掉编辑器） ----------
function initBrandLinks() {
  const box = $("#brand-links");
  if (!box) return;
  box.addEventListener("click", async (e) => {
    const link = e.target.closest(".git-link");
    const url = link && link.dataset.url;
    if (!url) return;
    if (bridge) {
      try {
        const r = await bridge.invoke("app.open_url", { url });
        if (r && r.success) return;
      } catch (err) {
        console.error("app.open_url failed:", err);
      }
    }
    // 浏览器直开（无 Bridge）时的退化路径
    window.open(url, "_blank", "noopener");
  });
}

// ---------- 全局错误上报 ----------
window.addEventListener("error", (e) => {
  if (bridge) bridge.invoke("log_error", { message: `${e.message} @ ${e.filename}:${e.lineno}` });
});

// ---------- 启动 ----------
document.addEventListener("DOMContentLoaded", () => {
  VX.Model.init();
  VX.Editor.init();
  if (VX.StylePanel) VX.StylePanel.init();
  if (VX.Props) VX.Props.init();
  if (VX.Inspect) VX.Inspect.init();
  if (VX.Meta) VX.Meta.init();
  if (VX.PagePanel) VX.PagePanel.init();
  VX.FileIO.init();
  if (VX.Exporter) VX.Exporter.init();   // 「导出」一级菜单里的导出项
  initMenus();                           // 一级菜单（文件 / 导出）的开合与互斥
  initPanelTabs();
  initTools();
  initBrandLinks();
  initVersion();
});
