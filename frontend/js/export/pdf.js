// pdf.js —— 整个工程 → 多页 PDF（CODEPLAN §6.7 #49 · §7-S1/A1）
// 极简 PDF writer：每页一张 JPEG 直接以 DCTDecode 内嵌（JPEG 码流本身就是 PDF 的合法图像编码，
// 不需要重编码），文本因此不可选中、字体不做子集 —— 矢量 PDF 是 CODEPLAN 里的 C3，先交付栅格。
// 页面尺寸换算：屏幕 96dpi → PDF 72pt，即 1px = 0.75pt（A4 页面 800×1100px → 600×825pt）
//
// 产物按「字符串段 + JPEG base64 段」拼装，最后统一解码成字节：
// 这样全程不拼二进制大字符串，避免 TextEncoder/String.fromCharCode 在几十 MB 上炸栈
"use strict";

(function () {
  const PX_TO_PT = 0.75;

  function asciiBytes(s) { return new TextEncoder().encode(s).length; }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 字节 → base64：分块.fromCharCode，直接对整段调用会超出实参个数上限
  const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToB64(u8) {
    let out = "";
    const n = u8.length;
    for (let i = 0; i < n; i += 3) {
      const b0 = u8[i], b1 = u8[i + 1], b2 = u8[i + 2];
      out += CH[b0 >> 2];
      out += CH[((b0 & 3) << 4) | ((b1 == null ? 0 : b1) >> 4)];
      out += b1 == null ? "=" : CH[((b1 & 15) << 2) | ((b2 == null ? 0 : b2) >> 6)];
      out += b2 == null ? "=" : CH[b2 & 63];
    }
    return out;
  }

  // pages: [{ jpeg: {base64, width, height, pageWidth, pageHeight} }]
  // 注意：JPEG 不能有 alpha，导出层已把页面铺成白底（见 export/png.js 的 jpeg()）
  function pdf(pages, opt) {
    const o = opt || {};
    const title = (o.title || "Visioxure").replace(/[\\()]/g, " ");
    // 每页一个 Image XObject + 一条内容流；对象编号：1 Catalog 2 Pages 3 Info，之后每页 3 个对象
    const objs = [];   // objs[i] = {bytes, parts:[string|Uint8Array]} 先攒文本，最后算偏移
    const push = (text) => objs.push(text);

    push(`<< /Type /Catalog /Pages 2 0 R >>`);                                   // 1
    push("");                                                                     // 2 占位，页数已知后回填
    push(`(Visioxure) /Producer (Visioxure) /CreationDate (D:${o.stamp || "19700101000000Z"})`); // 3 → 包成字典

    const ids = [];
    pages.forEach((pg, i) => {
      const im = pg.jpeg;
      const w = +(im.pageWidth * PX_TO_PT).toFixed(2);
      const h = +(im.pageHeight * PX_TO_PT).toFixed(2);
      const objDict = 4 + i * 3, objStream = objDict + 1, objPage = objStream + 1;
      push(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.byteLength} >>`);
      // 内容流：把单位正方形拉满整页后画图（PDF 的图像默认只占 1×1pt）
      const cs = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
      push(`<< /Length ${asciiBytes(cs)} >>`);
      push(`<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im${i} ${objDict} 0 R >> >>` +
        ` /MediaBox [0 0 ${w} ${h}] /Contents ${objStream} 0 R >>`);
      ids.push({ objDict, objStream, objPage, cs, base64: im.base64 });
    });

    const n = pages.length;
    objs[1] = `<< /Type /Pages /Count ${n} /Kids [${ids.map((x) => x.objPage + " 0 R").join(" ")}] >>`;
    objs[2] = `<< /Title (${title}) /Producer (Visioxure) /CreationDate (D:${o.stamp || "19700101000000Z"}) >>`;

    // 序列化：文本段用 ASCII 写入（本 writer 不输出非 ASCII，Title 已剥掉括号），
    // 二进制段直接放 Uint8Array，偏移量按真实字节数累加
    const chunks = [];
    let pos = 0;
    const offsets = [];   // 1-based 对象号 → 字节偏移
    const add = (bytes) => { pos += bytes; };
    const s = (str) => { const b = new TextEncoder().encode(str); chunks.push(b); add(b.length); };

    s("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    for (let i = 0; i < objs.length; i++) {
      const num = i + 1;
      offsets[num] = pos;
      s(`${num} 0 obj\n`);
      if (num >= 4 && (num - 4) % 3 === 0) {
        // Image XObject：字典 + JPEG 原始字节 + endstream
        const idx = (num - 4) / 3;
        s(objs[num - 1] + "\nstream\n");
        const jpg = b64ToBytes(ids[idx].base64);
        chunks.push(jpg); add(jpg.length);
        s("\nendstream\n");
      } else if (ids.some((x) => x.objStream === num)) {
        s(objs[num - 1] + "\nstream\n" + (ids.find((x) => x.objStream === num).cs) + "\nendstream\n");
      } else {
        s(objs[num - 1] + "\nendobj\n");
        continue;
      }
      s("endobj\n");
    }

    const total = offsets.length;   // = objs.length
    const xrefAt = pos;
    let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= total; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    s(xref);
    s(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    // 合并成单一 Uint8Array 再 base64（后端 export.write 只吃 base64）
    const out = new Uint8Array(pos);
    let cur = 0;
    for (const c of chunks) { out.set(c, cur); cur += c.length; }
    return { base64: bytesToB64(out), byteLength: out.length, pages: n };
  }

  VX.ExportPdf = { pdf, PX_TO_PT, bytesToB64, b64ToBytes, asciiBytes };
})();
