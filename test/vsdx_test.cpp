// vsdx_test.cpp —— JSON → VSDX → JSON round-trip 与包结构断言
#include "vsdx/package.hpp"
#include "vsdx/reader.hpp"
#include "vsdx/writer.hpp"
#include "vsdx/xml.hpp"

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
    std::fflush(stdout);  // 崩溃时保留已输出的诊断
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

// 基础场景：多页面 / 空页面 / 字段缺省 / 透明填充与边线 / XML 特殊字符 / 图层状态 / 变量 / 交互面板
json MakeBasicDoc() {
    auto style = [](const char* fill, const char* line) {
        return json{{"fill", fill}, {"line", line}, {"lineWidth", 1.0}, {"cornerRadius", 0}, {"opacity", 1.0},
                    {"font", {{"family", "Segoe UI"}, {"size", 14}, {"color", "#333333"}, {"bold", false},
                              {"align", "center"}, {"vAlign", "middle"}}}};
    };

    // 页面 1：两个最小字段形状（无 style / 无 text），验证缺省值往返
    json p1 = {
        {"id", "p1"}, {"name", "A&B <1> 页"},
        {"size", {{"mode", "fixed"}, {"w", 600}, {"h", 400}, {"orientation", "landscape"}}},
        {"guides", json::array()},
        {"variables", json::array({{{"name", "用户名"}, {"value", "张&三"}, {"scope", "page"}}})},
        {"layers", json::array()},
        {"shapes", json::array()},
    };
    p1["shapes"].push_back(json{{"id", "m1"}, {"type", "rect"}, {"x", 10}, {"y", 20}, {"w", 50}, {"h", 40}});
    p1["shapes"].push_back(json{{"id", "m2"}, {"type", "ellipse"}, {"x", 200}, {"y", 100}, {"w", 60},
                                 {"h", 60}, {"text", "&quot;&lt;特殊&gt;&amp;字符\"'"}});

    // 页面 2：完全空白页
    json p2 = {
        {"id", "p2"}, {"name", "空页"},
        {"size", {{"mode", "fixed"}, {"w", 400}, {"h", 300}, {"orientation", "landscape"}}},
        {"guides", json::array()},
        {"variables", json::array()},
        {"layers", json::array()},
        {"shapes", json::array()},
    };

    // 页面 3：透明填充/边线、隐藏/锁定图层、全局变量、动态面板、交互、connector 无箭头
    json p3 = {
        {"id", "p3"}, {"name", "样式页"},
        {"size", {{"mode", "fixed"}, {"w", 1100}, {"h", 800}, {"orientation", "portrait"}}},
        {"guides", json::array()},
        {"variables", json::array()},
        {"layers", json::array({
            {{"id", "l1"}, {"name", "底"}, {"visible", true}, {"locked", false}},
            {{"id", "l2"}, {"name", "隐"}, {"visible", false}, {"locked", true}},
        })},
        {"shapes", json::array()},
    };
    p3["shapes"].push_back(json{{"id", "b1"}, {"type", "rect"}, {"x", 30}, {"y", 40}, {"w", 90},
                                 {"h", 50}, {"layer", "l2"},
                                 {"style", style("transparent", "#FF0000")}, {"text", "透明填充"}});
    p3["shapes"].push_back(json{{"id", "b2"}, {"type", "ellipse"}, {"x", 200}, {"y", 60}, {"w", 70},
                                 {"h", 70}, {"layer", "l1"},
                                 {"style", style("#00FF00", "transparent")}});
    json noArrowConnector = {{"id", "b3"},
                             {"type", "connector"},
                             {"x", 0},
                             {"y", 0},
                             {"w", 10},
                             {"h", 10},
                             {"layer", "l1"},
                             {"style", {{"line", "#37474F"}, {"lineWidth", 1.5}, {"arrowEnd", false},
                                        {"arrowBegin", false}, {"opacity", 1.0}}},
                             {"begin", {{"x", 100}, {"y", 100}}},
                             {"end", {{"x", 300}, {"y", 220}}},
                             {"route", "straight"}};
    p3["shapes"].push_back(noArrowConnector);
    json panelShape = {{"id", "b4"},
                       {"type", "panel"},
                       {"x", 400},
                       {"y", 300},
                       {"w", 120},
                       {"h", 80},
                       {"layer", "l1"},
                       {"style", style("#FFFFFF", "#999999")},
                       {"panel", {{"action", "toggle"}, {"targets", json::array({"b1"})}}},
                       {"interactions", json::array({{{"event", "onClick"}, {"action", "show"},
                                                      {"target", "b2"}}})}};
    p3["shapes"].push_back(panelShape);

    return json{{"format", "visioxure"},
                {"version", 1},
                {"doc", {{"theme", "dark"},
                         {"variables", json::array({{{"name", "全局"}, {"value", "1"}, {"scope", "global"}}})}}},
                {"pages", json::array({p1, p2, p3})}};
}

