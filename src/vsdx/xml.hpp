// xml.hpp —— 极简 XML DOM（VSDX 读写专用，无第三方依赖）
#pragma once

#include <string>
#include <utility>
#include <vector>

namespace vsx {

struct XmlNode {
    std::string tag;
    std::vector<std::pair<std::string, std::string>> attrs;
    std::vector<XmlNode> children;
    std::string text;  // 本元素直接文本（不含子元素文本）

    bool has(const std::string& name) const;
    std::string attr(const std::string& name, const std::string& def = "") const;
    const XmlNode* child(const std::string& name) const;
    std::vector<const XmlNode*> childrenNamed(const std::string& name) const;
    std::string allText() const;
};

// 解析 XML 文本；失败时返回 false 并写入 err
bool ParseXml(const std::string& src, XmlNode& root, std::string& err);

// XML 文本/属性转义
std::string XmlEscape(const std::string& value);

}  // namespace vsx
