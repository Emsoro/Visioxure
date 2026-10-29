// exporter.cpp —— 见 exporter.hpp
#include "exporter.hpp"

#include <Windows.h>

#include <vector>

namespace vxex {
namespace {

// 与 main.cpp 里同名的两个转换函数：路径必须走 Wide API，
// 中文用户名/中文目录名用 ANSI 版 CreateFileA 会直接打不开
std::wstring ToWide(const std::string& s) {
    if (s.empty()) return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), out.data(), len);
    return out;
}

int B64Val(unsigned char ch) {
    if (ch >= 'A' && ch <= 'Z') return ch - 'A';
    if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
    if (ch >= '0' && ch <= '9') return ch - '0' + 52;
    if (ch == '+') return 62;
    if (ch == '/') return 63;
    return -1;
}

}  // namespace

std::string DecodeBase64(const std::string& text) {
    // 允许传 dataURL：只取最后一个 base64 段（前端已剥离前缀，这里再兜一层）
    size_t start = 0;
    size_t comma = text.find(',');
    if (comma != std::string::npos && text.compare(0, 5, "data:") == 0) start = comma + 1;

    std::string out;
    out.reserve(text.size() / 4 * 3 + 3);
    int val = 0, bits = 0;
    for (size_t i = start; i < text.size(); i++) {
        unsigned char ch = static_cast<unsigned char>(text[i]);
        if (ch == '=' || ch == '\r' || ch == '\n' || ch == ' ' || ch == '\t') continue;
        int d = B64Val(ch);
        if (d < 0) continue;                       // 忽略任何分隔/异常字符，不让整次导出失败
        val = (val << 6) | d;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((val >> bits) & 0xFF));
        }
    }
    return out;
}

bool EnsureParentDir(const std::string& path) {
    std::wstring w = ToWide(path);
    size_t slash = w.find_last_of(L"\\/");
    if (slash == std::wstring::npos || slash == 0) return true;   // 无目录段 / 根路径
    std::wstring dir = w.substr(0, slash);
    for (size_t i = 0; i < dir.size(); i++) {
        wchar_t ch = dir[i];
        if (ch != L'\\' && ch != L'/') continue;
        if (i <= 2) continue;                       // 跳过 "C:\" 这类盘符根，CreateDirectory 对它必失败
        std::wstring sub = dir.substr(0, i);
        CreateDirectoryW(sub.c_str(), nullptr);      // 已存在时失败即可，不用判断
    }
    bool ok = CreateDirectoryW(dir.c_str(), nullptr) != 0 || GetFileAttributesW(dir.c_str()) != INVALID_FILE_ATTRIBUTES;
    return ok;
}

bool WriteOutputFile(const std::string& path, const std::string& bytes, std::string& err) {
    if (path.empty()) {
        err = "缺少导出路径";
        return false;
    }
    EnsureParentDir(path);
    HANDLE h = CreateFileW(ToWide(path).c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
        err = "无法写入文件（路径不存在或无权限）";
        return false;
    }
    DWORD written = 0;
    BOOL ok = bytes.empty() ? TRUE : WriteFile(h, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr);
    CloseHandle(h);
    if (!ok || written != bytes.size()) {
        err = "写入文件失败";
        return false;
    }
    return true;
}

nlohmann::json ExportWrite(const nlohmann::json& args) {
    std::string path = args.value("path", std::string());
    if (path.empty()) return nlohmann::json{{"success", false}, {"error", "缺少导出路径"}};
    if (!args.contains("base64") || !args["base64"].is_string()) {
        return nlohmann::json{{"success", false}, {"error", "缺少导出内容"}};
    }
    std::string bytes = DecodeBase64(args["base64"].get<std::string>());
    if (bytes.empty()) return nlohmann::json{{"success", false}, {"error", "导出内容为空"}};
    std::string err;
    if (!WriteOutputFile(path, bytes, err)) return nlohmann::json{{"success", false}, {"error", err}};
    return nlohmann::json{{"success", true}, {"path", path}, {"size", bytes.size()}};
}

}  // namespace vxex
