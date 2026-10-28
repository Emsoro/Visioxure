// history.js —— undo/redo（P1）
// 快照式：事务提交时保存全文档 JSON，上限 200 步（P1 验收要求）
"use strict";

(function () {
  const MAX = 200;
  let undoStack = [];   // [{label, json}]
  let redoStack = [];
  let pending = null;   // 拖拽类事务：开始时的快照

  function push(label, json) {
    undoStack.push({ label, json });
    if (undoStack.length > MAX) undoStack.shift();
    redoStack = [];
    VX.Events.emit("history");
  }

  const History = {
    // 立即事务：快照前状态 → 执行 fn → 入栈
    run(label, fn) {
      const before = VX.Model.serialize();
      fn();
      const after = VX.Model.serialize();
      if (after !== before) push(label, before);
    },

    // 拖拽事务：开始时记录，结束时若无变化则丢弃
    begin() { pending = VX.Model.serialize(); },
    commit(label) {
      if (pending && pending !== VX.Model.serialize()) push(label, pending);
      pending = null;
    },
    cancel() { if (pending) { VX.Model.load(pending); pending = null; } },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push({ label: "redo", json: VX.Model.serialize() });
      VX.Model.load(undoStack.pop().json);
      VX.Events.emit("history");
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push({ label: "undo", json: VX.Model.serialize() });
      VX.Model.load(redoStack.pop().json);
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
      VX.Events.emit("history");
    },
  };

  VX.History = History;
})();
