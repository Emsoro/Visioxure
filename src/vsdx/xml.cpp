// xml.cpp —— 极简 XML DOM 解析（支持声明/注释/CDATA/实体/自闭合标签）
#include "xml.hpp"

#include <cctype>
#include <cstdio>

namespace vsx {

bool XmlNode::has(const std::string& name) const {
    for (const auto& a : attrs) {
        if (a.first == name) return true;
    }
    return false;
}

std::string XmlNode::attr(const std::string& name, const std::string& def) const {
    for (const auto& a : attrs) {
        if (a.first == name) return a.second;
    }
    return def;
}

const XmlNode* XmlNode::child(const std::string& name) const {
    for (const auto& c : children) {
        if (c.tag == name) return &c;
    }
    return nullptr;
}

std::vector<const XmlNode*> XmlNode::childrenNamed(const std::string& name) const {
    std::vector<const XmlNode*> out;
    for (const auto& c : children) {
        if (c.tag == name) out.push_back(&c);
    }
    return out;
}

std::string XmlNode::allText() const {
    std::string out = text;
    for (const auto& c : children) out += c.allText();
    return out;
}

std::string XmlEscape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 16);
    for (char ch : value) {
        switch (ch) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            case '\'': out += "&apos;"; break;
            default: out += ch;
        }
    }
    return out;
}

namespace {

struct Parser {
    const std::string& s;
    size_t i = 0;
    std::string err;

    explicit Parser(const std::string& src) : s(src) {}

    bool eof() const { return i >= s.size(); }
    char cur() const { return s[i]; }

    void skipSpace() {
        while (!eof() && (cur() == ' ' || cur() == '\t' || cur() == '\r' || cur() == '\n')) ++i;
    }

    bool fail(const std::string& msg) {
        if (err.empty()) {
            char buf[160];
            std::snprintf(buf, sizeof(buf), "%s (offset %zu)", msg.c_str(), i);
            err = buf;
        }
        return false;
    }

    bool startsWith(const char* lit) const {
        size_t n = std::char_traits<char>::length(lit);
        return s.compare(i, n, lit) == 0;
    }

    bool skipMisc() {
        for (;;) {
            skipSpace();
            if (eof()) return true;
            if (startsWith("<?")) {  // 声明/处理指令
                size_t end = s.find("?>", i);
                if (end == std::string::npos) return fail("未闭合的处理指令");
                i = end + 2;
                continue;
            }
            if (startsWith("<!--")) {
                size_t end = s.find("-->", i);
                if (end == std::string::npos) return fail("未闭合的注释");
                i = end + 3;
                continue;
            }
            if (startsWith("<!")) {  // DOCTYPE 等
                size_t end = s.find('>', i);
                if (end == std::string::npos) return fail("未闭合的 <! 声明");
                i = end + 1;
                continue;
            }
            return true;
        }
    }

    static std::string DecodeEntities(const std::string& in) {
        std::string out;
        out.reserve(in.size());
        for (size_t k = 0; k < in.size(); ++k) {
            if (in[k] != '&') {
                out += in[k];
                continue;
            }
            size_t semi = in.find(';', k);
            if (semi == std::string::npos || semi - k > 12) {  // 非实体，原样输出
                out += in[k];
                continue;
            }
            std::string ent = in.substr(k + 1, semi - k - 1);
            if (ent == "amp") out += '&';
            else if (ent == "lt") out += '<';
            else if (ent == "gt") out += '>';
            else if (ent == "quot") out += '"';
            else if (ent == "apos") out += '\'';
            else if (!ent.empty() && ent[0] == '#') {
                long code = 0;
                bool ok = true;
                if (ent.size() > 1 && (ent[1] == 'x' || ent[1] == 'X')) {
                    for (size_t q = 2; q < ent.size(); ++q) {
                        char c = ent[q];
                        if (c >= '0' && c <= '9') code = code * 16 + (c - '0');
                        else if (c >= 'a' && c <= 'f') code = code * 16 + (c - 'a' + 10);
                        else if (c >= 'A' && c <= 'F') code = code * 16 + (c - 'A' + 10);
                        else { ok = false; break; }
                    }
                } else {
                    for (size_t q = 1; q < ent.size(); ++q) {
                        char c = ent[q];
                        if (c < '0' || c > '9') { ok = false; break; }
                        code = code * 10 + (c - '0');
                    }
                }
                if (!ok || code <= 0 || code > 0x10FFFF) {
                    out += in.substr(k, semi - k + 1);
                    k = semi;
                    continue;
                }
                // 编码为 UTF-8
                if (code < 0x80) out += static_cast<char>(code);
                else if (code < 0x800) {
                    out += static_cast<char>(0xC0 | (code >> 6));
                    out += static_cast<char>(0x80 | (code & 0x3F));
                } else if (code < 0x10000) {
                    out += static_cast<char>(0xE0 | (code >> 12));
                    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                    out += static_cast<char>(0x80 | (code & 0x3F));
                } else {
                    out += static_cast<char>(0xF0 | (code >> 18));
                    out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
                    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                    out += static_cast<char>(0x80 | (code & 0x3F));
                }
            } else {
                out += in.substr(k, semi - k + 1);
            }
            k = semi;
        }
        return out;
    }

