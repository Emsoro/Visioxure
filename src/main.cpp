// Visioxure —— Visio + Axure 结合体（图形绘制 + 交互原型）
//
// P0 骨架：窗口创建 + Bridge 双向验证（前端 invoke → 后端，后端 Emit → 前端）。
// P3：文件对话框 + VSDX 读写（src/vsdx）+ 最近文件；导出命令在 P6 接入（见 CODEPLAN.md §5）。
#include "tauricpp/app.hpp"
#include "tauricpp/dialog.hpp"

#include "vsdx/reader.hpp"
#include "vsdx/writer.hpp"

#include <Windows.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

using nlohmann::json;

namespace {

constexpr const char* kVersion = "0.1.0";
constexpr size_t kMaxRecent = 10;

std::string ErrorLogPath() {
    const char* tmp = std::getenv("LOCALAPPDATA");
    std::string dir = tmp ? tmp : ".";
    return dir + "/Visioxure/error_log.txt";
}

std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), out.data(), len);
    return out;
}

std::string WideToUtf8(const std::wstring& s) {
    if (s.empty()) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
    std::string out(len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), out.data(), len, nullptr, nullptr);
    return out;
}

bool ReadFileBytes(const std::string& path, std::string& out, std::string& err) {
    HANDLE h = CreateFileW(Utf8ToWide(path).c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
        err = "无法打开文件（路径不存在或无权限）";
        return false;
    }
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(h, &size)) {
        CloseHandle(h);
        err = "无法读取文件大小";
        return false;
    }
    out.resize(static_cast<size_t>(size.QuadPart));
    DWORD read = 0;
    BOOL ok = out.empty() ? TRUE : ReadFile(h, out.data(), static_cast<DWORD>(out.size()), &read, nullptr);
    CloseHandle(h);
    if (!ok) {
        err = "读取文件失败";
        return false;
    }
    out.resize(read);
    return true;
}

bool WriteFileBytes(const std::string& path, const std::string& data, std::string& err) {
    HANDLE h = CreateFileW(Utf8ToWide(path).c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
        err = "无法写入文件（路径不存在或无权限）";
        return false;
    }
    DWORD written = 0;
    BOOL ok = data.empty() ? TRUE : WriteFile(h, data.data(), static_cast<DWORD>(data.size()), &written, nullptr);
    CloseHandle(h);
    if (!ok || written != data.size()) {
        err = "写入文件失败";
        return false;
    }
    return true;
}

std::string RecentFilePath() {
    const char* appdata = std::getenv("APPDATA");
    std::string dir = std::string(appdata ? appdata : ".") + "\\Visioxure";
    CreateDirectoryW(Utf8ToWide(dir).c_str(), nullptr);
    return dir + "\\recent.json";
}

std::vector<std::string> LoadRecent() {
    std::ifstream in(RecentFilePath());
    std::vector<std::string> out;
    if (!in) return out;
    try {
        json j;
        in >> j;
        if (j.is_array()) {
            for (const auto& v : j) {
                if (v.is_string()) out.push_back(v.get<std::string>());
            }
        }
    } catch (...) {
    }
    return out;
}

void SaveRecent(const std::vector<std::string>& list) {
    std::ofstream out(RecentFilePath(), std::ios::trunc);
    if (!out) return;
    json j = json::array();
    for (const auto& p : list) j.push_back(p);
    out << j.dump();
}

void PushRecent(const std::string& path) {
    if (path.empty()) return;
    auto list = LoadRecent();
    list.erase(std::remove(list.begin(), list.end(), path), list.end());
    list.insert(list.begin(), path);
    if (list.size() > kMaxRecent) list.resize(kMaxRecent);
    SaveRecent(list);
}

