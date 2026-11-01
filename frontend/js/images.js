// images.js —— 图片资产（P6.5 / S3）：导入、hash 去重、尺寸探测、插入形状
// 资产存到文档顶层 doc.assets[]：{ id, name, mime, w, h, hash, dataUrl }
// dataUrl 直接参与序列化，保存 vsdx 时由后端写入 visio/media/*
"use strict";

window.VX = window.VX || {};

(function () {
  const S = () => VX.state;
  const cache = new Map();    // assetId → HTMLImageElement（已解码）
  const loading = new Set();  // 正在解码的 assetId，避免每帧重复 new Image()

  const MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
  };
  const EXT_MIME = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml",
  };

  // 32 位 FNV-1a：只用来判「同一张图」，不做加密
  function hashOf(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  function mimeOf(dataUrl) {
    const m = /^data:([^;,]+)/.exec(dataUrl || "");
    return m ? m[1].toLowerCase() : "image/png";
  }

  function extOf(mime) { return MIME_EXT[mime] || "png"; }

  function assets() {
    const doc = VX.Model.doc;
    if (!Array.isArray(doc.assets)) doc.assets = [];
    return doc.assets;
  }

  function asset(id) { return assets().find((a) => a.id === id) || null; }

  function decode(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = dataUrl;
    });
  }

  function nextAssetId() {
    let max = 0;
    for (const a of assets()) {
      const n = parseInt(String(a.id).slice(1), 10) || 0;
      max = Math.max(max, n);
    }
    return "a" + (max + 1);
  }

  // 加一张图（dataURL）：同一内容只存一份，返回已有资产
  async function addDataUrl(dataUrl, name) {
    const mime = mimeOf(dataUrl);
    const hash = hashOf(dataUrl);
    const hit = assets().find((a) => a.hash === hash);
    if (hit) return hit;

    const img = await decode(dataUrl);
    const a = {
      id: nextAssetId(),
      name: name || ("图片-" + (assets().length + 1)),
      mime,
      ext: extOf(mime),
      w: img.naturalWidth || 1,
      h: img.naturalHeight || 1,
      hash,
      dataUrl,
    };
    assets().push(a);
    cache.set(a.id, img);
    S().dirty = true;
    VX.Events.emit("change");
    return a;
  }

  // 渲染时取图：未解码则登记一次异步解码，成功后刷新画布
  function imageOf(a) {
    if (!a) return null;
    if (cache.has(a.id)) return cache.get(a.id);
    if (!a.dataUrl || loading.has(a.id)) return null;
    loading.add(a.id);
    decode(a.dataUrl).then((img) => {
      cache.set(a.id, img);
      loading.delete(a.id);
      // 导出页没有 VX.state（只有 canvas 局部 dirty 标志），由运行时自己监听 onload 重绘
      if (VX.Renderer && VX.state) VX.Renderer.invalidate();
    }).catch(() => {
      loading.delete(a.id);
    });
    return null;
  }

  // 默认插入尺寸：长边不超过 maxSize，保持宽高比
  function defaultSize(a, maxSize) {
    const max = maxSize || 360;
    const iw = a.w || 1, ih = a.h || 1;
    const k = Math.min(1, max / Math.max(iw, ih));
    return { w: Math.max(8, Math.round(iw * k)), h: Math.max(8, Math.round(ih * k)) };
  }

  // 在 world 点插入图片形状；(x,y) 是形状左上角
  function insert(a, x, y, size) {
    if (!a) return null;
    const d = size || defaultSize(a);
    let s = null;
    VX.History.run("插入图片", () => {
      s = VX.Model.addShape("image", {
        assetId: a.id, fit: "contain",
        x: Math.round(x), y: Math.round(y), w: d.w, h: d.h,
        text: "",
      });
      S().selection = [s.id];
    });
    return s;
  }

  // 拖入/粘贴的 File → 资产 → 形状（world 点为中心）
  async function insertFile(file, world) {
    if (!file || !/(^image\/)|\.svg$/i.test(file.type || file.name || "")) return null;
    const dataUrl = await readAsDataUrl(file);
    const a = await addDataUrl(dataUrl, file.name);
    const d = defaultSize(a);
    return insert(a, world.x - d.w / 2, world.y - d.h / 2, d);
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("读取图片失败"));
      r.readAsDataURL(file);
    });
  }

  // 菜单「插入 → 图片…」：无 Bridge 时退化为浏览器的文件选择框
  async function pickAndInsert() {
    const world = S().insertAt || VX.Viewport.s2w(
      document.getElementById("canvas").clientWidth / 2,
      document.getElementById("canvas").clientHeight / 2);
    let a = null;
    const bridge = window.__tauricpp__;
    if (bridge) {
      try {
        const r = await bridge.invoke("file.open_image", {});
        if (!r || !r.success) return null;
        const dataUrl = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
        a = await addDataUrl(dataUrl, r.name || r.path);
      } catch (e) {
        console.error("file.open_image failed:", e);
        return null;
      }
    } else {
      const file = await browseLocalFile();
      if (!file) return null;
      a = await addDataUrl(await readAsDataUrl(file), file.name);
    }
    if (!a) return null;
    const d = defaultSize(a);
    return insert(a, world.x - d.w / 2, world.y - d.h / 2, d);
  }

  // 浏览器直开时的文件选择（桌面端走原生对话框）
  function browseLocalFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }

  function bindMenu() {
    const drop = document.getElementById("menu-insert");
    if (!drop) return;
    drop.addEventListener("click", (e) => {
      const entry = e.target.closest(".menu-entry");
      if (!entry) return;
      drop.classList.add("hidden");
      if (entry.dataset.act === "insert-image") pickAndInsert();
    });
  }

  // 拖拽图片文件到画布：以落点为中心插入
  function bindDrop() {
    const scroll = document.getElementById("canvas-scroll");
    if (!scroll) return;
    scroll.addEventListener("dragover", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) e.preventDefault();
    });
    scroll.addEventListener("drop", async (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      e.preventDefault();
      const canvas = document.getElementById("canvas");
      const rect = canvas.getBoundingClientRect();
      const w = VX.Viewport.s2w(e.clientX - rect.left, e.clientY - rect.top);
      for (const f of files) {
        try { await insertFile(f, w); } catch (err) { console.warn("插入图片失败:", err); }
      }
    });
  }

  const Images = {
    assets, asset, addDataUrl, imageOf, insert, insertFile, defaultSize, extOf, mimeOf,
    init() {
      bindMenu();
      bindDrop();
    },
  };

  VX.Images = Images;
})();