    bool ParseName(std::string& out) {
        size_t start = i;
        while (!eof()) {
            char c = cur();
            if (std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '-' || c == '.' || c == ':') ++i;
            else break;
        }
        if (i == start) return fail("缺少标签名");
        out = s.substr(start, i - start);
        return true;
    }

    bool ParseElement(XmlNode& node, int depth) {
        if (depth > 200) return fail("XML 嵌套过深");
        if (!skipMisc()) return false;
        if (eof() || cur() != '<') return fail("缺少元素起始");
        ++i;
        if (!ParseName(node.tag)) return false;

        // 属性
        for (;;) {
            skipSpace();
            if (eof()) return fail("标签未闭合");
            if (cur() == '>') { ++i; break; }
            if (cur() == '/') {
                if (i + 1 < s.size() && s[i + 1] == '>') { i += 2; return true; }
                return fail("非法自闭合标签");
            }
            std::string name;
            if (!ParseName(name)) return false;
            skipSpace();
            if (eof() || cur() != '=') return fail("属性缺少 =");
            ++i;
            skipSpace();
            if (eof() || (cur() != '"' && cur() != '\'')) return fail("属性值缺少引号");
            char quote = cur();
            ++i;
            size_t start = i;
            while (!eof() && cur() != quote) ++i;
            if (eof()) return fail("属性值未闭合");
            std::string raw = s.substr(start, i - start);
            ++i;
            node.attrs.emplace_back(name, DecodeEntities(raw));
        }

        // 子节点 / 文本
        std::string text;
        for (;;) {
            if (eof()) return fail("元素未闭合");
            if (cur() == '<') {
                if (startsWith("</")) {
                    i += 2;
                    std::string closeName;
                    if (!ParseName(closeName)) return false;
                    if (closeName != node.tag) return fail("结束标签不匹配: " + closeName);
                    skipSpace();
                    if (eof() || cur() != '>') return fail("结束标签未闭合");
                    ++i;
                    node.text = DecodeEntities(text);
                    return true;
                }
                if (startsWith("<!--")) {
                    size_t end = s.find("-->", i);
                    if (end == std::string::npos) return fail("未闭合的注释");
                    i = end + 3;
                    continue;
                }
                if (startsWith("<![CDATA[")) {
                    size_t end = s.find("]]>", i);
                    if (end == std::string::npos) return fail("未闭合的 CDATA");
                    text += s.substr(i + 9, end - i - 9);
                    i = end + 3;
                    continue;
                }
                if (startsWith("<?")) {
                    size_t end = s.find("?>", i);
                    if (end == std::string::npos) return fail("未闭合的处理指令");
                    i = end + 2;
                    continue;
                }
                node.children.emplace_back();
                if (!ParseElement(node.children.back(), depth + 1)) return false;
            } else {
                text += cur();
                ++i;
            }
        }
    }
};

}  // namespace

bool ParseXml(const std::string& src, XmlNode& root, std::string& err) {
    Parser p(src);
    // 跳过 UTF-8 BOM
    if (src.size() >= 3 && static_cast<unsigned char>(src[0]) == 0xEF &&
        static_cast<unsigned char>(src[1]) == 0xBB && static_cast<unsigned char>(src[2]) == 0xBF) {
        p.i = 3;
    }
    if (!p.skipMisc()) { err = p.err; return false; }
    if (p.eof()) { err = "空 XML"; return false; }
    if (!p.ParseElement(root, 0)) { err = p.err; return false; }
    return true;
}

}  // namespace vsx
