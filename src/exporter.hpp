// exporter.hpp —— 导出产物落盘（PNG / SVG / HTML / PDF）
// 后端保持无状态：产物内容全部由前端生成（只有 WebView2 里有 canvas），
// 这里只做 base64 解码 + 建父目录 + 写文件，不关心里层是什么格式
#pragma once

#include <string>

#include "nlohmann/json.hpp"

namespace vxex {

// base64（允许 dataURL 风格：无填充、含空白与 "data:...;base64," 前缀）→ 原始字节；非法字符忽略
std::string DecodeBase64(const std::string& text);

// 逐段 CreateDirectoryW 补齐父目录（导出到不存在的路径时不该直接失败）
bool EnsureParentDir(const std::string& path);

// 写文件；成功返回 true，失败写 err（err 用中文，前端状态栏直接展示）
bool WriteOutputFile(const std::string& path, const std::string& bytes, std::string& err);

// export.write 命令：{path, base64} → {success, path, size}
nlohmann::json ExportWrite(const nlohmann::json& args);

}  // namespace vxex
