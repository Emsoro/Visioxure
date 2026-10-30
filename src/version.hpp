// version.hpp —— 版本号唯一来源
// 由 CMakeLists.txt 的 project(VERSION) 经宏 VISIOXURE_VERSION 注入：
//   · 前端可见版本（bridge.test / app.get_info）
//   · VSDX docProps/app.xml 的 AppVersion
//   · exe「文件属性 → 详细信息」的版本资源（CMake 直接读 PROJECT_VERSION）
// 升级版本只需改 CMakeLists 里的 project(... VERSION x.y.z)，三处自动同步。
#pragma once

#ifndef VISIOXURE_VERSION
#define VISIOXURE_VERSION "1.0.1"  // 回退值：不经 CMake 手工编译（如单文件调试）时使用
#endif

namespace visioxure {

constexpr const char* kVersion = VISIOXURE_VERSION;

}  // namespace visioxure
