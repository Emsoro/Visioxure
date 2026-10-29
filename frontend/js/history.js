// history.js —— undo/redo（P1）
// 快照式：事务提交时保存全文档 JSON，上限 200 步（P1 验收要求）
"use strict";

(function () {
  const MAX = 200;
  let undoStack = [];   // [{label, json, view}]
  let redoStack = [];
  let pending = null;   // 拖拽类事务：开始时的快照
  let pendingView = null; // 开始时的视图上下文（当前页 + 选中）

  // 每个快照同时记录视图上下文：撤销后回到“操作前”的页面与选中，
  // 而不是把选中留在被撤销掉的对象上（否则撤销删除后对象回来了却没选中，
  // 属性面板也空着）
  function view() {
    return { pageId: VX.Model.currentPageId(), sel: VX.state.selection.slice() };
  }

  function push(label, json, v) {
    undoStack.push({ label, json, view: v || view() });
    if (undoStack.length > MAX) undoStack.shift();
    redoStack = [];
    VX.Events.emit("history");
  }

  // 快照回放：Model.load 会把当前页重置为第一页并清空选中，这里按快照补回
  function reload(json, v) {
    VX.Model.load(json);
    if (v && v.pageId && VX.Model.page(v.pageId)) VX.Model.setCurrentPage(v.pageId);
    // 只恢复仍然存在的形状（撤销掉“新建”时原 id 已不存在）
    VX.state.selection = ((v && v.sel) || []).filter((id) => VX.Model.shape(id));
    VX.state.selGuides = [];
    VX.Model.emit("selection");
  }

  const History = {
    // 立即事务：快照前状态 → 执行 fn → 入栈
    run(label, fn) {
      const before = VX.Model.serialize();
      const v0 = view();
      fn();
      const after = VX.Model.serialize();
      if (after !== before) push(label, before, v0);
    },

    // 拖拽事务：开始时记录，结束时若无变化则丢弃
    begin() { pending = VX.Model.serialize(); pendingView = view(); },
    commit(label) {
      if (pending && pending !== VX.Model.serialize()) push(label, pending, pendingView);
      pending = null;
      pendingView = null;
    },
    cancel() {
      if (pending) { reload(pending, pendingView); pending = null; pendingView = null; }
    },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push({ label: "redo", json: VX.Model.serialize(), view: view() });
      const it = undoStack.pop();
      reload(it.json, it.view);
      VX.Events.emit("history");
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push({ label: "undo", json: VX.Model.serialize(), view: view() });
      const it = redoStack.pop();
      reload(it.json, it.view);
      VX.Events.emit("history");
      return true;
    },

    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },

    // 新建/打开文档时清空历史（避免跨文档撤销）
    reset() {
      undoStack = [];
      redoStack = [];
      pending = null;
      pendingView = null;
      VX.Events.emit("history");
    },
  };

  VX.History = History;
})();
