// run_all.js —— 一次跑完所有前端 Playwright 验收，只输出结论行
// 用法：node test/e2e/run_all.js
const { spawnSync } = require("child_process");

const scripts = ["check_props.js", "check_editor.js", "check_stencils.js", "check_path_resize.js"];
let bad = 0, total = 0;
for (const s of scripts) {
  const r = spawnSync(process.execPath, [__dirname + "/" + s], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split(/\r?\n/).filter((l) => /^(FAIL|RESULT|脚本异常|INFO)/.test(l));
  const passed = (out.match(/^PASS/gm) || []).length;
  total += passed;
  console.log("== " + s + " ==  (" + passed + " 项通过)");
  console.log(lines.length ? lines.join("\n") : "(无输出)");
  if (r.status !== 0) bad++;
}
console.log(bad ? "\n汇总: " + bad + " 个脚本失败（共 " + total + " 项通过）" : "\n汇总: 全部通过（共 " + total + " 项断言）");
process.exit(bad ? 1 : 0);