void RunBasicScenarios() {
    std::printf("4) 基础场景（多页面/空页/缺省字段/透明/特殊字符/图层/变量/面板）\n");
    std::string err;
    const json basic = MakeBasicDoc();
    std::string bytes = vsx::BuildVsdxBytes(basic, err);
    Check(!bytes.empty(), "基础场景写入成功" + (bytes.empty() ? (": " + err) : std::string()));
    if (bytes.empty()) return;
    {
        std::ofstream o("build_basic.vsdx", std::ios::binary | std::ios::trunc);
        if (o) o.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    }

    json parsed;
    std::vector<std::string> warnings;
    Check(vsx::ParseVsdxBytes(bytes, parsed, warnings, err), "基础场景读回成功" + err);
    if (parsed["pages"].size() != 3) {
        Check(false, "页面数 = 3");
        return;
    }
    Check(parsed["pages"].size() == 3, "页面数 = 3");
    Check(parsed["pages"][0].value("name", "") == "A&B <1> 页", "页面名特殊字符往返");
    CheckNear(parsed["pages"][1]["size"].value("w", 0.0), 400, 0.5, "空页宽度 = 400");
    Check(parsed["pages"][1]["shapes"].empty(), "空页无形状");
    Check(parsed["pages"][2].value("name", "") == "样式页", "第三页名称保留");

    const json& s1 = parsed["pages"][0]["shapes"];
    {
        vsx::Package dbg;
        std::string de;
        if (vsx::Package::LoadFromBytes(bytes, dbg, de)) {
            std::string px = dbg.FindOr("visio/pages/page1.xml");
            std::printf("DEBUG page1.xml head: %.900s\n", px.c_str());
        }
    }
    std::printf("DEBUG p1 shapes: %s\n", s1.dump(2).c_str());
    std::printf("DEBUG p3 shapes: %s\n", parsed["pages"][2]["shapes"].dump(2).c_str());
    json m1 = FindShape(s1, "m1");
    Check(!m1.is_null() && m1.value("type", "") == "rect", "m1 缺省 style 读回为 rect");
    if (!m1.is_null()) {
        CheckNear(m1.value("x", 0.0), 10, 0.5, "m1 x 往返");
        CheckNear(m1.value("y", 0.0), 20, 0.5, "m1 y 往返");
        CheckNear(m1.value("w", 0.0), 50, 0.5, "m1 w 往返");
        CheckNear(m1.value("h", 0.0), 40, 0.5, "m1 h 往返");
        Check(m1["style"].value("fill", "") == "#FFFFFF", "m1 缺省填充 = #FFFFFF");
        Check(m1["style"].value("line", "") == "#000000", "m1 缺省边线 = #000000");
    }
    json m2 = FindShape(s1, "m2");
    Check(!m2.is_null() && m2.value("text", "") == "&quot;&lt;特殊&gt;&amp;字符\"'", "m2 文本实体往返");

    Check(parsed["pages"][0]["variables"].size() == 1, "页面变量数量一致");
    if (parsed["pages"][0]["variables"].size() == 1)
        Check(parsed["pages"][0]["variables"][0].value("value", "") == "张&三", "页面变量值往返");
    Check(parsed["doc"]["variables"].size() == 1, "全局变量数量一致");
    if (parsed["doc"]["variables"].size() == 1)
        Check(parsed["doc"]["variables"][0].value("name", "") == "全局", "全局变量名往返");

    const auto& layers = parsed["pages"][2]["layers"];
    Check(layers.size() == 2, "第三页图层数 = 2");
    if (layers.size() == 2) {
        Check(layers[1].value("visible", true) == false, "隐藏图层保留");
        Check(layers[1].value("locked", false) == true, "锁定图层保留");
    }

    const json& s3 = parsed["pages"][2]["shapes"];
    json b1 = FindShape(s3, "b1");
    Check(!b1.is_null() && b1["style"].value("fill", "") == "transparent", "b1 透明填充往返");
    if (!b1.is_null()) Check(b1.value("layer", "") == "l2", "b1 图层归属保留");
    json b2 = FindShape(s3, "b2");
    Check(!b2.is_null() && b2["style"].value("line", "") == "transparent", "b2 透明边线往返");
    json b3 = FindShape(s3, "b3");
    Check(!b3.is_null() && b3.value("route", "") == "straight", "b3 直连布线往返");
    if (!b3.is_null()) {
        Check(b3["style"].value("arrowEnd", true) == false, "b3 无末端箭头往返");
        CheckNear(b3["begin"].value("x", 0.0), 100, 0.5, "b3 起点 x 往返");
        CheckNear(b3["end"].value("y", 0.0), 220, 0.5, "b3 终点 y 往返");
    }
    json b4 = FindShape(s3, "b4");
    Check(!b4.is_null() && b4.value("type", "") == "panel", "b4 动态面板类型往返");
    if (!b4.is_null()) {
        Check(b4.contains("panel") && b4["panel"].value("action", "") == "toggle", "b4 面板配置往返");
        Check(b4.value("interactions", json::array()).size() == 1, "b4 交互事件往返");
    }

    // 二次往返稳定性
    std::string bytes2 = vsx::BuildVsdxBytes(parsed, err);
    json parsed3;
    std::vector<std::string> warn3;
    Check(!bytes2.empty() && vsx::ParseVsdxBytes(bytes2, parsed3, warn3, err), "基础场景二次往返成功");
    if (!parsed3.is_null() && parsed3["pages"].size() == 3) {
        Check(parsed3["pages"][0]["name"] == "A&B <1> 页", "二次往返页面名稳定");
        Check(FindShape(parsed3["pages"][0]["shapes"], "m2").value("text", "") ==
                  "&quot;&lt;特殊&gt;&amp;字符\"'",
              "二次往返文本实体稳定");
        Check(FindShape(parsed3["pages"][2]["shapes"], "b1")["style"].value("fill", "") == "transparent",
              "二次往返透明填充稳定");
    }

    // 错误输入回归
    std::printf("5) 错误输入回归\n");
    {
        json bad = {{"format", "visioxure"}, {"version", 1}, {"pages", json::array()}};
        Check(vsx::BuildVsdxBytes(bad, err).empty() && !err.empty(), "空 pages 文档写入报错");
    }
    {
        json parsedX;  // 复用空对象防止未声明
        std::vector<std::string> wx;
        std::string ex;
        Check(!vsx::ParseVsdxBytes(std::string(), parsedX, wx, ex) && !ex.empty(), "空字节解析报错");
        Check(!vsx::ParseVsdxBytes("not a zip at all", parsedX, wx, ex) && !ex.empty(), "非 zip 字节解析报错");
    }
    {
        vsx::Package pkg;
        std::string pe;
        Check(!vsx::Package::LoadFromBytes("PK\x03\x04garbagegarbage", pkg, pe), "损坏 zip 不崩溃并报错");
    }

    // Package API 基础行为
    std::printf("6) Package API\n");
    {
        vsx::Package pkg;
        pkg.Add("visio/x.xml", "<A/>");
        pkg.Add("/visio//y.xml", "<B/>");
        Check(pkg.Has("visio/x.xml"), "Add/Has 路径规范化");
        Check(pkg.FindOr("visio/x.xml") == "<A/>", "FindOr 返回内容");
        Check(pkg.FindOr("missing.xml", "dflt") == "dflt", "FindOr 缺省值");
        Check(vsx::Package::ResolveTarget("visio/pages/pages.xml", "page1.xml") == "visio/pages/page1.xml",
              "ResolveTarget 相对路径");
        Check(vsx::Package::ResolveTarget("visio/pages/pages.xml", "../masters/masters.xml") ==
                  "visio/masters/masters.xml",
              "ResolveTarget 处理 ..");
        Check(vsx::Package::ResolveTarget("", "/visio/document.xml") == "visio/document.xml",
              "ResolveTarget 绝对路径");
    }

    // XML 工具基础行为
    std::printf("7) XML 工具\n");
    {
        Check(vsx::XmlEscape("<&>\"'abc") == "&lt;&amp;&gt;&quot;&apos;abc", "XmlEscape 五字符转义");
        Check(vsx::XmlEscape("普通中文123") == "普通中文123", "XmlEscape 保留普通字符");
    }
    {
        vsx::XmlNode root;
        std::string xe;
        Check(vsx::ParseXml("<?xml version=\"1.0\"?><!--c--><R a=\"1\" b=\"x&amp;y\">t&amp;u<R2/></R>", root, xe),
              "ParseXml 混合语法成功");
        if (root.tag == "R") {
            Check(root.attr("a") == "1" && root.attr("b") == "x&y", "属性与实体解码");
            Check(root.text == "t&u", "直接文本解码");
            Check(root.child("R2") != nullptr, "子元素查找");
            Check(root.attr("missing", "d") == "d", "缺失属性取缺省值");
        } else {
            Check(false, "根元素为 R");
        }
        vsx::XmlNode bad;
        Check(!vsx::ParseXml("<A><B></A>", bad, xe), "标签不匹配报错");
        Check(!vsx::ParseXml("", bad, xe), "空 XML 报错");
    }
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

    RunBasicScenarios();

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
