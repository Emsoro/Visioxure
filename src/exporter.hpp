// exporter.hpp —— 导出产物落盘（PNG / SVG / HTML / PDF）
// 后端保持无状态：产物内容全部由前端生成（只有 WebView2 里有 canvas），
// 这里只做 base64 解码 + 建父目录 + 写文件，不关心里层是什么格式
#pragma once

#include <string>

#include "nlohmann/json.hpp"

namespace vxex {

// base64（允许 dataURL 风格：无填充、含空白与 "data:...;base64," 前缀）→ 原始字节；非法字符忽略
std::string DecodeBase64(const std::string& text);

// 原始字节 → base64（无填充）。图片读回 VSDX / 打开图片文件时用
std::string EncodeBase64(const std::string& bytes);

// 逐段 CreateDirectoryW 补齐父目录（导出到不存在的路径时不该直接失败）
bool EnsureParentDir(const std::string& path);

// 写文件；成功返回 true，失败写 err（err 用中文，前端状态栏直接展示）
bool WriteOutputFile(const std::string& path, const std::string& bytes, std::string& err);

// export.write 命令：{path, base64} → {success, path, size}
nlohmann::json ExportWrite(const nlohmann::json& args);

// F5 预览：在系统临时目录生成唯一的 UTF-8 .html 路径（只算路径，不写盘、不开浏览器）。
// 文件名由后端生成，避免前端把任意本地路径传给 ShellExecute；空串表示取临时目录失败。
std::string MakePreviewPath(const std::string& name);

}  // namespace vxex
