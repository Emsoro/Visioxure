// package.hpp —— OPC 包（zip）读写：miniz 负责压缩，本层做 part 路径与 rels 解析
#pragma once

#include <map>
#include <string>
#include <vector>

namespace vsx {

class Package {
public:
    struct Rel {
        std::string id;
        std::string type;
        std::string target;  // 已解析为包内绝对 part 路径（无前导 /）
    };

    static bool LoadFromBytes(const std::string& bytes, Package& out, std::string& err);

    std::string ToBytes() const;

    void Add(const std::string& name, std::string data);
    bool Has(const std::string& name) const;
    const std::string* Find(const std::string& name) const;
    std::string FindOr(const std::string& name, const std::string& def = "") const;

    // 读取某 part 的 .rels（part 为空字符串表示包根 _rels/.rels）
    std::vector<Rel> Rels(const std::string& partName) const;

    static std::string RelsPathFor(const std::string& partName);
    static std::string ResolveTarget(const std::string& basePart, const std::string& target);

    const std::map<std::string, std::string>& Parts() const { return parts_; }

private:
    std::map<std::string, std::string> parts_;
};

}  // namespace vsx
