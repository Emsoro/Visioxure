// reader.hpp —— VSDX 字节流 → 内部文档 JSON
#pragma once

#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace vsx {

// 解析 .vsdx；warnings 收集降级/忽略项（如 Masters 占位）
bool ParseVsdxBytes(const std::string& bytes, nlohmann::json& out, std::vector<std::string>& warnings,
                    std::string& err);

}  // namespace vsx
