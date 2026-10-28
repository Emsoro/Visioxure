// vsdx_test.cpp —— JSON → VSDX → JSON round-trip 与包结构断言
#include "vsdx/package.hpp"
#include "vsdx/reader.hpp"
#include "vsdx/writer.hpp"

#include <cmath>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

using nlohmann::json;

namespace {

int failures = 0;

void Check(bool cond, const std::string& what) {
    if (cond) {
        std::printf("  [ok] %s\n", what.c_str());
    } else {
        std::printf("  [FAIL] %s\n", what.c_str());
        ++failures;
    }
}

void CheckNear(double a, double b, double tol, const std::string& what) {
    bool ok = std::fabs(a - b) <= tol;
    if (!ok) {
        char buf[160];
        std::snprintf(buf, sizeof(buf), "%s (got %.3f, want %.3f)", what.c_str(), a, b);
        Check(false, buf);
    } else {
        Check(true, what);
    }
}

json FindShape(const json& shapes, const std::string& id) {
    for (const auto& s : shapes) {
        if (s.value("id", "") == id) return s;
        if (s.value("type", "") == "group") {
            json found = FindShape(s["children"], id);
            if (!found.is_null()) return found;
        }
    }
    return json();
}

json MakeDoc() {
    json page = {
        {"id", "p1"},
        {"name", "登录页"},
        {"size", {{"mode", "fixed"}, {"w", 800}, {"h", 1100}, {"orientation", "portrait"}}},
        {"guides", json::array()},
        {"variables", json::array()},
        {"layers", json::array({{{"id", "l1"}, {"name", "默认"}, {"visible", true}, {"locked", false}}})},
        {"shapes", json::array()},
    };

    auto style = [](const char* fill, const char* line) {
        return json{{"fill", fill}, {"line", line}, {"lineWidth", 1.5}, {"cornerRadius", 6}, {"opacity", 1.0},
                    {"font", {{"family", "Segoe UI"}, {"size", 14}, {"color", "#FFFFFF"}, {"bold", false},
                              {"align", "center"}, {"vAlign", "middle"}}}};
    };

    page["shapes"].push_back(json{{"id", "s1"}, {"type", "rect"}, {"x", 100}, {"y", 80}, {"w", 200},
                                  {"h", 48}, {"angle", 0}, {"z", 1}, {"layer", "l1"}, {"lock", false},
                                  {"style", style("#4A90D9", "#2B6CB0")}, {"text", "登录"}});

    page["shapes"].push_back(json{{"id", "s2"}, {"type", "ellipse"}, {"x", 400}, {"y", 80}, {"w", 120},
                                  {"h", 120}, {"angle", 0}, {"z", 2}, {"layer", "l1"}, {"lock", false},
                                  {"style", style("#5BA85B", "#3D7A3D")}});

    page["shapes"].push_back(json{{"id", "s3"}, {"type", "text"}, {"x", 100}, {"y", 200}, {"w", 180},
                                  {"h", 24}, {"angle", 0}, {"z", 3}, {"layer", "l1"}, {"lock", false},
                                  {"style", style("transparent", "transparent")}, {"text", "标题文字"}});

    json outerRing = json::array();
    outerRing.push_back(json{{"x", -50}, {"y", -30}});
    outerRing.push_back(json{{"x", 50}, {"y", -30}});
    outerRing.push_back(json{{"x", 50}, {"y", 30}});
    outerRing.push_back(json{{"x", -50}, {"y", 30}});
    json innerRing = json::array();
    innerRing.push_back(json{{"x", -20}, {"y", -12}});
    innerRing.push_back(json{{"x", 20}, {"y", -12}});
    innerRing.push_back(json{{"x", 20}, {"y", 12}});
    innerRing.push_back(json{{"x", -20}, {"y", 12}});
    json subpaths = json::array();
    subpaths.push_back(outerRing);
    subpaths.push_back(innerRing);

    page["shapes"].push_back(json{{"id", "s4"}, {"type", "path"}, {"x", 300}, {"y", 300}, {"w", 100},
                                  {"h", 60}, {"angle", 0}, {"z", 4}, {"layer", "l1"}, {"lock", false},
                                  {"style", style("#7B68EE", "#5646B0")},
                                  {"path", {{"fillRule", "evenodd"}, {"subpaths", subpaths}}}});

    json connector = {{"id", "s5"},
                      {"type", "connector"},
                      {"x", 0},
                      {"y", 0},
                      {"w", 10},
                      {"h", 10},
                      {"angle", 0},
                      {"z", 5},
                      {"layer", "l1"},
                      {"lock", false},
                      {"style", {{"line", "#37474F"}, {"lineWidth", 1.5}, {"arrowEnd", true},
                                 {"arrowBegin", false}, {"opacity", 1.0}}},
                      {"glue", {{"begin", "s1:1"}, {"end", "s2:3"}}},
                      {"begin", {{"x", 300}, {"y", 104}}},
                      {"end", {{"x", 460}, {"y", 140}}},
                      {"route", "ortho"}};
    page["shapes"].push_back(connector);

    json group = {{"id", "s6"},
                  {"type", "group"},
                  {"x", 0},
                  {"y", 0},
                  {"w", 10},
                  {"h", 10},
                  {"angle", 0},
                  {"z", 6},
                  {"layer", "l1"},
                  {"lock", false},
                  {"style", nullptr},
                  {"children", json::array()}};
    group["children"].push_back(json{{"id", "s7"}, {"type", "rect"}, {"x", 100}, {"y", 600}, {"w", 80},
                                     {"h", 40}, {"angle", 0}, {"z", 6}, {"layer", "l1"}, {"lock", false},
                                     {"style", style("#E08A3C", "#B06A22")}, {"text", "初始化"}});
    group["children"].push_back(json{{"id", "s8"}, {"type", "ellipse"}, {"x", 200}, {"y", 600}, {"w", 40},
                                     {"h", 40}, {"angle", 0.5}, {"z", 7}, {"layer", "l1"}, {"lock", false},
                                     {"style", style("#4A90D9", "#2B6CB0")}});
    page["shapes"].push_back(group);

    return json{{"format", "visioxure"},
                {"version", 1},
                {"doc", {{"theme", "light"}, {"variables", json::array()}}},
                {"pages", json::array({page})}};
}

}  // namespace

