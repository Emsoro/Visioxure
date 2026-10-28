// writer.hpp —— 内部文档 JSON → VSDX 字节流
#pragma once

#include <string>

#include "nlohmann/json.hpp"

namespace vsx {

// 把前端文档 JSON 转成合法的 .vsdx（OPC 包）字节；失败返回空并写 err
std::string BuildVsdxBytes(const nlohmann::json& doc, std::string& err);

}  // namespace vsx
