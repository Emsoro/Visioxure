// reader.cpp —— VSDX（VisioML）→ 内部文档 JSON
#include "reader.hpp"

#include "package.hpp"
#include "xml.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace vsx {

namespace {

constexpr double kPxPerInch = 96.0;

struct Pt {
    double x = 0, y = 0;
};

double P2D(const std::string& v, double def = 0) {
    if (v.empty()) return def;
    char* end = nullptr;
    double r = std::strtod(v.c_str(), &end);
    return end == v.c_str() ? def : r;
}

std::map<std::string, std::string> ReadCells(const XmlNode& shape) {
    std::map<std::string, std::string> cells;
    for (const XmlNode& c : shape.children) {
        if (c.tag != "Cell") continue;
        std::string n = c.attr("N");
        if (!n.empty()) cells[n] = c.attr("V");
    }
    return cells;
}

std::string UserValue(const XmlNode& shape, const std::string& rowName) {
    for (const XmlNode& sec : shape.children) {
        if (sec.tag != "Section" || sec.attr("N") != "User") continue;
        for (const XmlNode& row : sec.children) {
            if (row.tag != "Row" || row.attr("N") != rowName) continue;
            for (const XmlNode& c : row.children) {
                if (c.tag == "Cell" && c.attr("N") == "Value") return c.attr("V");
            }
        }
    }
    return {};
}

struct GeometryInfo {
    bool hasEllipse = false;
    std::vector<std::vector<Pt>> rings;  // Visio 局部坐标
};

// 几何行 → 折线环。Visio 的 Rel* 行以形状宽高的比例存储坐标；
// 贝塞尔/圆弧行按采样点近似为折线（编辑器内部只支持折线 path）。
GeometryInfo ReadGeometry(const XmlNode& shape, double wIn, double hIn) {
    GeometryInfo g;
    for (const XmlNode& sec : shape.children) {
        if (sec.tag != "Section" || sec.attr("N") != "Geometry") continue;
        std::vector<Pt> cur;
        for (const XmlNode& row : sec.children) {
            if (row.tag != "Row") continue;
            std::string t = row.attr("T");
            if (t == "Ellipse" || t == "RelEllipse") {
                g.hasEllipse = true;
                continue;
            }
            bool rel = t.rfind("Rel", 0) == 0;
            std::string t2 = rel ? t.substr(3) : t;
            // 圆弧行（ArcTo/EllipticalArcTo）按终点直线近似（编辑器内部只支持折线）
            bool arc = t2 == "ArcTo" || t2 == "EllipticalArcTo";
            if (arc) t2 = "LineTo";
            if (t2 != "MoveTo" && t2 != "LineTo" && t2 != "CubBezTo") continue;

            std::map<std::string, std::string> vals;
            for (const XmlNode& c : row.children) {
                if (c.tag == "Cell") vals[c.attr("N")] = c.attr("V");
            }
            auto num = [&](const char* n) {
                auto it = vals.find(n);
                return it == vals.end() ? 0.0 : P2D(it->second);
            };
            auto pt = [&](const char* xn, const char* yn, const char* an = nullptr, const char* bn = nullptr) {
                Pt p{num(xn), num(yn)};
                if (rel) { p.x *= wIn; p.y *= hIn; }
                if (an && bn) { p.x += num(an); p.y += num(bn); }
                return p;
            };

            if (t2 == "MoveTo") {
                if (cur.size() >= 2) g.rings.push_back(cur);
                cur.clear();
                cur.push_back(pt("X", "Y"));
            } else if (t2 == "LineTo") {
                if (cur.empty()) cur.push_back(pt("X", "Y"));
                else cur.push_back(pt("X", "Y"));
            } else {
                // CubBezTo: A/B = 控制点1，C/D = 控制点2，X/Y = 终点
                if (cur.empty()) cur.push_back({0, 0});
                Pt p0 = cur.back();
                Pt c1 = pt("A", "B");
                Pt c2 = pt("C", "D");
                Pt p3 = pt("X", "Y");
                for (int i = 1; i <= 8; ++i) {
                    double u = 1.0 - i / 8.0, t3 = i / 8.0;
                    double x = u * u * u * p0.x + 3 * u * u * t3 * c1.x + 3 * u * t3 * t3 * c2.x + t3 * t3 * t3 * p3.x;
                    double y = u * u * u * p0.y + 3 * u * u * t3 * c1.y + 3 * u * t3 * t3 * c2.y + t3 * t3 * t3 * p3.y;
                    cur.push_back({x, y});
                }
            }
        }
        if (cur.size() >= 2) g.rings.push_back(cur);
    }
    return g;
}

std::string ResolveColor(const std::string& value, const std::map<int, std::string>& palette) {
    if (value.empty()) return "";
    if (value[0] == '#') return value;
    int idx = static_cast<int>(P2D(value, -1));
    if (idx < 0) return "";
    auto it = palette.find(idx);
    if (it != palette.end()) return it->second;
    return "";
}

std::map<int, std::string> ParsePalette(const std::string& documentXml) {
    std::map<int, std::string> palette;
    // Visio 默认调色板（0..15）
    static const char* kDefault[16] = {"#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00",
                                      "#FF00FF", "#00FFFF", "#800000", "#008000", "#000080", "#808000",
                                      "#800080", "#008080", "#C0C0C0", "#808080"};
    for (int i = 0; i < 16; ++i) palette[i] = kDefault[i];

    if (documentXml.empty()) return palette;
    XmlNode root;
    std::string err;
    if (!ParseXml(documentXml, root, err)) return palette;
    const XmlNode* colors = root.child("Colors");
    if (!colors) return palette;
    for (const XmlNode* e : colors->childrenNamed("ColorEntry")) {
        int ix = static_cast<int>(P2D(e->attr("IX"), -1));
        std::string rgb = e->attr("RGB");
        if (ix >= 0 && !rgb.empty()) palette[ix] = rgb;
    }
    return palette;
}

Pt AnchorOf(const nlohmann::json& t, int n) {
    double x = t.value("x", 0.0), y = t.value("y", 0.0);
    double w = t.value("w", 0.0), h = t.value("h", 0.0);
    double angle = t.value("angle", 0.0);
    double cx = x + w / 2, cy = y + h / 2;
    Pt pts[4] = {{cx, y}, {x + w, cy}, {cx, y + h}, {x, cy}};
    Pt p = pts[n & 3];
    if (angle != 0) {
        double c = std::cos(angle), s = std::sin(angle);
        return {cx + (p.x - cx) * c - (p.y - cy) * s, cy + (p.x - cx) * s + (p.y - cy) * c};
    }
    return p;
}

int NearestAnchor(const nlohmann::json& target, Pt p) {
    int best = 0;
    double bestDist = 1e18;
    for (int i = 0; i < 4; ++i) {
        Pt a = AnchorOf(target, i);
        double d = (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

nlohmann::json* FindShapeById(nlohmann::json& arr, const std::string& id) {
    for (auto& s : arr) {
        if (s.value("id", "") == id) return &s;
        if (s.value("type", "") == "group") {
            nlohmann::json* found = FindShapeById(s["children"], id);
            if (found) return found;
        }
    }
    return nullptr;
}

// 由几何数据推断形状类型
std::string DetectType(const std::string& userType, const XmlNode& shape, const GeometryInfo& g,
                       const std::map<std::string, std::string>& cells, const std::string& text,
                       double wIn, double hIn) {
    if (!userType.empty()) return userType;
    if (shape.has("Master")) return "rect";
    if (g.hasEllipse) return "ellipse";
    if (g.rings.empty()) return text.empty() ? "rect" : "text";

    bool noFill = cells.count("FillPattern") && cells.at("FillPattern") == "0";
    bool noLine = cells.count("LinePattern") && cells.at("LinePattern") == "0";
    if (noFill && noLine && !text.empty()) return "text";

    if (g.rings.size() == 1) {
        const std::vector<Pt>& r = g.rings[0];
        bool rectLike = r.size() >= 4 && r.size() <= 6;
        if (rectLike) {
            double minX = r[0].x, maxX = r[0].x, minY = r[0].y, maxY = r[0].y;
            for (const Pt& p : r) {
                minX = std::min(minX, p.x); maxX = std::max(maxX, p.x);
                minY = std::min(minY, p.y); maxY = std::max(maxY, p.y);
            }
            bool allCorners = true;
            for (const Pt& p : r) {
                bool onX = std::fabs(p.x - minX) < 0.01 || std::fabs(p.x - maxX) < 0.01;
                bool onY = std::fabs(p.y - minY) < 0.01 || std::fabs(p.y - maxY) < 0.01;
                if (!(onX && onY)) { allCorners = false; break; }  // 菱形等中点不算矩形
            }
            if (allCorners && std::fabs((maxX - minX) - wIn) < 0.02 && std::fabs((maxY - minY) - hIn) < 0.02) {
                return "rect";
            }
        }
    }
    return "path";
}

// 页面尺寸在 pages.xml 的 Page/PageSheet 中；部分文件（含 Visioxure 自身）也在 pageN.xml 里冗余一份
void ReadPageSize(const XmlNode& pageNode, double& w, double& h) {
    const XmlNode* sheet = pageNode.child("PageSheet");
    if (!sheet) return;
    for (const XmlNode& c : sheet->children) {
        if (c.tag != "Cell") continue;
        std::string n = c.attr("N");
        if (n == "PageWidth") w = P2D(c.attr("V"), w / kPxPerInch) * kPxPerInch;
        if (n == "PageHeight") h = P2D(c.attr("V"), h / kPxPerInch) * kPxPerInch;
    }
}

// ---------- 样式表继承（真实 Visio 文件的形状大量依赖 StyleSheet 默认值） ----------
struct StyleSheetInfo {
    std::map<std::string, std::string> value;
    std::map<std::string, std::string> formula;
    int lineStyle = -1, fillStyle = -1, textStyle = -1;
};
using StyleMap = std::map<int, StyleSheetInfo>;

StyleMap ParseStyleSheets(const XmlNode& docRoot) {
    StyleMap out;
    const XmlNode* sheets = docRoot.child("StyleSheets");
    if (!sheets) return out;
    for (const XmlNode* ss : sheets->childrenNamed("StyleSheet")) {
        int id = static_cast<int>(P2D(ss->attr("ID"), -1));
        if (id < 0) continue;
        StyleSheetInfo info;
        info.lineStyle = static_cast<int>(P2D(ss->attr("LineStyle"), -1));
        info.fillStyle = static_cast<int>(P2D(ss->attr("FillStyle"), -1));
        info.textStyle = static_cast<int>(P2D(ss->attr("TextStyle"), -1));
        for (const XmlNode& c : ss->children) {
            if (c.tag != "Cell") continue;
            std::string n = c.attr("N");
            info.value[n] = c.attr("V");
            info.formula[n] = c.attr("F");
        }
        out[id] = info;
    }
    return out;
}

bool IsLineCell(const std::string& cell) {
    return cell.rfind("Line", 0) == 0 || cell == "Rounding" || cell.rfind("EndArrow", 0) == 0 ||
           cell.rfind("BeginArrow", 0) == 0 || cell == "CompoundType" || cell == "LineCap";
}
bool IsFillCell(const std::string& cell) {
    return cell.rfind("Fill", 0) == 0 || cell.rfind("Shdw", 0) == 0;
}

// 沿样式表链查找单元格（F="Inh" 表示向同表的父样式继承）
std::string StyleValue(const StyleMap& styles, int id, const std::string& cell) {
    std::set<int> seen;
    while (id >= 0 && !seen.count(id)) {
        seen.insert(id);
        auto it = styles.find(id);
        if (it == styles.end()) return "";
        auto v = it->second.value.find(cell);
        if (v != it->second.value.end()) {
            auto f = it->second.formula.find(cell);
            if (f == it->second.formula.end() || f->second != "Inh") return v->second;
        }
        id = IsLineCell(cell) ? it->second.lineStyle : (IsFillCell(cell) ? it->second.fillStyle : it->second.textStyle);
    }
    return "";
}

// 形状单元格：自身 V 优先，缺失时按 Line/Fill/Text 样式表继承
std::string ResolveCell(const XmlNode& sh, const std::map<std::string, std::string>& cells,
                        const StyleMap& styles, const std::string& cell) {
    auto it = cells.find(cell);
    if (it != cells.end() && !it->second.empty()) return it->second;
    const char* attr = IsLineCell(cell) ? "LineStyle" : (IsFillCell(cell) ? "FillStyle" : "TextStyle");
    int sid = static_cast<int>(P2D(sh.attr(attr, "0"), 0));
    return StyleValue(styles, sid, cell);
}

double CellNum(const XmlNode& sh, const std::map<std::string, std::string>& cells, const StyleMap& styles,
               const std::string& cell, double def) {
    std::string v = ResolveCell(sh, cells, styles, cell);
    return v.empty() ? def : P2D(v, def);
}

// ---------- 母版继承：真实 Visio 文件的形状通常只给 Pin/宽高，几何来自 Master ----------
using MasterMap = std::map<int, XmlNode>;

// Geometry 段按 IX 逐行合并：页面形状通常只覆盖若干行（其余来自母版）
void MergeGeometrySection(XmlNode& out, const XmlNode& pageSec, double mx, double my) {
    std::string ix = pageSec.attr("IX");
    XmlNode* target = nullptr;
    for (XmlNode& s : out.children) {
        if (s.tag == "Section" && s.attr("N") == "Geometry" && s.attr("IX") == ix) { target = &s; break; }
    }
    if (!target) {
        out.children.push_back(pageSec);
        return;
    }
    for (const XmlNode& row : pageSec.children) {
        if (row.tag != "Row") continue;
        bool replaced = false;
        for (XmlNode& mr : target->children) {
            if (mr.tag != "Row" || mr.attr("IX") != row.attr("IX")) continue;
            for (const XmlNode& c : row.children) {
                if (c.tag != "Cell") continue;
                XmlNode copy = c;
                // 页面坐标 → 母版坐标（后续统一按母版尺寸缩放）
                bool rel = row.attr("T").rfind("Rel", 0) == 0;
                if (!rel && (c.attr("N") == "X" || c.attr("N") == "Y" ||
                             c.attr("N") == "A" || c.attr("N") == "B" ||
                             c.attr("N") == "C" || c.attr("N") == "D")) {
                    double v = P2D(c.attr("V"), 0);
                    v *= (c.attr("N") == "Y" || c.attr("N") == "B" || c.attr("N") == "D") ? my : mx;
                    std::string sv = std::to_string(v);
                    bool setV = false;
                    for (auto& kv : copy.attrs) {
                        if (kv.first == "V") { kv.second = sv; setV = true; break; }
                    }
                    if (!setV) copy.attrs.push_back({"V", sv});
                }
                bool rc = false;
                for (XmlNode& mc : mr.children) {
                    if (mc.tag == "Cell" && mc.attr("N") == c.attr("N")) { mc = copy; rc = true; break; }
                }
                if (!rc) mr.children.push_back(copy);
            }
            replaced = true;
            break;
        }
        if (!replaced) target->children.push_back(row);
    }
    for (const XmlNode& c : pageSec.children) {
        if (c.tag != "Cell") continue;
        bool rc = false;
        for (XmlNode& mc : target->children) {
            if (mc.tag == "Cell" && mc.attr("N") == c.attr("N")) { mc = c; rc = true; break; }
        }
        if (!rc) target->children.push_back(c);
    }
}

// 页面形状覆盖母版同名单元格/段落/字符/文本，其余沿用母版
XmlNode MergeMasterShape(const XmlNode& master, const XmlNode& page, double mw, double mh, double pw, double ph) {
    XmlNode out = master;
    double mx = (pw > 0 && mw > 0) ? mw / pw : 1.0;  // 页面单位 → 母版单位
    double my = (ph > 0 && mh > 0) ? mh / ph : 1.0;
    for (const XmlNode& c : page.children) {
        if (c.tag == "Cell") {
            bool replaced = false;
            for (XmlNode& mc : out.children) {
                if (mc.tag == "Cell" && mc.attr("N") == c.attr("N")) { mc = c; replaced = true; break; }
            }
            if (!replaced) out.children.push_back(c);
        } else if (c.tag == "Section") {
            std::string n = c.attr("N");
            if (n == "Geometry") {
                MergeGeometrySection(out, c, mx, my);
            } else if (n == "Character" || n == "Paragraph") {
                out.children.erase(std::remove_if(out.children.begin(), out.children.end(),
                                                  [&](const XmlNode& x) {
                                                      return x.tag == "Section" && x.attr("N") == n;
                                                  }),
                                   out.children.end());
                out.children.push_back(c);
            }
        } else if (c.tag == "Text") {
            bool replaced = false;
            for (XmlNode& mc : out.children) {
                if (mc.tag == "Text") { mc = c; replaced = true; break; }
            }
            if (!replaced) out.children.push_back(c);
        }
    }
    return out;
}

// ---------- 组合坐标变换（Visio 子形状坐标相对父组合本地原点，随父角度旋转） ----------
struct Xform {
    double ox = 0, oy = 0;  // 本地坐标原点在页面坐标中的位置（英寸，Y 向上）
    double angle = 0;       // 累计旋转（弧度，逆时针为正）
};

// 父本地坐标 → 页面坐标
Pt ToPage(const Xform& parent, const Pt& local) {
    double c = std::cos(parent.angle), s = std::sin(parent.angle);
    return {parent.ox + local.x * c - local.y * s, parent.oy + local.x * s + local.y * c};
}

// 单个形状（非组合）→ 内部 JSON；坐标已换算到页面空间
nlohmann::json ParseLeaf(const XmlNode& sh, const std::string& id, const Xform& parent, double pageH,
                         const std::map<int, std::string>& palette, const StyleMap& styles,
                         const std::map<int, std::string>& layerByIndex, std::vector<std::string>& warnings,
                         const std::string& pageName, const MasterMap& masters) {
    // 页面形状自身宽高（母版几何要缩放到这个尺寸）
    std::map<std::string, std::string> pageCells = ReadCells(sh);
    double wIn = std::max(0.001, CellNum(sh, pageCells, styles, "Width", 0.01));
    double hIn = std::max(0.001, CellNum(sh, pageCells, styles, "Height", 0.01));

    // 母版继承：几何/字符/线条来自 Master，Pin/宽高等由页面形状覆盖
    const XmlNode* srcPtr = &sh;
    XmlNode merged;
    int masterId = static_cast<int>(P2D(sh.attr("Master"), -1));
    bool masterMissing = false;
    double masterW = 0, masterH = 0;
    if (masterId >= 0) {
        auto mit = masters.find(masterId);
        if (mit != masters.end()) {
            std::map<std::string, std::string> mcells = ReadCells(mit->second);
            masterW = std::max(0.001, CellNum(mit->second, mcells, styles, "Width", 0.01));
            masterH = std::max(0.001, CellNum(mit->second, mcells, styles, "Height", 0.01));
            merged = MergeMasterShape(mit->second, sh, masterW, masterH, wIn, hIn);
            srcPtr = &merged;
        } else {
            masterMissing = true;
        }
    }
    const XmlNode& src = *srcPtr;

    std::map<std::string, std::string> cells = ReadCells(src);
    double pinX = CellNum(src, cells, styles, "PinX", 0);
    double pinY = CellNum(src, cells, styles, "PinY", 0);
    double vAngle = CellNum(src, cells, styles, "Angle", 0);

    // 母版几何按母版自身宽高解析，再缩放到页面形状的宽高
    GeometryInfo geo;
    if (masterW > 0 && masterH > 0) {
        geo = ReadGeometry(src, masterW, masterH);
        double sx = wIn / masterW, sy = hIn / masterH;
        for (auto& ring : geo.rings) {
            for (Pt& p : ring) { p.x *= sx; p.y *= sy; }
        }
    } else {
        geo = ReadGeometry(src, wIn, hIn);
    }

    // 内部模型：x/y/w/h 为未旋转包围盒，旋转围绕中心（与编辑器渲染一致）
    Pt center = ToPage(parent, {pinX, pinY});
    double totalAngle = parent.angle + vAngle;
    double wPx = std::max(0.5, wIn * kPxPerInch);
    double hPx = std::max(0.5, hIn * kPxPerInch);
    double xPx = (center.x - wIn / 2) * kPxPerInch;
    double yPx = pageH - (center.y + hIn / 2) * kPxPerInch;
    Pt localOrigin{center.x - wIn / 2, center.y - hIn / 2};
    auto geomToPage = [&](const Pt& p) {
        double c = std::cos(totalAngle), s = std::sin(totalAngle);
        return Pt{localOrigin.x + p.x * c - p.y * s, localOrigin.y + p.x * s + p.y * c};
    };

    std::string text;
    if (const XmlNode* t = src.child("Text")) {
        text = t->allText();
        while (!text.empty() && (text.back() == '\r' || text.back() == '\n')) text.pop_back();
    }

    std::string userType = UserValue(sh, "VXType");
    if (userType.empty() && cells.count("BeginX") && cells.count("EndX")) userType = "connector";  // 原生 1-D 形状
    std::string kind = DetectType(userType, src, geo, cells, text, wIn, hIn);

    nlohmann::json style = nlohmann::json::object();
    bool fillOff = false, lineOff = false;
    {
        std::string fp = ResolveCell(src, cells, styles, "FillPattern");
        std::string lp = ResolveCell(src, cells, styles, "LinePattern");
        if (!fp.empty()) fillOff = static_cast<int>(P2D(fp, 1)) == 0;
        if (!lp.empty()) lineOff = static_cast<int>(P2D(lp, 1)) == 0;
    }
    double opacity = 1.0 - CellNum(src, cells, styles, "FillForegndTrans", 0.0);
    opacity = std::min(opacity, 1.0 - CellNum(src, cells, styles, "LineColorTrans", 0.0));
    opacity = std::max(0.0, std::min(1.0, opacity));

    std::string fill = fillOff ? "transparent" : ResolveColor(ResolveCell(src, cells, styles, "FillForegnd"), palette);
    if (!fillOff && (fill.empty() || fill[0] != '#')) fill = "#FFFFFF";
    std::string lineColor = lineOff ? "transparent" : ResolveColor(ResolveCell(src, cells, styles, "LineColor"), palette);
    if (!lineOff && (lineColor.empty() || lineColor[0] != '#')) lineColor = "#000000";
    double lineWidth = CellNum(src, cells, styles, "LineWeight", 0.0104) * kPxPerInch;

    if (kind != "connector") style["fill"] = fill;
    style["line"] = lineColor;
    style["lineWidth"] = lineWidth;
    style["opacity"] = opacity;

    // 字体
    nlohmann::json font = {{"family", "Segoe UI"}, {"size", 14.0}, {"color", "#333333"},
                           {"bold", false}, {"align", "center"}, {"vAlign", "middle"}};
    for (const XmlNode& sec : src.children) {
        if (sec.tag != "Section") continue;
        std::string n = sec.attr("N");
        if (n == "Character") {
            for (const XmlNode& row : sec.children) {
                if (row.tag != "Row") continue;
                for (const XmlNode& c : row.children) {
                    if (c.tag != "Cell") continue;
                    std::string cn = c.attr("N");
                    if (cn == "Font") font["family"] = c.attr("V");
                    else if (cn == "Size") font["size"] = P2D(c.attr("V"), 14.0 / kPxPerInch) * kPxPerInch;
                    else if (cn == "Color") {
                        std::string col = ResolveColor(c.attr("V"), palette);
                        if (!col.empty()) font["color"] = col;
                    } else if (cn == "Style") {
                        font["bold"] = (static_cast<int>(P2D(c.attr("V"), 0)) & 1) != 0;
                    }
                }
            }
        } else if (n == "Paragraph") {
            for (const XmlNode& row : sec.children) {
                if (row.tag != "Row") continue;
                for (const XmlNode& c : row.children) {
                    if (c.tag == "Cell" && c.attr("N") == "HorzAlign") {
                        int a = static_cast<int>(P2D(c.attr("V"), 1));
                        font["align"] = a == 0 ? "left" : (a == 2 ? "right" : "center");
                    }
                }
            }
        }
    }
    {
        std::string vaStr = ResolveCell(src, cells, styles, "VerticalAlign");
        if (!vaStr.empty()) {
            int va = static_cast<int>(P2D(vaStr, 1));
            font["vAlign"] = va == 0 ? "top" : (va == 2 ? "bottom" : "middle");
        }
    }
    style["font"] = font;

    if (kind != "connector") {
        std::string roundStr = ResolveCell(src, cells, styles, "Rounding");
        if (!roundStr.empty()) style["cornerRadius"] = P2D(roundStr, 0) * kPxPerInch;
    }

    nlohmann::json shape = {{"id", id}, {"type", kind}, {"x", xPx}, {"y", yPx}, {"w", wPx}, {"h", hPx},
                            {"angle", -totalAngle}, {"z", 0}, {"layer", "l1"}, {"lock", false},
                            {"style", style}};
    if (!text.empty()) shape["text"] = text;

    if (kind == "connector") {
        bool hasBegin = cells.count("BeginX") && cells.count("BeginY");
        bool hasEnd = cells.count("EndX") && cells.count("EndY");
        Pt A{xPx, yPx + hPx}, B{xPx + wPx, yPx};
        if (hasBegin) {
            A.x = P2D(cells["BeginX"]) * kPxPerInch;
            A.y = pageH - P2D(cells["BeginY"]) * kPxPerInch;
        }
        if (hasEnd) {
            B.x = P2D(cells["EndX"]) * kPxPerInch;
            B.y = pageH - P2D(cells["EndY"]) * kPxPerInch;
        }
        if (userType == "connector") {
            std::string bx = UserValue(sh, "VXBeginX"), by = UserValue(sh, "VXBeginY");
            std::string ex = UserValue(sh, "VXEndX"), ey = UserValue(sh, "VXEndY");
            if (!bx.empty() && !by.empty()) {
                A.x = P2D(bx) * kPxPerInch;
                A.y = pageH - P2D(by) * kPxPerInch;
            }
            if (!ex.empty() && !ey.empty()) {
                B.x = P2D(ex) * kPxPerInch;
                B.y = pageH - P2D(ey) * kPxPerInch;
            }
        }
        if (!hasBegin && !geo.rings.empty()) {
            Pt a = geomToPage(geo.rings.front().front());
            A = {a.x * kPxPerInch, pageH - a.y * kPxPerInch};
        }
        if (!hasEnd && !geo.rings.empty()) {
            Pt b = geomToPage(geo.rings.front().back());
            B = {b.x * kPxPerInch, pageH - b.y * kPxPerInch};
        }
        shape["begin"] = {{"x", A.x}, {"y", A.y}};
        shape["end"] = {{"x", B.x}, {"y", B.y}};
        // 原生 1-D 连接线默认按直角折线绘制；Visioxure 自身文件沿用存储的 route
        std::string vxRoute = UserValue(sh, "VXRoute");
        std::string route = (hasBegin && hasEnd)
                                ? "ortho"
                                : ((geo.rings.empty() || geo.rings[0].size() <= 2) ? "straight" : "ortho");
        if (!vxRoute.empty()) route = vxRoute;
        shape["route"] = route;
        if (route == "manual" && !geo.rings.empty()) {
            nlohmann::json pts = nlohmann::json::array();
            for (const Pt& p : geo.rings.front()) {
                Pt q = geomToPage(p);
                pts.push_back({{"x", q.x * kPxPerInch}, {"y", pageH - q.y * kPxPerInch}});
            }
            shape["points"] = pts;
        }
        std::string ea = ResolveCell(src, cells, styles, "EndArrow");
        style["arrowEnd"] = ea.empty() ? true : (static_cast<int>(P2D(ea, 0)) != 0);
        style["arrowBegin"] = static_cast<int>(P2D(ResolveCell(src, cells, styles, "BeginArrow"), 0)) != 0;
        shape["style"] = style;

        std::string gb = UserValue(sh, "VXGlueBegin");
        std::string ge = UserValue(sh, "VXGlueEnd");
        nlohmann::json glue = nlohmann::json::object();
        if (!gb.empty()) glue["begin"] = gb;
        if (!ge.empty()) glue["end"] = ge;
        if (!glue.empty()) shape["glue"] = glue;
    } else if (kind == "path") {
        nlohmann::json subpaths = nlohmann::json::array();
        for (const auto& ring : geo.rings) {
            nlohmann::json sp = nlohmann::json::array();
            for (const Pt& p : ring) {
                sp.push_back({{"x", p.x * kPxPerInch - wPx / 2}, {"y", hPx / 2 - p.y * kPxPerInch}});
            }
            subpaths.push_back(sp);
        }
        shape["path"] = {{"subpaths", subpaths}, {"fillRule", "evenodd"}};
    }

    if (cells.count("LayerMember")) {
        int li = static_cast<int>(P2D(cells["LayerMember"], 0));
        if (layerByIndex.count(li)) shape["layer"] = layerByIndex.at(li);
    }

    if (masterMissing) {
        warnings.push_back(pageName + " / " + id + " 引用的母版缺失，已降级为矩形占位");
    }

    // P4：交互与动态面板状态（本应用写入的 User 段）
    std::string interRaw = UserValue(sh, "VXInteractions");
    if (!interRaw.empty()) {
        try {
            nlohmann::json ij = nlohmann::json::parse(interRaw);
            if (ij.is_array()) shape["interactions"] = ij;
        } catch (...) {
        }
    }
    if (userType == "panel") {
        std::string panelRaw = UserValue(sh, "VXPanel");
        if (!panelRaw.empty()) {
            try {
                nlohmann::json pj = nlohmann::json::parse(panelRaw);
                if (pj.is_object()) shape["panel"] = pj;
            } catch (...) {
            }
        }
    }
    return shape;
}

// 形状节点（可能是原生组合）→ 内部 JSON，递归处理子形状
nlohmann::json ParseNode(const XmlNode& sh, const std::string& id, const Xform& parent, double pageH,
                         const std::map<int, std::string>& palette, const StyleMap& styles,
                         const std::map<int, std::string>& layerByIndex, std::vector<std::string>& warnings,
                         const std::string& pageName, const std::map<int, std::string>& idMap,
                         const MasterMap& masters) {
    const XmlNode* inner = sh.child("Shapes");
    if (sh.attr("Type") != "Group" || !inner) {
        return ParseLeaf(sh, id, parent, pageH, palette, styles, layerByIndex, warnings, pageName, masters);
    }

    std::map<std::string, std::string> cells = ReadCells(sh);
    double wIn = std::max(0.001, CellNum(sh, cells, styles, "Width", 0.01));
    double hIn = std::max(0.001, CellNum(sh, cells, styles, "Height", 0.01));
    double pinX = CellNum(sh, cells, styles, "PinX", 0);
    double pinY = CellNum(sh, cells, styles, "PinY", 0);
    double locX = CellNum(sh, cells, styles, "LocPinX", wIn / 2);
    double locY = CellNum(sh, cells, styles, "LocPinY", hIn / 2);
    // 组合本地坐标原点 = Pin 点 - LocPin 偏移（未旋转的本地坐标系）
    Pt origin = ToPage(parent, {pinX - locX, pinY - locY});
    Xform self{origin.x, origin.y, parent.angle + CellNum(sh, cells, styles, "Angle", 0)};

    nlohmann::json children = nlohmann::json::array();
    for (const XmlNode* ch : inner->childrenNamed("Shape")) {
        if (ch->attr("Type") == "Guide") continue;
        int numeric = static_cast<int>(P2D(ch->attr("ID"), 0));
        std::string cid = idMap.count(numeric) ? idMap.at(numeric) : ("s" + std::to_string(numeric));
        children.push_back(ParseNode(*ch, cid, self, pageH, palette, styles, layerByIndex, warnings, pageName, idMap,
                                     masters));
    }
    if (children.empty()) return nlohmann::json::object();

    std::string layer = "l1";
    if (cells.count("LayerMember")) {
        int li = static_cast<int>(P2D(cells["LayerMember"], 0));
        if (layerByIndex.count(li)) layer = layerByIndex.at(li);
    }
    return {{"id", id}, {"type", "group"}, {"x", 0}, {"y", 0}, {"w", 0}, {"h", 0},
            {"angle", 0}, {"z", 0}, {"layer", layer}, {"lock", false}, {"children", children}};
}
// 页面/全局变量存于 PageSheet 的 User 段（本应用写入）
void ReadPageUserVars(const XmlNode& pageNode, nlohmann::json& pageVars, nlohmann::json& globalVars) {
    const XmlNode* sheet = pageNode.child("PageSheet");
    if (!sheet) return;
    for (const XmlNode& sec : sheet->children) {
        if (sec.tag != "Section" || sec.attr("N") != "User") continue;
        for (const XmlNode& row : sec.children) {
            if (row.tag != "Row") continue;
            std::string rn = row.attr("N");
            if (rn != "VXVars" && rn != "VXGlobalVars") continue;
            std::string raw;
            for (const XmlNode& c : row.children) {
                if (c.tag == "Cell" && c.attr("N") == "Value") raw = c.attr("V");
            }
            if (raw.empty()) continue;
            try {
                nlohmann::json parsed = nlohmann::json::parse(raw);
                if (!parsed.is_array()) continue;
                if (rn == "VXVars") pageVars = parsed;
                else globalVars = parsed;
            } catch (...) {
            }
        }
    }
}

nlohmann::json ParsePage(const XmlNode& pageRoot, const std::string& pageName, double& outW, double& outH,
                         const std::map<int, std::string>& palette, const StyleMap& styles,
                         const MasterMap& masters, std::vector<std::string>& warnings) {
    double pageW = outW, pageH = outH;
    const XmlNode* sheet = pageRoot.child("PageSheet");
    if (sheet) {
        for (const XmlNode& c : sheet->children) {
            if (c.tag != "Cell") continue;
            std::string n = c.attr("N");
            if (n == "PageWidth") pageW = P2D(c.attr("V"), pageW / kPxPerInch) * kPxPerInch;
            if (n == "PageHeight") pageH = P2D(c.attr("V"), pageH / kPxPerInch) * kPxPerInch;
        }
    }
    outW = pageW;
    outH = pageH;

    // 图层
    nlohmann::json layers = nlohmann::json::array();
    std::map<int, std::string> layerByIndex;
    const XmlNode* layersNode = pageRoot.child("Layers");
    if (layersNode) {
        int pos = 0;
        for (const XmlNode* l : layersNode->childrenNamed("Layer")) {
            nlohmann::json layer = {{"id", "l" + std::to_string(pos + 1)},
                                    {"name", l->attr("Name", "图层-" + std::to_string(pos + 1))},
                                    {"visible", true},
                                    {"locked", false}};
            for (const XmlNode& c : l->children) {
                if (c.tag != "Cell") continue;
                if (c.attr("N") == "Visible") layer["visible"] = c.attr("V") != "0";
                if (c.attr("N") == "Lock") layer["locked"] = c.attr("V") != "0";
            }
            layers.push_back(layer);
            layerByIndex[pos] = layer["id"].get<std::string>();
            ++pos;
        }
    }
    if (layers.empty()) {
        layers.push_back({{"id", "l1"}, {"name", "默认"}, {"visible", true}, {"locked", false}});
        layerByIndex[0] = "l1";
    }

    const XmlNode* shapesNode = pageRoot.child("Shapes");
    if (!shapesNode) {
        return {{"shapes", nlohmann::json::array()}, {"layers", layers}};
    }

    // 第一遍：ID 映射（含原生组合的子形状，连接关系按 ID 引用）
    std::map<int, std::string> idMap;
    std::set<std::string> usedIds;
    std::function<void(const XmlNode&)> collectIds = [&](const XmlNode& node) {
        for (const XmlNode* sh : node.childrenNamed("Shape")) {
            if (sh->attr("Type") == "Guide") continue;
            int numeric = static_cast<int>(P2D(sh->attr("ID"), 0));
            std::string nameU = sh->attr("NameU");
            std::string internal;
            if (nameU.size() > 1 && nameU[0] == 's' &&
                std::all_of(nameU.begin() + 1, nameU.end(), [](char c) { return c >= '0' && c <= '9'; })) {
                internal = nameU;
            } else {
                internal = "s" + std::to_string(numeric > 0 ? numeric : (static_cast<int>(idMap.size()) + 1));
            }
            std::string base = internal;
            int dup = 2;
            while (usedIds.count(internal)) internal = base + "_" + std::to_string(dup++);
            usedIds.insert(internal);
            idMap[numeric] = internal;
            if (const XmlNode* inner = sh->child("Shapes")) collectIds(*inner);
        }
    };
    collectIds(*shapesNode);

    nlohmann::json pageShapes = nlohmann::json::array();

    // 真实 Visio 文件：原生组合（Type="Group"）内嵌 <Shapes>，子形状坐标相对父组合
    bool hasNativeGroups = false;
    for (const XmlNode* sh : shapesNode->childrenNamed("Shape")) {
        if (sh->attr("Type") == "Group" && sh->child("Shapes")) { hasNativeGroups = true; break; }
    }

    if (hasNativeGroups) {
        for (const XmlNode* sh : shapesNode->childrenNamed("Shape")) {
            if (sh->attr("Type") == "Guide") continue;
            int numeric = static_cast<int>(P2D(sh->attr("ID"), 0));
            std::string id = idMap.count(numeric) ? idMap.at(numeric) : ("s" + std::to_string(numeric));
            nlohmann::json node = ParseNode(*sh, id, Xform{}, pageH, palette, styles, layerByIndex, warnings,
                                            pageName, idMap, masters);
            if (node.is_object() && !node.empty()) pageShapes.push_back(node);
        }
    } else {
    // Visioxure 自身文件：形状扁平存储，用 VXGroup 链还原组合
    struct Flat {
        nlohmann::json shape;
        std::string chain;
    };
    std::vector<Flat> flats;

    for (const XmlNode* sh : shapesNode->childrenNamed("Shape")) {
        std::string type = sh->attr("Type");
        if (type == "Guide") continue;
        int numeric = static_cast<int>(P2D(sh->attr("ID"), 0));
        std::string id = idMap.count(numeric) ? idMap[numeric] : ("s" + std::to_string(numeric));
        nlohmann::json shape = ParseLeaf(*sh, id, Xform{}, pageH, palette, styles, layerByIndex, warnings, pageName,
                                         masters);
        flats.push_back({shape, UserValue(*sh, "VXGroup")});
    }

    // 组装页面形状（含组合还原）
    auto split = [](const std::string& s) {
        std::vector<std::string> out;
        size_t start = 0;
        while (start <= s.size()) {
            size_t pos = s.find('|', start);
            std::string seg = s.substr(start, pos == std::string::npos ? std::string::npos : pos - start);
            if (!seg.empty()) out.push_back(seg);
            if (pos == std::string::npos) break;
            start = pos + 1;
        }
        return out;
    };

    // 以 parent（""=页面根）为键收集子项，保留出现顺序；组合先于其子形状登记
    struct Entry {
        bool isGroup = false;
        std::string gid;
        nlohmann::json shape;
    };
    std::map<std::string, std::vector<Entry>> childrenOf;
    std::set<std::string> registeredGroups;

    for (Flat& f : flats) {
        std::vector<std::string> chain = split(f.chain);
        std::string parent;
        for (const std::string& gid : chain) {
            if (!registeredGroups.count(gid)) {
                registeredGroups.insert(gid);
                childrenOf[parent].push_back({true, gid, nlohmann::json()});
            }
            parent = gid;
        }
        childrenOf[parent].push_back({false, "", f.shape});
    }

    std::function<nlohmann::json(const std::string&)> buildLevel = [&](const std::string& parent) {
        nlohmann::json arr = nlohmann::json::array();
        for (const Entry& e : childrenOf[parent]) {
            if (!e.isGroup) {
                arr.push_back(e.shape);
            } else {
                nlohmann::json g = {{"id", e.gid}, {"type", "group"}, {"x", 0}, {"y", 0}, {"w", 0},
                                    {"h", 0}, {"angle", 0}, {"z", 0}, {"layer", "l1"}, {"lock", false},
                                    {"children", buildLevel(e.gid)}};
                arr.push_back(g);
            }
        }
        return arr;
    };
    pageShapes = buildLevel("");
    }

    // 组合包围盒 + 层
    std::function<void(nlohmann::json&)> finalize = [&](nlohmann::json& arr) {
        for (auto& s : arr) {
            if (s.value("type", "") != "group") continue;
            nlohmann::json& kids = s["children"];
            finalize(kids);
            if (kids.empty()) continue;
            double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
            for (const auto& k : kids) {
                minX = std::min(minX, k.value("x", 0.0));
                minY = std::min(minY, k.value("y", 0.0));
                maxX = std::max(maxX, k.value("x", 0.0) + k.value("w", 0.0));
                maxY = std::max(maxY, k.value("y", 0.0) + k.value("h", 0.0));
            }
            s["x"] = minX; s["y"] = minY; s["w"] = maxX - minX; s["h"] = maxY - minY;
            s["layer"] = kids[0].value("layer", "l1");
        }
    };
    finalize(pageShapes);

    // z 序号（DFS）
    int z = 1;
    std::function<void(nlohmann::json&)> assignZ = [&](nlohmann::json& arr) {
        for (auto& s : arr) {
            s["z"] = z++;
            if (s.value("type", "") == "group") assignZ(s["children"]);
        }
    };
    assignZ(pageShapes);

    // 页面 Connects → 连接线粘附（无 User 标记的 Visio 原生文件）
    const XmlNode* connects = pageRoot.child("Connects");
    if (connects) {
        for (const XmlNode* c : connects->childrenNamed("Connect")) {
            int from = static_cast<int>(P2D(c->attr("FromSheet"), 0));
            int to = static_cast<int>(P2D(c->attr("ToSheet"), 0));
            std::string fromId = idMap.count(from) ? idMap[from] : ("s" + std::to_string(from));
            std::string toId = idMap.count(to) ? idMap[to] : ("s" + std::to_string(to));
            nlohmann::json* conn = FindShapeById(pageShapes, fromId);
            nlohmann::json* target = FindShapeById(pageShapes, toId);
            if (!conn || !target || conn->value("type", "") != "connector") continue;
            std::string fromCell = c->attr("FromCell");
            const char* which = fromCell.rfind("Begin", 0) == 0 ? "begin" : "end";
            if (!conn->contains("glue")) (*conn)["glue"] = nlohmann::json::object();
            double px = (*conn)["begin"]["x"].get<double>(), py = (*conn)["begin"]["y"].get<double>();
            if (std::string(which) == "end") {
                px = (*conn)["end"]["x"].get<double>();
                py = (*conn)["end"]["y"].get<double>();
            }
            (*conn)["glue"][which] = toId + ":" + std::to_string(NearestAnchor(*target, {px, py}));
        }
    }

    return {{"shapes", pageShapes}, {"layers", layers}};
}

}  // namespace

bool ParseVsdxBytes(const std::string& bytes, nlohmann::json& out, std::vector<std::string>& warnings,
                    std::string& err) {
    err.clear();
    warnings.clear();

    Package pkg;
    if (!Package::LoadFromBytes(bytes, pkg, err)) return false;

    // 主文档 part
    std::string docPart;
    for (const auto& r : pkg.Rels("")) {
        if (r.type.find("relationships/document") != std::string::npos) docPart = r.target;
    }
    if (docPart.empty() || !pkg.Has(docPart)) {
        // 兼容：直接 sniff visio/document.xml
        if (pkg.Has("visio/document.xml")) docPart = "visio/document.xml";
        else {
            err = "不是 Visio 文档（缺少 visio/document.xml）";
            return false;
        }
    }

    std::map<int, std::string> palette = ParsePalette(pkg.FindOr(docPart));

    // 样式表（真实 Visio 文件大量形状依赖 StyleSheet 的默认填充/线/字体）
    StyleMap styles;
    {
        XmlNode docRoot;
        std::string derr;
        if (ParseXml(pkg.FindOr(docPart), docRoot, derr)) styles = ParseStyleSheets(docRoot);
    }

    // 母版：页面形状通常只给 Pin/宽高，几何与样式来自 Master
    MasterMap masters;
    {
        std::string mastersPart;
        for (const auto& r : pkg.Rels(docPart)) {
            if (r.type.find("relationships/masters") != std::string::npos) mastersPart = r.target;
        }
        if (mastersPart.empty() && pkg.Has("visio/masters/masters.xml")) mastersPart = "visio/masters/masters.xml";
        if (!mastersPart.empty() && pkg.Has(mastersPart)) {
            XmlNode mastersRoot;
            std::string merr;
            if (ParseXml(pkg.FindOr(mastersPart), mastersRoot, merr)) {
                std::map<std::string, std::string> mrels;
                for (const auto& r : pkg.Rels(mastersPart)) mrels[r.id] = r.target;
                for (const XmlNode* m : mastersRoot.childrenNamed("Master")) {
                    int mid = static_cast<int>(P2D(m->attr("ID"), -1));
                    if (mid < 0) continue;
                    std::string target;
                    if (const XmlNode* rel = m->child("Rel")) {
                        std::string rid = rel->attr("r:id");
                        if (rid.empty()) rid = rel->attr("id");
                        if (mrels.count(rid)) target = mrels.at(rid);
                    }
                    if (target.empty() || !pkg.Has(target)) continue;
                    XmlNode mroot;
                    std::string mperr;
                    if (!ParseXml(pkg.FindOr(target), mroot, mperr)) continue;
                    const XmlNode* shapes = mroot.child("Shapes");
                    if (!shapes) continue;
                    for (const XmlNode* s : shapes->childrenNamed("Shape")) {
                        masters[mid] = *s;
                        break;
                    }
                }
            }
        }
    }

    // 页面列表 part
    std::string pagesPart;
    for (const auto& r : pkg.Rels(docPart)) {
        if (r.type.find("relationships/pages") != std::string::npos) pagesPart = r.target;
    }
    if (pagesPart.empty() || !pkg.Has(pagesPart)) {
        if (pkg.Has("visio/pages/pages.xml")) pagesPart = "visio/pages/pages.xml";
        else {
            err = "VSDX 缺少 pages.xml";
            return false;
        }
    }

    XmlNode pagesRoot;
    if (!ParseXml(pkg.FindOr(pagesPart), pagesRoot, err)) {
        err = "pages.xml 解析失败: " + err;
        return false;
    }

    std::map<std::string, std::string> relTargets;
    for (const auto& r : pkg.Rels(pagesPart)) {
        std::string shortId = r.id;
        relTargets[shortId] = r.target;
        relTargets["r:" + shortId] = r.target;
    }

    nlohmann::json pages = nlohmann::json::array();

    // 背景页（Background='1'）不作为独立页面导入
    std::vector<const XmlNode*> pageNodes;
    for (const XmlNode* p : pagesRoot.childrenNamed("Page")) {
        if (p->attr("Background") != "1") pageNodes.push_back(p);
    }
    if (pageNodes.empty()) {
        for (const XmlNode* p : pagesRoot.childrenNamed("Page")) pageNodes.push_back(p);
    }

    int pageIndex = 0;
    nlohmann::json globalVars = nlohmann::json::array();
    for (const XmlNode* pageNode : pageNodes) {
        ++pageIndex;
        std::string name = pageNode->attr("Name", "页面-" + std::to_string(pageIndex));
        std::string target;
        if (const XmlNode* rel = pageNode->child("Rel")) {
            std::string rid = rel->attr("r:id");
            if (rid.empty()) rid = rel->attr("id");
            if (relTargets.count(rid)) target = relTargets[rid];
        }
        if (target.empty() || !pkg.Has(target)) continue;

        XmlNode pageRoot;
        std::string perr;
        if (!ParseXml(pkg.FindOr(target), pageRoot, perr)) {
            warnings.push_back(name + " 页面解析失败: " + perr);
            continue;
        }

        double pw = 800, ph = 1100;
        ReadPageSize(*pageNode, pw, ph);   // 真实 Visio 文件只在 pages.xml 声明页面尺寸
        nlohmann::json pageVars = nlohmann::json::array();
        ReadPageUserVars(*pageNode, pageVars, globalVars);
        nlohmann::json parsed = ParsePage(pageRoot, name, pw, ph, palette, styles, masters, warnings);

        nlohmann::json page = {
            {"id", "p" + std::to_string(pages.size() + 1)},
            {"name", name},
            {"size", {{"mode", "fixed"}, {"w", pw}, {"h", ph}, {"orientation", pw > ph ? "landscape" : "portrait"}}},
            {"guides", nlohmann::json::array()},
            {"variables", pageVars},
            {"layers", parsed["layers"]},
            {"shapes", parsed["shapes"]},
        };
        pages.push_back(page);
    }

    if (pages.empty()) {
        err = "VSDX 中没有可读取的页面";
        return false;
    }

    out = {{"format", "visioxure"},
           {"version", 1},
           {"doc", {{"theme", "light"}, {"variables", globalVars}}},
           {"assets", nlohmann::json::array()},
           {"library", nlohmann::json::array()},
           {"pages", pages}};
    return true;
}

}  // namespace vsx
