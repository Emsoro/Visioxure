// writer.cpp —— 内部文档 JSON → VisioML（VSDX 最小合法包）
// 坐标约定：内部 px（96 DPI）、原点左上、Y 向下；Visio 英寸、原点左下、Y 向上。
#include "writer.hpp"

#include "package.hpp"
#include "xml.hpp"

#include "version.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <map>
#include <string>
#include <vector>

namespace vsx {

namespace {

constexpr double kPxPerInch = 96.0;
constexpr double kLead = 16.0;  // 连接线出线引导段（px）

struct Pt {
    double x = 0, y = 0;
};

std::string Num(double v) {
    if (std::fabs(v) < 5e-7) v = 0.0;
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.6f", v);
    std::string s(buf);
    while (s.size() > 1 && s.back() == '0') s.pop_back();
    if (!s.empty() && s.back() == '.') s.pop_back();
    if (s.empty() || s == "-0") s = "0";
    return s;
}

double JNum(const nlohmann::json& o, const char* key, double def) {
    auto it = o.find(key);
    if (it == o.end() || !it->is_number()) return def;
    return it->get<double>();
}

std::string JStr(const nlohmann::json& o, const char* key, const std::string& def = "") {
    auto it = o.find(key);
    if (it == o.end() || !it->is_string()) return def;
    return it->get<std::string>();
}

std::string Cell(const std::string& name, const std::string& value) {
    return "<Cell N=\"" + name + "\" V=\"" + XmlEscape(value) + "\"/>";
}

std::string CellF(const std::string& name, const std::string& value, const std::string& formula) {
    return "<Cell N=\"" + name + "\" V=\"" + XmlEscape(value) + "\" F=\"" + XmlEscape(formula) + "\"/>";
}

// 自定义数据行（User 段）：本应用元数据往返保真，Visio 视作用户定义单元格。
// Visio 只认公式 F，故除 V 外同时写 F：文本/JSON 用带引号的字符串公式（内部引号双写），
// 这样在 Visio 中另存后值不会被清成 0。公式里不能直接含换行，
// 因此多行文本按行拆成字符串再用 CHAR(10) 连接。
std::string QuotedFormula(const std::string& value) {
    std::string f = "\"";
    for (char ch : value) {
        if (ch == '"') f += "\"\"";
        else f.push_back(ch);
    }
    f.push_back('"');
    return f;
}

std::string StringFormula(const std::string& value) {
    if (value.find('\n') == std::string::npos && value.find('\r') == std::string::npos) {
        return QuotedFormula(value);
    }
    std::string f;
    size_t start = 0;
    while (true) {
        size_t nl = value.find('\n', start);
        std::string line = nl == std::string::npos ? value.substr(start) : value.substr(start, nl - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!f.empty()) f += "&CHAR(10)&";
        f += QuotedFormula(line);
        if (nl == std::string::npos) break;
        start = nl + 1;
    }
    return f;
}

std::string UserRow(const std::string& name, const std::string& value) {
    return "<Row N=\"" + name + "\">" + CellF("Value", value, StringFormula(value)) + Cell("Prompt", "") + "</Row>";
}

// 数值型自定义行：F 用裸数字，Visio 会保留其数值 V
std::string UserRowNum(const std::string& name, const std::string& value) {
    return "<Row N=\"" + name + "\">" + CellF("Value", value, value) + Cell("Prompt", "") + "</Row>";
}

// 内部箭头形状名 → Visio 箭头类型号（0=无，4=实心，1=开口，14=空心三角，10=圆点，22=菱形，9=竖线）
int ArrowTypeOfKind(const std::string& kind) {
    if (kind == "none") return 0;
    if (kind == "open") return 1;
    if (kind == "triangle") return 14;
    if (kind == "dot") return 10;
    if (kind == "diamond") return 22;
    if (kind == "square") return 11;
    if (kind == "bar") return 9;
    return 4;
}

// 箭头类型：优先用读入时保留的 Visio 类型号（保证往返一致），否则由 kind / 旧布尔值推导
int ArrowEndType(const nlohmann::json& st, const char* typeKey, const char* kindKey, const char* flagKey,
                 bool flagDefault) {
    auto t = st.find(typeKey);
    if (t != st.end() && t->is_number()) return std::max(0, std::min(45, static_cast<int>(t->get<double>())));
    std::string kind = JStr(st, kindKey);
    if (!kind.empty()) return ArrowTypeOfKind(kind);
    return st.value(flagKey, flagDefault) ? 4 : 0;
}

int ArrowSize(const nlohmann::json& st, const char* key) {
    auto it = st.find(key);
    if (it == st.end() || !it->is_number()) return 2;
    return std::max(0, std::min(6, static_cast<int>(it->get<double>())));
}

// ---------- 连接线端点/布线（routing.js 的 C++ 移植，保证与编辑器一致性） ----------

struct GlueRef {
    std::string id;
    int anchor = -1;
};

bool ParseGlue(const std::string& glue, GlueRef& out) {
    size_t idx = glue.find(':');
    if (idx == std::string::npos) return false;
    out.id = glue.substr(0, idx);
    out.anchor = std::atoi(glue.c_str() + idx + 1) & 3;
    return !out.id.empty();
}

Pt AnchorOf(const nlohmann::json& t, int n) {
    double x = JNum(t, "x", 0), y = JNum(t, "y", 0), w = JNum(t, "w", 0), h = JNum(t, "h", 0);
    double angle = JNum(t, "angle", 0);
    double cx = x + w / 2, cy = y + h / 2;
    Pt pts[4] = {{cx, y}, {x + w, cy}, {cx, y + h}, {x, cy}};
    Pt p = pts[n & 3];
    if (angle != 0) {
        double c = std::cos(angle), s = std::sin(angle);
        Pt r;
        r.x = cx + (p.x - cx) * c - (p.y - cy) * s;
        r.y = cy + (p.x - cx) * s + (p.y - cy) * c;
        return r;
    }
    return p;
}

Pt RotateNormal(Pt nv, double angle) {
    if (angle == 0) return nv;
    double c = std::cos(angle), s = std::sin(angle);
    return {nv.x * c - nv.y * s, nv.x * s + nv.y * c};
}

// 自由点（begin/end 对象）
Pt FreePoint(const nlohmann::json& sh, const char* key) {
    Pt p;
    auto it = sh.find(key);
    if (it != sh.end() && it->is_object()) {
        p.x = JNum(*it, "x", 0);
        p.y = JNum(*it, "y", 0);
    }
    return p;
}

// routing.js elbow() 移植
void Elbow(Pt a, Pt b, const Pt* na, const Pt* nb, std::vector<Pt>& pts) {
    double midx = (a.x + b.x) / 2, midy = (a.y + b.y) / 2;
    bool aH = na ? na->x != 0 : std::fabs(b.x - a.x) >= std::fabs(b.y - a.y);

    if (!na && !nb) {
        if (aH) pts.push_back({b.x, a.y});
        else pts.push_back({a.x, b.y});
        return;
    }
    if (aH) {
        double x2;
        if (!nb) {
            x2 = b.x;
        } else if (nb->x != 0) {
            bool faceToFace = (na->x > 0 && nb->x < 0) || (na->x < 0 && nb->x > 0);
            bool okDir = (na->x > 0 && b.x > a.x) || (na->x < 0 && b.x < a.x);
            x2 = (faceToFace && okDir) ? b.x : midx;
        } else {
            bool okDir = (na->x > 0 && b.x > a.x) || (na->x < 0 && b.x < a.x);
            x2 = okDir ? b.x : midx;
        }
        pts.push_back({x2, a.y});
        if (std::fabs(x2 - b.x) > 0.5) pts.push_back({x2, b.y});
    } else {
        double y2;
        if (!nb) {
            y2 = b.y;
        } else if (nb->y != 0) {
            bool faceToFace = (na->y > 0 && nb->y < 0) || (na->y < 0 && nb->y > 0);
            bool okDir = (na->y > 0 && b.y > a.y) || (na->y < 0 && b.y < a.y);
            y2 = (faceToFace && okDir) ? b.y : midy;
        } else {
            bool okDir = (na->y > 0 && b.y > a.y) || (na->y < 0 && b.y < a.y);
            y2 = okDir ? b.y : midy;
        }
        pts.push_back({a.x, y2});
        if (std::fabs(y2 - b.y) > 0.5) pts.push_back({b.x, y2});
    }
}

std::vector<Pt> ConnectorPoints(const nlohmann::json& sh,
                                const std::map<std::string, const nlohmann::json*>& byId) {
    auto resolve = [&](const char* which, Pt& p, Pt* nrm, bool& glued) {
        glued = false;
        auto it = sh.find("glue");
        if (it != sh.end() && it->is_object()) {
            GlueRef g;
            if (ParseGlue(JStr(*it, which), g)) {
                auto sit = byId.find(g.id);
                if (sit != byId.end() && sit->second) {
                    p = AnchorOf(*sit->second, g.anchor);
                    static const Pt kN[4] = {{0, -1}, {1, 0}, {0, 1}, {-1, 0}};
                    *nrm = RotateNormal(kN[g.anchor & 3], JNum(*sit->second, "angle", 0));
                    glued = true;
                    return;
                }
            }
        }
        p = FreePoint(sh, which);
    };

    Pt A, B, na{}, nb{};
    bool ga = false, gb = false;
    resolve("begin", A, &na, ga);
    resolve("end", B, &nb, gb);

    std::vector<Pt> pts;
    // 手动编辑过的折线：直接使用用户拖出的点（端点仍以粘附/自由点为准）
    if (JStr(sh, "route", "ortho") == "manual" && sh.contains("points") && sh["points"].is_array() &&
        sh["points"].size() >= 2) {
        for (const auto& p : sh["points"]) {
            if (!p.is_object()) continue;
            pts.push_back({JNum(p, "x", 0), JNum(p, "y", 0)});
        }
        if (pts.size() >= 2) {
            pts.front() = A;
            pts.back() = B;
            return pts;
        }
    }
    if (JStr(sh, "route", "ortho") == "straight") {
        pts = {A, B};
        return pts;
    }

    Pt a = A, b = B;
    if (ga) { a.x += na.x * kLead; a.y += na.y * kLead; }
    if (gb) { b.x += nb.x * kLead; b.y += nb.y * kLead; }

    pts.push_back(A);
    if (ga) pts.push_back(a);
    Elbow(a, b, ga ? &na : nullptr, gb ? &nb : nullptr, pts);
    if (gb) pts.push_back(b);
    pts.push_back(B);

    // 去重
    std::vector<Pt> out;
    for (const Pt& p : pts) {
        if (out.empty() || std::fabs(out.back().x - p.x) > 0.01 || std::fabs(out.back().y - p.y) > 0.01) {
            out.push_back(p);
        }
    }
    return out;
}

bool PointInPolygon(const std::vector<Pt>& ring, double x, double y) {
    bool inside = false;
    size_t n = ring.size();
    for (size_t i = 0, j = n ? n - 1 : 0; i < n; j = i++) {
        const Pt& a = ring[i];
        const Pt& b = ring[j];
        if ((a.y > y) != (b.y > y)) {
            double xi = (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
            if (x < xi) inside = !inside;
        }
    }
    return inside;
}

struct Item {
    const nlohmann::json* sh = nullptr;
    std::string groupChain;
};

void CollectShapes(const nlohmann::json& shapes, const std::string& chain, std::vector<Item>& out) {
    if (!shapes.is_array()) return;
    for (const auto& s : shapes) {
        if (!s.is_object()) continue;
        std::string type = JStr(s, "type");
        if (type == "group") {
            std::string id = JStr(s, "id");
            std::string ch = chain.empty() ? id : (chain + "|" + id);
            auto it = s.find("children");
            if (it != s.end()) CollectShapes(*it, ch, out);
        } else {
            out.push_back({&s, chain});
        }
    }
}

// 单个形状 → Visio Shape XML
std::string BuildShapeXml(const Item& item, double pageHIn,
                          const std::map<std::string, const nlohmann::json*>& byId,
                          const std::map<std::string, int>& layerIndex, int numericId) {
    const nlohmann::json& s = *item.sh;
    std::string type = JStr(s, "type", "rect");
    std::string internalId = JStr(s, "id", "s" + std::to_string(numericId));

    nlohmann::json st = s.value("style", nlohmann::json::object());
    if (!st.is_object()) st = nlohmann::json::object();
    nlohmann::json font = st.value("font", nlohmann::json::object());
    if (!font.is_object()) font = nlohmann::json::object();

    double opacity = JNum(st, "opacity", 1.0);
    std::string fill = JStr(st, "fill", "#FFFFFF");
    std::string line = JStr(st, "line", "#000000");
    double lineWidth = JNum(st, "lineWidth", 1.0);
    bool hasFill = !fill.empty() && fill != "transparent" && opacity > 0.001;
    bool hasLine = !line.empty() && line != "transparent" && lineWidth > 0.001;

    std::string x, y, w, h;  // 英寸
    std::string geometry;
    bool hasConnEnds = false;
    double connBeginX = 0, connBeginY = 0, connEndX = 0, connEndY = 0;  // 世界 px

    if (type == "connector") {
        std::vector<Pt> pts = ConnectorPoints(s, byId);
        if (pts.size() < 2) pts = {{0, 0}, {0, 0}};
        connBeginX = pts.front().x;
        connBeginY = pts.front().y;
        connEndX = pts.back().x;
        connEndY = pts.back().y;
        hasConnEnds = true;
        double minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
        for (const Pt& p : pts) {
            minX = std::min(minX, p.x); maxX = std::max(maxX, p.x);
            minY = std::min(minY, p.y); maxY = std::max(maxY, p.y);
        }
        double wIn = std::max(0.001, (maxX - minX) / kPxPerInch);
        double hIn = std::max(0.001, (maxY - minY) / kPxPerInch);
        x = Num(((minX + maxX) / 2) / kPxPerInch);
        y = Num(pageHIn - ((minY + maxY) / 2) / kPxPerInch);
        w = Num(wIn);
        h = Num(hIn);

        geometry = "<Section N=\"Geometry\" IX=\"0\">" + Cell("NoFill", "1") + Cell("NoLine", "0");
        int row = 1;
        for (size_t i = 0; i < pts.size(); ++i) {
            double lx = (pts[i].x - minX) / kPxPerInch;
            double ly = (maxY - pts[i].y) / kPxPerInch;
            geometry += "<Row T=\"" + std::string(i ? "LineTo" : "MoveTo") + "\" IX=\"" + std::to_string(row++) +
                        "\">" + Cell("X", Num(lx)) + Cell("Y", Num(ly)) + "</Row>";
        }
        geometry += "</Section>";
    } else {
        double px = JNum(s, "x", 0), py = JNum(s, "y", 0);
        double pw = std::max(0.01, JNum(s, "w", 0)), ph = std::max(0.01, JNum(s, "h", 0));
        w = Num(pw / kPxPerInch);
        h = Num(ph / kPxPerInch);
        x = Num((px + pw / 2) / kPxPerInch);
        y = Num(pageHIn - (py + ph / 2) / kPxPerInch);

        double wIn = pw / kPxPerInch, hIn = ph / kPxPerInch;

        if (type == "ellipse") {
            geometry = "<Section N=\"Geometry\" IX=\"0\">" + Cell("NoFill", "0") + Cell("NoLine", "0") +
                       "<Row T=\"Ellipse\" IX=\"1\">" +
                       CellF("X", Num(wIn / 2), "Width*0.5") +
                       CellF("Y", Num(hIn / 2), "Height*0.5") +
                       CellF("A", Num(wIn / 2), "Width*0.5") +
                       CellF("B", Num(hIn / 2), "Height*0.5") +
                       Cell("C", "0") + Cell("D", "0") + "</Row></Section>";
        } else if (type == "path") {
            std::vector<std::vector<Pt>> rings;  // Visio 局部坐标（左下原点）
            std::vector<bool> ringClosed;        // 与 rings 同序：false = 开放折线，不补回原点的闭合行
            auto pathIt = s.find("path");
            if (pathIt != s.end() && pathIt->is_object()) {
                auto subIt = pathIt->find("subpaths");
                auto clIt = pathIt->find("closed");
                const nlohmann::json* closedArr =
                    (clIt != pathIt->end() && clIt->is_array()) ? &*clIt : nullptr;
                if (subIt != pathIt->end() && subIt->is_array()) {
                    size_t si = 0;
                    for (const auto& ring : *subIt) {
                        if (!ring.is_array() || ring.size() < 2) { ++si; continue; }
                        std::vector<Pt> pts;
                        for (const auto& p : ring) {
                            if (!p.is_object()) continue;
                            Pt q;
                            q.x = (JNum(p, "x", 0) + pw / 2) / kPxPerInch;
                            q.y = (ph / 2 - JNum(p, "y", 0)) / kPxPerInch;
                            pts.push_back(q);
                        }
                        if (pts.size() >= 2) {
                            bool cl = true;   // 缺字段按闭合处理（旧文件兼容）
                            if (closedArr && si < closedArr->size()) {
                                const nlohmann::json& cj = (*closedArr)[si];
                                cl = !cj.is_boolean() || cj.get<bool>();
                            }
                            rings.push_back(std::move(pts));
                            ringClosed.push_back(cl);
                        }
                        ++si;
                    }
                }
            }
            int ix = 0;
            for (size_t ri = 0; ri < rings.size(); ++ri) {
                bool hole = false;
                if (rings.size() > 1) {
                    int inside = 0;
                    for (size_t rj = 0; rj < rings.size(); ++rj) {
                        if (ri == rj) continue;
                        if (PointInPolygon(rings[rj], rings[ri][0].x, rings[ri][0].y)) ++inside;
                    }
                    hole = (inside % 2) == 1;
                }
                geometry += "<Section N=\"Geometry\" IX=\"" + std::to_string(ix++) + "\">" +
                            Cell("NoFill", hole ? "1" : "0") + Cell("NoLine", "0");
                int row = 1;
                geometry += "<Row T=\"MoveTo\" IX=\"" + std::to_string(row++) + "\">" +
                            Cell("X", Num(rings[ri][0].x)) + Cell("Y", Num(rings[ri][0].y)) + "</Row>";
                for (size_t k = 1; k < rings[ri].size(); ++k) {
                    geometry += "<Row T=\"LineTo\" IX=\"" + std::to_string(row++) + "\">" +
                                Cell("X", Num(rings[ri][k].x)) + Cell("Y", Num(rings[ri][k].y)) + "</Row>";
                }
                // 闭合环补一行回到起点；开放折线（path.closed=false）不能补，
                // 否则 Visio 里会多出一条从终点回到起点的斜线
                const bool closeRing = ri < ringClosed.size() ? ringClosed[ri] : true;
                if (closeRing) {
                    geometry += "<Row T=\"LineTo\" IX=\"" + std::to_string(row++) + "\">" +
                                Cell("X", Num(rings[ri][0].x)) + Cell("Y", Num(rings[ri][0].y)) + "</Row>";
                }
                geometry += "</Section>";
            }
            if (geometry.empty()) {
                // 退化：空 path 画成矩形框
                geometry = "<Section N=\"Geometry\" IX=\"0\">" + Cell("NoFill", "1") + Cell("NoLine", "0") +
                           "<Row T=\"MoveTo\" IX=\"1\">" + Cell("X", "0") + Cell("Y", "0") + "</Row>" +
                           "<Row T=\"LineTo\" IX=\"2\">" + Cell("X", w) + Cell("Y", "0") + "</Row>" +
                           "<Row T=\"LineTo\" IX=\"3\">" + Cell("X", w) + Cell("Y", h) + "</Row>" +
                           "<Row T=\"LineTo\" IX=\"4\">" + Cell("X", "0") + Cell("Y", h) + "</Row>" +
                           "<Row T=\"LineTo\" IX=\"5\">" + Cell("X", "0") + Cell("Y", "0") + "</Row></Section>";
            }
        } else {
            // rect / text / 其它：矩形几何；text 无填充无边框
            bool plainText = (type == "text");
            geometry = "<Section N=\"Geometry\" IX=\"0\">" +
                       Cell("NoFill", plainText || !hasFill ? "1" : "0") +
                       Cell("NoLine", plainText || !hasLine ? "1" : "0") +
                       "<Row T=\"MoveTo\" IX=\"1\">" + Cell("X", "0") + Cell("Y", "0") + "</Row>" +
                       "<Row T=\"LineTo\" IX=\"2\">" + Cell("X", w) + Cell("Y", "0") + "</Row>" +
                       "<Row T=\"LineTo\" IX=\"3\">" + Cell("X", w) + Cell("Y", h) + "</Row>" +
                       "<Row T=\"LineTo\" IX=\"4\">" + Cell("X", "0") + Cell("Y", h) + "</Row>" +
                       "<Row T=\"LineTo\" IX=\"5\">" + Cell("X", "0") + Cell("Y", "0") + "</Row></Section>";
        }
    }

    std::string out = "<Shape ID=\"" + std::to_string(numericId) + "\" NameU=\"" + XmlEscape(internalId) +
                      "\" Name=\"" + XmlEscape(internalId) +
                      "\" Type=\"Shape\" LineStyle=\"0\" FillStyle=\"0\" TextStyle=\"0\">";
    out += Cell("PinX", x) + Cell("PinY", y);
    out += Cell("Width", w) + Cell("Height", h);
    out += CellF("LocPinX", Num(std::atof(w.c_str()) / 2), "Width*0.5");
    out += CellF("LocPinY", Num(std::atof(h.c_str()) / 2), "Height*0.5");
    out += Cell("Angle", Num(-JNum(s, "angle", 0)));
    out += Cell("FlipX", "0") + Cell("FlipY", "0");
    out += Cell("ResizeMode", "0");

    // 图层归属：Visio 用 LayerMember 记图层序号，与 layers 数组下标一致
    auto layerIt = layerIndex.find(JStr(s, "layer"));
    if (layerIt != layerIndex.end()) out += Cell("LayerMember", std::to_string(layerIt->second));

    if (hasFill) {
        out += Cell("FillPattern", "1") + Cell("FillForegnd", fill) + Cell("FillBkgnd", "#FFFFFF");
        if (opacity < 0.999) out += Cell("FillForegndTrans", Num(1.0 - opacity));
    } else {
        out += Cell("FillPattern", "0");
    }
    // 线型：dash → Visio LinePattern 序号。优先用读取时保留的原始序号，保证往返一致
    int linePattern = 1;
    {
        std::string dash = JStr(st, "dash");
        if (!dash.empty()) {
            linePattern = st.value("linePattern", 0);
            if (linePattern < 2)
                linePattern = dash == "dot" ? 3 : (dash == "dashDot" ? 4 : (dash == "dashDotDot" ? 5 : 2));
        }
    }
    if (hasLine) {
        out += Cell("LinePattern", std::to_string(linePattern)) + Cell("LineColor", line) +
               Cell("LineWeight", Num(lineWidth / kPxPerInch));
        if (opacity < 0.999) out += Cell("LineColorTrans", Num(1.0 - opacity));
    } else {
        out += Cell("LinePattern", "0");
    }

    double corner = JNum(st, "cornerRadius", 0);
    if (corner > 0.01 && type != "connector" && type != "path" && type != "ellipse") {
        out += Cell("Rounding", Num(corner / kPxPerInch));
    }

    if (type == "connector") {
        int endType = ArrowEndType(st, "arrowEndType", "arrowEndKind", "arrowEnd", true);
        int beginType = ArrowEndType(st, "arrowBeginType", "arrowBeginKind", "arrowBegin", false);
        out += Cell("BeginArrow", std::to_string(beginType));
        out += Cell("EndArrow", std::to_string(endType));
        int endSize = ArrowSize(st, "arrowEndSize");
        int beginSize = ArrowSize(st, "arrowBeginSize");
        if (endSize != 2) out += Cell("EndArrowSize", std::to_string(endSize));
        if (beginSize != 2) out += Cell("BeginArrowSize", std::to_string(beginSize));
    }

    std::string text = JStr(s, "text");
    if (!text.empty() && type != "connector") {
        std::string valign = JStr(font, "vAlign", "middle");
        out += Cell("VerticalAlign", valign == "top" ? "0" : (valign == "bottom" ? "2" : "1"));
    }

    out += geometry;

    if (!text.empty() && type != "connector") {
        std::string family = JStr(font, "family", "Segoe UI");
        double sizePx = JNum(font, "size", 14);
        std::string color = JStr(font, "color", "#333333");
        bool bold = font.value("bold", false);
        int styleFlag = bold ? 1 : 0;
        // JSON 中字号是 CSS px（96 DPI），Visio 的 Size 单位是英寸
        out += "<Section N=\"Character\" IX=\"0\"><Row IX=\"0\">" +
               Cell("Font", family) + Cell("Size", Num(sizePx / kPxPerInch)) +
               Cell("Color", color) + Cell("Style", std::to_string(styleFlag)) + "</Row></Section>";

        std::string align = JStr(font, "align", "center");
        int horz = align == "left" ? 0 : (align == "right" ? 2 : 1);
        out += "<Section N=\"Paragraph\" IX=\"0\"><Row IX=\"0\">" +
               Cell("HorzAlign", std::to_string(horz)) + "</Row></Section>";
    }

    // 自定义数据：形状 id / 组合归属 / 类型 / 连接线粘附 / 交互 / 动态面板（P4）
    std::string user;
    // id 原样落盘：交互 / 面板目标都用字符串引用它，读回时必须完全一致
    user += UserRow("VXId", internalId);
    if (!item.groupChain.empty()) {
        user += UserRow("VXGroup", item.groupChain);
    }
    if (type == "panel") {
        user += UserRow("VXType", "panel");
        auto panelIt = s.find("panel");
        if (panelIt != s.end() && panelIt->is_object()) {
            user += UserRow("VXPanel", panelIt->dump());
        }
    }
    if (s.contains("interactions") && s["interactions"].is_array() && !s["interactions"].empty()) {
        user += UserRow("VXInteractions", s["interactions"].dump());
    }
    // P5 元数据：注释 / 链接 / 脚本
    auto metaIt = s.find("meta");
    if (metaIt != s.end() && metaIt->is_object()) {
        std::string notes = JStr(*metaIt, "notes");
        if (!notes.empty()) user += UserRow("VXNotes", notes);
        auto linksIt = metaIt->find("links");
        if (linksIt != metaIt->end() && linksIt->is_array() && !linksIt->empty()) {
            user += UserRow("VXLinks", linksIt->dump());
        }
        auto scriptsIt = metaIt->find("scripts");
        if (scriptsIt != metaIt->end() && scriptsIt->is_array() && !scriptsIt->empty()) {
            user += UserRow("VXScripts", scriptsIt->dump());
        }
    }
    if (type == "connector") {
        user += UserRow("VXType", "connector");
        auto glueIt = s.find("glue");
        if (glueIt != s.end() && glueIt->is_object()) {
            std::string gb = JStr(*glueIt, "begin");
            std::string ge = JStr(*glueIt, "end");
            if (!gb.empty()) user += UserRow("VXGlueBegin", gb);
            if (!ge.empty()) user += UserRow("VXGlueEnd", ge);
        }
        user += UserRow("VXRoute", JStr(s, "route", "ortho"));
        if (hasConnEnds) {
            user += UserRowNum("VXBeginX", Num(connBeginX / kPxPerInch));
            user += UserRowNum("VXBeginY", Num(pageHIn - connBeginY / kPxPerInch));
            user += UserRowNum("VXEndX", Num(connEndX / kPxPerInch));
            user += UserRowNum("VXEndY", Num(pageHIn - connEndY / kPxPerInch));
        }
    }
    if (!user.empty()) out += "<Section N=\"User\">" + user + "</Section>";

    if (!text.empty() && type != "connector") {
        out += "<Text>" + XmlEscape(text) + "</Text>";
    }

    out += "</Shape>";
    return out;
}

std::string WritePageXml(const nlohmann::json& page, std::string& err) {
    double pageW = JNum(page.value("size", nlohmann::json::object()), "w", 800);
    double pageH = JNum(page.value("size", nlohmann::json::object()), "h", 1100);
    double pageWIn = pageW / kPxPerInch;
    double pageHIn = pageH / kPxPerInch;

    std::vector<Item> items;
    auto shapesIt = page.find("shapes");
    if (shapesIt != page.end()) CollectShapes(*shapesIt, "", items);

    std::map<std::string, const nlohmann::json*> byId;
    for (const Item& it : items) byId[JStr(*it.sh, "id")] = it.sh;

    // 图层序号：layers 数组下标即 Visio 的图层号
    std::map<std::string, int> layerIndex;
    {
        auto it = page.find("layers");
        if (it != page.end() && it->is_array()) {
            int pos = 0;
            for (const auto& l : *it) {
                if (!l.is_object()) continue;
                layerIndex[JStr(l, "id")] = pos++;
            }
        }
    }

    std::string xml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<PageContents xmlns=\"http://schemas.microsoft.com/office/visio/2012/main\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xml:space=\"preserve\">";

    xml += "<Shapes>";
    int numeric = 1;
    for (const Item& it : items) {
        xml += BuildShapeXml(it, pageHIn, byId, layerIndex, numeric++);
    }
    xml += "</Shapes>";

    // 图层
    auto layersIt = page.find("layers");
    if (layersIt != page.end() && layersIt->is_array() && !layersIt->empty()) {
        xml += "<Layers>";
        int lidx = 0;
        for (const auto& l : *layersIt) {
            if (!l.is_object()) continue;
            std::string name = JStr(l, "name", "图层-" + std::to_string(lidx + 1));
            xml += "<Layer ID=\"" + std::to_string(lidx) + "\" Name=\"" + XmlEscape(name) + "\" NameU=\"" +
                   XmlEscape(name) + "\">";
            xml += Cell("Visible", l.value("visible", true) ? "1" : "0");
            xml += Cell("Print", "1") + Cell("Active", "0") +
                   Cell("Lock", l.value("locked", false) ? "1" : "0") +
                   Cell("Snap", "1") + Cell("Glue", "1") + Cell("Color", "0");
            xml += "</Layer>";
            ++lidx;
        }
        xml += "</Layers>";
    }

    xml += "</PageContents>";
    (void)err;
    return xml;
}

std::string CoreXml(const std::string& title) {
    std::time_t now = std::time(nullptr);
    std::tm tmv{};
    gmtime_s(&tmv, &now);
    char ts[32];
    std::snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02dZ", tmv.tm_year + 1900, tmv.tm_mon + 1,
                  tmv.tm_mday, tmv.tm_hour, tmv.tm_min, tmv.tm_sec);
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
           "<cp:coreProperties "
           "xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
           "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
           "xmlns:dcterms=\"http://purl.org/dc/terms/\" "
           "xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" "
           "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"
           "<dc:title>" + XmlEscape(title) + "</dc:title>"
           "<dc:creator>Visioxure</dc:creator>"
           "<cp:lastModifiedBy>Visioxure</cp:lastModifiedBy>"
           "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + std::string(ts) + "</dcterms:created>"
           "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + std::string(ts) + "</dcterms:modified>"
           "</cp:coreProperties>";
}

}  // namespace

std::string BuildVsdxBytes(const nlohmann::json& doc, std::string& err) {
    err.clear();
    auto pagesIt = doc.find("pages");
    if (pagesIt == doc.end() || !pagesIt->is_array() || pagesIt->empty()) {
        err = "文档没有页面";
        return {};
    }

    Package pkg;

    std::string contentTypes =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        "<Default Extension=\"rels\" "
        "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        "<Override PartName=\"/docProps/core.xml\" "
        "ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>"
        "<Override PartName=\"/docProps/app.xml\" "
        "ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
        "<Override PartName=\"/visio/document.xml\" "
        "ContentType=\"application/vnd.ms-visio.drawing.main+xml\"/>"
        "<Override PartName=\"/visio/pages/pages.xml\" ContentType=\"application/vnd.ms-visio.pages+xml\"/>"
        "<Override PartName=\"/visio/windows.xml\" ContentType=\"application/vnd.ms-visio.windows+xml\"/>";

    std::string rootRels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rId1\" "
        "Type=\"http://schemas.microsoft.com/visio/2010/relationships/document\" "
        "Target=\"visio/document.xml\"/>"
        "<Relationship Id=\"rId2\" "
        "Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" "
        "Target=\"docProps/core.xml\"/>"
        "<Relationship Id=\"rId3\" "
        "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" "
        "Target=\"docProps/app.xml\"/>"
        "</Relationships>";

    std::string documentXml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<VisioDocument xmlns=\"http://schemas.microsoft.com/office/visio/2012/main\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xml:space=\"preserve\">"
        "<DocumentSettings TopPage=\"0\" DefaultTextStyle=\"0\" DefaultLineStyle=\"0\" "
        "DefaultFillStyle=\"0\" DefaultGuideStyle=\"0\">"
        "<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings>"
        "<SnapExtensions>34</SnapExtensions>"
        "</DocumentSettings>"
        "<StyleSheets>"
        "<StyleSheet ID=\"0\" NameU=\"No Style\" IsCustomNameU=\"1\" Name=\"No Style\" IsCustomName=\"1\">"
        "<Cell N=\"EnableLineProps\" V=\"1\"/><Cell N=\"EnableFillProps\" V=\"1\"/>"
        "<Cell N=\"EnableTextProps\" V=\"1\"/><Cell N=\"HideForApply\" V=\"0\"/>"
        "<Cell N=\"LineWeight\" V=\"0.01041666666666667\"/><Cell N=\"LineColor\" V=\"#000000\"/>"
        "<Cell N=\"LinePattern\" V=\"1\"/><Cell N=\"Rounding\" V=\"0\"/>"
        "<Cell N=\"FillForegnd\" V=\"#FFFFFF\"/><Cell N=\"FillBkgnd\" V=\"#FFFFFF\"/>"
        "<Cell N=\"FillPattern\" V=\"1\"/><Cell N=\"ShdwPattern\" V=\"0\"/>"
        "<Cell N=\"TextBkgnd\" V=\"0\"/><Cell N=\"VerticalAlign\" V=\"1\"/>"
        "</StyleSheet>"
        "</StyleSheets>"
        "</VisioDocument>";

    std::string documentRels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rId1\" Type=\"http://schemas.microsoft.com/visio/2010/relationships/pages\" "
        "Target=\"pages/pages.xml\"/>"
        "<Relationship Id=\"rId2\" Type=\"http://schemas.microsoft.com/visio/2010/relationships/windows\" "
        "Target=\"windows.xml\"/>"
        "</Relationships>";

    std::string windowsXml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<Windows ClientWidth=\"1920\" ClientHeight=\"900\" "
        "xmlns=\"http://schemas.microsoft.com/office/visio/2012/main\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xml:space=\"preserve\">"
        "<Window ID=\"0\" WindowType=\"Drawing\" WindowState=\"1073741824\" ContainerType=\"Page\" Page=\"0\" "
        "ViewScale=\"-1\" ViewCenterX=\"4\" ViewCenterY=\"5.5\">"
        "<ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowPageBreaks>1</ShowPageBreaks>"
        "<ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints>"
        "<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions>"
        "<SnapAngles/><DynamicGridEnabled>1</DynamicGridEnabled><TabSplitterPos>0.5</TabSplitterPos>"
        "</Window></Windows>";

    std::string pagesXml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<Pages xmlns=\"http://schemas.microsoft.com/office/visio/2012/main\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xml:space=\"preserve\">";

    std::string pagesRels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">";

    int index = 0;
    for (const auto& page : *pagesIt) {
        if (!page.is_object()) continue;
        ++index;
        std::string name = JStr(page, "name", "页面-" + std::to_string(index));
        nlohmann::json sizeObj = page.value("size", nlohmann::json::object());
        double pageWIn = JNum(sizeObj, "w", 800) / kPxPerInch;
        double pageHIn = JNum(sizeObj, "h", 1100) / kPxPerInch;

        std::string partName = "visio/pages/page" + std::to_string(index) + ".xml";
        std::string errLocal;
        std::string pageXml = WritePageXml(page, errLocal);
        pkg.Add(partName, pageXml);
        contentTypes += "<Override PartName=\"/" + partName + "\" ContentType=\"application/vnd.ms-visio.page+xml\"/>";

        pagesXml += "<Page ID=\"" + std::to_string(index - 1) + "\" Name=\"" + XmlEscape(name) +
                    "\" NameU=\"" + XmlEscape(name) + "-" + std::to_string(index) +
                    "\" ViewScale=\"-1\" ViewCenterX=\"" + Num(pageWIn / 2) + "\" ViewCenterY=\"" +
                    Num(pageHIn / 2) + "\">";
        pagesXml += "<PageSheet LineStyle=\"0\" FillStyle=\"0\" TextStyle=\"0\">";
        pagesXml += Cell("PageWidth", Num(pageWIn));
        pagesXml += Cell("PageHeight", Num(pageHIn));
        pagesXml += Cell("PageScale", "1") + Cell("DrawingScale", "1");
        pagesXml += Cell("DrawingSizeType", "3") + Cell("DrawingScaleType", "0");
        std::string orientation = JStr(sizeObj, "orientation", "portrait");
        pagesXml += Cell("PrintPageOrientation", orientation == "landscape" ? "2" : "1");
        pagesXml += Cell("PageLockReplace", "0") + Cell("PageLockDuplicate", "0");
        // 页面背景色：Visio 的页面背景就是 PageSheet 的填充色
        pagesXml += Cell("FillForegnd", JStr(page, "background", "#FFFFFF"));
        pagesXml += Cell("FillPattern", "1");

        // 页面/全局变量（P4）：写入 PageSheet 的 User 段，本应用往返保真
        std::string userRows;
        if (page.contains("variables") && page["variables"].is_array() && !page["variables"].empty()) {
            userRows += UserRow("VXVars", page["variables"].dump());
        }
        if (index == 1) {
            auto docIt = doc.find("doc");
            if (docIt != doc.end() && docIt->is_object()) {
                auto varsIt = docIt->find("variables");
                if (varsIt != docIt->end() && varsIt->is_array() && !varsIt->empty()) {
                    userRows += UserRow("VXGlobalVars", varsIt->dump());
                }
            }
        }
        if (!userRows.empty()) pagesXml += "<Section N=\"User\">" + userRows + "</Section>";
        pagesXml += "</PageSheet>";
        pagesXml += "<Rel r:id=\"rId" + std::to_string(index) + "\"/>";
        pagesXml += "</Page>";

        pagesRels += "<Relationship Id=\"rId" + std::to_string(index) +
                     "\" Type=\"http://schemas.microsoft.com/visio/2010/relationships/page\" "
                     "Target=\"page" + std::to_string(index) + ".xml\"/>";
    }
    pagesXml += "</Pages>";
    pagesRels += "</Relationships>";

    if (index == 0) {
        err = "文档没有可用页面";
        return {};
    }

    contentTypes += "</Types>";

    pkg.Add("[Content_Types].xml", contentTypes);
    pkg.Add("_rels/.rels", rootRels);
    pkg.Add("visio/document.xml", documentXml);
    pkg.Add("visio/_rels/document.xml.rels", documentRels);
    pkg.Add("visio/windows.xml", windowsXml);
    pkg.Add("visio/pages/pages.xml", pagesXml);
    pkg.Add("visio/pages/_rels/pages.xml.rels", pagesRels);
    pkg.Add("docProps/core.xml", CoreXml(JStr(doc, "title", "Visioxure 文档")));
    pkg.Add("docProps/app.xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
            "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" "
            "xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">"
            "<Application>Visioxure</Application><AppVersion>" + std::string(visioxure::kVersion) +
                "</AppVersion></Properties>");

    std::string bytes = pkg.ToBytes();
    if (bytes.empty()) err = "打包 zip 失败";
    return bytes;
}

}  // namespace vsx