bool EndsWithVsdx(const std::string& path) {
    if (path.size() < 5) return false;
    std::string tail = path.substr(path.size() - 5);
    std::transform(tail.begin(), tail.end(), tail.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return tail == ".vsdx";
}

}  // namespace

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    tauricpp::App::Config config;
    config.window_config.title = "Visioxure";
    config.window_config.width = 1440;
    config.window_config.height = 900;
    config.window_config.center = true;
    config.window_config.resizable = true;
    config.window_config.devtools = true;              // F12 打开 DevTools
    config.window_config.bg_color = RGB(245, 246, 248); // 与前端主题同色，消除白屏

    tauricpp::App app(config);
    auto& bridge = app.GetBridge();

    // Bridge 双向验证：前端 invoke → 返回 pong；延迟 Emit → 前端 listen 收到
    bridge.RegisterCommand("bridge.test", [&bridge](const json&) -> json {
        json j;
        j["message"] = "pong";
        j["version"] = kVersion;
        std::thread([&bridge]() {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            bridge.Emit("bridge.greet", json{{"from", "cpp"}, {"version", kVersion}});
        }).detach();
        return j;
    });

    bridge.RegisterCommand("app.set_title", [&app](const json& args) -> json {
        app.GetWindow().SetTitle(args.value("title", "Visioxure"));
        return json{{"success", true}};
    });

    bridge.RegisterCommand("app.get_info", [](const json&) -> json {
        return json{{"version", kVersion}, {"name", "Visioxure"}};
    });

    // ---------- 文件对话框 ----------
    bridge.RegisterCommand("file.open_dialog", [&app](const json&) -> json {
        tauricpp::Dialog::OpenOptions opts;
        opts.title = "打开 Visioxure 文档";
        opts.filters = {{"Visioxure 文档", "*.vsdx"}, {"所有文件", "*.*"}};
        auto files = tauricpp::Dialog::OpenFile(app.GetWindow().GetHwnd(), opts);
        if (files.empty()) return json{{"success", false}, {"canceled", true}, {"path", ""}};
        return json{{"success", true}, {"path", files.front()}};
    });

    bridge.RegisterCommand("file.save_dialog", [&app](const json& args) -> json {
        tauricpp::Dialog::SaveOptions opts;
        opts.title = "保存 Visioxure 文档";
        opts.default_filename = args.value("default_name", std::string("未命名.vsdx"));
        opts.filters = {{"Visioxure 文档", "*.vsdx"}};
        auto path = tauricpp::Dialog::SaveFile(app.GetWindow().GetHwnd(), opts);
        if (!path || path->empty()) return json{{"success", false}, {"canceled", true}, {"path", ""}};
        std::string p = *path;
        if (!EndsWithVsdx(p)) p += ".vsdx";
        return json{{"success", true}, {"path", p}};
    });

    // ---------- VSDX 读写 ----------
    bridge.RegisterCommand("vsdx.save", [](const json& args) -> json {
        std::string path = args.value("path", std::string());
        if (path.empty()) return json{{"success", false}, {"error", "缺少保存路径"}};
        if (!args.contains("doc") || !args["doc"].is_object()) {
            return json{{"success", false}, {"error", "缺少文档内容"}};
        }
        std::string err;
        std::string bytes = vsx::BuildVsdxBytes(args["doc"], err);
        if (bytes.empty()) return json{{"success", false}, {"error", err.empty() ? "生成 VSDX 失败" : err}};
        if (!WriteFileBytes(path, bytes, err)) return json{{"success", false}, {"error", err}};
        PushRecent(path);
        return json{{"success", true}, {"path", path}, {"size", bytes.size()}};
    });

    bridge.RegisterCommand("vsdx.load", [](const json& args) -> json {
        std::string path = args.value("path", std::string());
        if (path.empty()) return json{{"success", false}, {"error", "缺少文件路径"}};
        std::string bytes, err;
        if (!ReadFileBytes(path, bytes, err)) return json{{"success", false}, {"error", err}};
        json doc;
        std::vector<std::string> warnings;
        if (!vsx::ParseVsdxBytes(bytes, doc, warnings, err)) {
            return json{{"success", false}, {"error", err.empty() ? "解析 VSDX 失败" : err}};
        }
        PushRecent(path);
        return json{{"success", true}, {"path", path}, {"doc", doc}, {"warnings", warnings}};
    });

    // ---------- 最近文件 ----------
    bridge.RegisterCommand("app.recent_files", [](const json& args) -> json {
        std::string action = args.value("action", std::string("get"));
        if (action == "add") {
            PushRecent(args.value("path", std::string()));
        } else if (action == "clear") {
            SaveRecent({});
        }
        json list = json::array();
        for (const auto& p : LoadRecent()) list.push_back(p);
        return json{{"success", true}, {"files", list}};
    });

    // 前端诊断日志（沿用 MaseGame 模式）
    bridge.RegisterCommand("log_error", [](const json& args) -> json {
        std::ofstream log(ErrorLogPath(), std::ios::app);
        if (log) {
            log << args.value("message", "") << std::endl;
        }
        return json{{"success", true}};
    });

    return app.Run();
}
