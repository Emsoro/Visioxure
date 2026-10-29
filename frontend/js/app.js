// app.js —— 入口：模块引导 + Bridge 初始化（P1 起画布逻辑迁至 model/canvas/tools/editor）
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

// ---------- Bridge ----------
const bridge = window.__tauricpp__;

async function initBridge() {
  const el = $("#bridge-status");
  if (!bridge) {
    el.textContent = "Bridge: 不可用";
    el.className = "status-right err";
    return;
  }

  // C++ → JS 方向：监听后端 Emit
  bridge.listen("bridge.greet", (data) => {
    el.textContent = `Bridge: 双向 OK (v${data.version})`;
    el.className = "status-right ok";
    $("#status-msg").textContent = "Bridge 双向通信已建立";
  });

  // JS → C++ 方向：invoke
  try {
    const res = await bridge.invoke("bridge.test", {});
    if (res.message !== "pong") throw new Error("unexpected response");
    setTimeout(() => {
      if (!el.className.includes("ok")) {
        el.textContent = `Bridge: 单向 OK (v${res.version})`;
        el.className = "status-right err";
      }
    }, 300);
  } catch (e) {
    el.textContent = "Bridge: 失败";
    el.className = "status-right err";
    console.error("bridge.test failed:", e);
  }
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
  initPanelTabs();
  initTools();
  initBrandLinks();
  initBridge();
});
