// SPDX-License-Identifier: MIT
// Project: zygisk-gadget-stealth
#pragma once

#include <string>
#include <vector>

// 一行配置: target=<包名>[,<enabled 0|1>[,<delay_ms>]]
struct Target {
    std::string package;
    bool enabled = true;
    unsigned delay_ms = 0;
    bool delay_set = false;
};

struct Settings {
    bool loaded = false;          // 配置文件是否成功读取
    bool enabled = true;          // 全局总开关
    std::string config_path;      // 实际读到的配置路径
    std::string data_dir;         // gadget so / config / hook.js 所在目录
    std::string lib_name;         // 伪装后的 64 位 gadget so 文件名
    std::string lib_name32;       // 32 位 gadget so 文件名（armeabi-v7a 模块用）
    std::string mode;             // script | listen
    unsigned port = 27052;
    unsigned delay_ms = 1200;     // 默认注入延迟
    bool hide_maps = true;        // 把 gadget so 的 maps 匿名化
    bool hide_module_map = false; // 把本模块 so 的 maps 也匿名化（实验性）
    bool hide_threads = true;     // 伪装 Gum/GLib 线程名
    bool no_log = true;           // 不写 logcat
    bool write_state = true;      // 写 /.gs_state.<pid> 供管理端读取
    std::string thread_alias = "auto";
    std::vector<Target> targets;
};

// native 侧默认路径；可通过 /data/local/tmp/.gsys_redirect 重定向到别的目录
#define GS_DEFAULT_DIR   "/data/local/tmp/.gsys"
#define GS_REDIRECT_FILE "/data/local/tmp/.gsys_redirect"
#define GS_CONFIG_NAME   "settings.conf"

// 编译期常量，由 build.sh 用 -D 注入
#ifndef GADGET_VERSION
#define GADGET_VERSION "17.5.2"
#endif
#ifndef MODULE_ID
#define MODULE_ID "zygisk_gadget_stealth"
#endif

bool load_settings(Settings &out);
const Target *find_target(const Settings &s, const char *pkg);
// 按当前进程位数选 gadget so 文件名
const std::string &lib_for_this_abi(const Settings &s);