int main(int argc, char** argv) {
    // 外部文件读取回归：vsdx_test --read <path>
    if (argc >= 3 && std::string(argv[1]) == "--read") {
        std::ifstream in(argv[2], std::ios::binary);
        if (!in) {
            std::printf("READ FAIL: cannot open %s\n", argv[2]);
            return 1;
        }
        std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        json doc;
        std::vector<std::string> warnings;
        std::string err;
        if (!vsx::ParseVsdxBytes(bytes, doc, warnings, err)) {
            std::printf("READ FAIL: %s\n", err.c_str());
            return 1;
        }
        std::printf("pages=%zu\n", doc["pages"].size());
        std::vector<std::pair<json, int>> stack;
        for (const auto& p : doc["pages"]) {
            std::printf("page '%s' size=%.0fx%.0f layers=%zu\n", p.value("name", "").c_str(),
                        p["size"].value("w", 0.0), p["size"].value("h", 0.0), p["layers"].size());
            stack.push_back({p["shapes"], 0});
            while (!stack.empty()) {
                auto item = stack.back();
                stack.pop_back();
                for (const auto& s : item.first) {
                    std::string indent(2 + item.second * 2, ' ');
                    std::printf("%s%s %s x=%.1f y=%.1f w=%.1f h=%.1f", indent.c_str(),
                                s.value("type", "?").c_str(), s.value("id", "?").c_str(), s.value("x", 0.0),
                                s.value("y", 0.0), s.value("w", 0.0), s.value("h", 0.0));
                    if (s.contains("text")) std::printf(" text='%s'", s["text"].get<std::string>().c_str());
                    if (s.contains("glue")) {
                        std::printf(" glue=%s->%s", s["glue"].value("begin", "-").c_str(),
                                    s["glue"].value("end", "-").c_str());
                    }
                    std::printf("\n");
                    if (s.value("type", "") == "group") stack.push_back({s["children"], item.second + 1});
                }
            }
        }
        for (const auto& w : warnings) std::printf("warning: %s\n", w.c_str());
        return 0;
    }

    const json doc = MakeDoc();
    std::string err;

    std::printf("1) JSON -> VSDX\n");
    std::string bytes = vsx::BuildVsdxBytes(doc, err);
    if (bytes.empty()) {
        std::printf("  [FAIL] BuildVsdxBytes: %s\n", err.c_str());
        return 1;
    }
    Check(bytes.size() > 1000, "生成 VSDX 字节数 > 1000");

    // 可选：把生成的 vsdx 落盘，便于用 Visio/外部工具验证
    if (argc > 1) {
        std::ofstream out(argv[1], std::ios::binary | std::ios::trunc);
        if (out) {
            out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
            std::printf("  [ok] 已写出 %s (%zu bytes)\n", argv[1], bytes.size());
        }
    }

    // 包结构断言
    {
        vsx::Package pkg;
        std::string perr;
        Check(vsx::Package::LoadFromBytes(bytes, pkg, perr), "生成的包可被解压");
        Check(pkg.Has("[Content_Types].xml"), "包含 [Content_Types].xml");
        Check(pkg.Has("_rels/.rels"), "包含 _rels/.rels");
        Check(pkg.Has("visio/document.xml"), "包含 visio/document.xml");
        Check(pkg.Has("visio/pages/pages.xml"), "包含 visio/pages/pages.xml");
        Check(pkg.Has("visio/pages/page1.xml"), "包含 visio/pages/page1.xml");
        Check(pkg.Has("visio/pages/_rels/pages.xml.rels"), "包含 pages.xml.rels");
        Check(pkg.Has("docProps/core.xml"), "包含 docProps/core.xml");
        Check(pkg.FindOr("[Content_Types].xml").find("application/vnd.ms-visio.page+xml") != std::string::npos,
              "Content_Types 声明 page ContentType");
        std::string pageXml = pkg.FindOr("visio/pages/page1.xml");
        Check(pageXml.find("<PageContents") != std::string::npos, "page1 根元素为 PageContents");
        Check(pageXml.find("登录") != std::string::npos, "page1 含中文文本");
        Check(pageXml.find("PinX") != std::string::npos, "page1 含 PinX 坐标");
        Check(pageXml.find("VXGlueBegin") != std::string::npos, "page1 含连接线粘附标记");
    }

    std::printf("2) VSDX -> JSON\n");
    json parsed;
    std::vector<std::string> warnings;
    bool ok = vsx::ParseVsdxBytes(bytes, parsed, warnings, err);
    Check(ok, "ParseVsdxBytes 成功" + (ok ? std::string() : (": " + err)));
    if (!ok) return 1;

    Check(parsed.value("format", "") == "visioxure", "format 为 visioxure");
    Check(parsed["pages"].size() == 1, "页面数 = 1");
    Check(parsed["pages"][0].value("name", "") == "登录页", "页面名保留");
    CheckNear(parsed["pages"][0]["size"].value("w", 0.0), 800, 0.5, "页面宽 = 800");
    CheckNear(parsed["pages"][0]["size"].value("h", 0.0), 1100, 0.5, "页面高 = 1100");

    const json& shapes = parsed["pages"][0]["shapes"];

    json r1 = FindShape(shapes, "s1");
    Check(!r1.is_null() && r1.value("type", "") == "rect", "s1 读回为 rect");
    if (!r1.is_null()) {
        CheckNear(r1.value("x", 0.0), 100, 0.5, "s1 x 往返一致");
        CheckNear(r1.value("y", 0.0), 80, 0.5, "s1 y 往返一致（Y 轴翻转正确）");
        CheckNear(r1.value("w", 0.0), 200, 0.5, "s1 w 往返一致");
        CheckNear(r1.value("h", 0.0), 48, 0.5, "s1 h 往返一致");
        Check(r1["style"].value("fill", "") == "#4A90D9", "s1 填充色保留");
        Check(r1.value("text", "") == "登录", "s1 文本保留");
        CheckNear(r1["style"].value("cornerRadius", 0.0), 6, 0.5, "s1 圆角保留");
    }

    json e2 = FindShape(shapes, "s2");
    Check(!e2.is_null() && e2.value("type", "") == "ellipse", "s2 读回为 ellipse");
    if (!e2.is_null()) CheckNear(e2.value("x", 0.0), 400, 0.5, "s2 x 往返一致");

    json t3 = FindShape(shapes, "s3");
    Check(!t3.is_null() && t3.value("type", "") == "text", "s3 读回为 text");
    if (!t3.is_null()) Check(t3.value("text", "") == "标题文字", "s3 文本保留");

    json p4 = FindShape(shapes, "s4");
    Check(!p4.is_null() && p4.value("type", "") == "path", "s4 读回为 path");
    if (!p4.is_null()) Check(p4["path"]["subpaths"].size() == 2, "s4 两个子路径保留（含孔洞）");

    json c5 = FindShape(shapes, "s5");
    Check(!c5.is_null() && c5.value("type", "") == "connector", "s5 读回为 connector");
    if (!c5.is_null()) {
        Check(c5.value("route", "") == "ortho", "s5 布线方式保留");
        Check(c5["glue"].value("begin", "") == "s1:1", "s5 起点粘附保留");
        Check(c5["glue"].value("end", "") == "s2:3", "s5 终点粘附保留");
        CheckNear(c5["begin"].value("x", 0.0), 300, 0.5, "s5 起点 x 往返一致");
        CheckNear(c5["end"].value("x", 0.0), 400, 0.5, "s5 终点 x 往返一致（粘附到 s2 左边中点）");
    }

    json g6 = FindShape(shapes, "s6");
    Check(!g6.is_null() && g6.value("type", "") == "group", "s6 读回为 group");
    if (!g6.is_null()) {
        Check(g6["children"].size() == 2, "s6 组内 2 个子形状");
        json c7 = FindShape(g6["children"], "s7");
        Check(!c7.is_null() && c7.value("text", "") == "初始化", "组内 s7 文本保留");
        json c8 = FindShape(g6["children"], "s8");
        Check(!c8.is_null(), "组内 s8 存在");
        if (!c8.is_null()) CheckNear(c8.value("angle", 0.0), 0.5, 0.01, "组内 s8 旋转角保留");
        CheckNear(g6.value("x", -1.0), 100, 0.5, "组包围盒 x 重算正确");
        CheckNear(g6.value("w", 0.0), 140, 0.5, "组包围盒 w 重算正确");
    }

    std::printf("3) 二次往返（parsed JSON -> VSDX -> JSON）\n");
    std::string bytes2 = vsx::BuildVsdxBytes(parsed, err);
    Check(!bytes2.empty(), "二次写入成功" + (bytes2.empty() ? (": " + err) : std::string()));
    json parsed2;
    std::vector<std::string> warn2;
    bool ok2 = !bytes2.empty() && vsx::ParseVsdxBytes(bytes2, parsed2, warn2, err);
    Check(ok2, "二次解析成功");
    if (ok2) {
        json rr = FindShape(parsed2["pages"][0]["shapes"], "s1");
        Check(!rr.is_null() && rr.value("text", "") == "登录", "二次往返文本一致");
        if (!rr.is_null()) CheckNear(rr.value("y", 0.0), 80, 0.5, "二次往返坐标一致");
        json gg = FindShape(parsed2["pages"][0]["shapes"], "s6");
        Check(!gg.is_null() && gg["children"].size() == 2, "二次往返组合结构一致");
        json cc = FindShape(parsed2["pages"][0]["shapes"], "s5");
        Check(!cc.is_null() && cc["glue"].value("begin", "") == "s1:1", "二次往返连接线粘附一致");
    }

    if (!warnings.empty()) {
        std::printf("warnings (%zu):\n", warnings.size());
        for (const auto& w : warnings) std::printf("  - %s\n", w.c_str());
    }

    if (failures == 0) {
        std::printf("ALL PASS\n");
        return 0;
    }
    std::printf("%d FAILURE(S)\n", failures);
    return 1;
}
