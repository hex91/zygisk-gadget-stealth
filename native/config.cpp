// SPDX-License-Identifier: MIT
// 极简纯文本配置解析：不引入 JSON 库，避免每个 App 启动时解析崩溃
#include "config.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace {

std::string trim(std::string s) {
    const char *ws = " \t\r\n";
    size_t a = s.find_first_not_of(ws);
    if (a == std::string::npos) return std::string();
    size_t b = s.find_last_not_of(ws);
    return s.substr(a, b - a + 1);
}

std::string first_line(const char *path) {
    FILE *f = fopen(path, "re");
    if (!f) return std::string();
    char buf[512];
    std::string r;
    if (fgets(buf, sizeof(buf), f)) r = trim(std::string(buf));
    fclose(f);
    return r;
}

bool as_bool(const char *v) {
    return (strcmp(v, "1") == 0 || strcmp(v, "true") == 0 || strcmp(v, "yes") == 0 ||
            strcmp(v, "on") == 0);
}

unsigned as_uint(const char *v, unsigned dflt) {
    if (!v || !*v) return dflt;
    char *end = nullptr;
    unsigned long n = strtoul(v, &end, 10);
    if (end == v || n > 1000000UL) return dflt;
    return (unsigned)n;
}

// target=com.foo.bar,1,1200
Target parse_target(const std::string &value, unsigned default_delay) {
    Target t;
    t.delay_ms = default_delay;
    char buf[512];
    snprintf(buf, sizeof(buf), "%s", value.c_str());
    char *save = nullptr;
    char *p1 = strtok_r(buf, ",", &save);
    if (!p1) return t;
    t.package = trim(std::string(p1));
    char *p2 = strtok_r(nullptr, ",", &save);
    if (p2) t.enabled = as_bool(trim(std::string(p2)).c_str());
    char *p3 = strtok_r(nullptr, ",", &save);
    if (p3) {
        t.delay_ms = as_uint(trim(std::string(p3)).c_str(), default_delay);
        t.delay_set = true;
    }
    return t;
}

}  // namespace

const Target *find_target(const Settings &s, const char *pkg) {
    if (!pkg) return nullptr;
    for (const auto &t : s.targets) {
        if (t.package == pkg) return &t;
    }
    return nullptr;
}

const std::string &lib_for_this_abi(const Settings &s) {
#if defined(__LP64__)
    return s.lib_name;
#else
    return s.lib_name32.empty() ? s.lib_name : s.lib_name32;
#endif
}

bool load_settings(Settings &s) {
    // 默认目录可被重定向文件覆盖（管理脚本 gadget_ctl.sh datadir 维护）
    std::string dir = first_line(GS_REDIRECT_FILE);
    if (dir.empty() || dir[0] != '/') dir = GS_DEFAULT_DIR;
    while (!dir.empty() && dir[dir.size() - 1] == '/') dir.erase(dir.size() - 1);

    s.data_dir = dir;
    s.config_path = dir + "/" + GS_CONFIG_NAME;
    s.lib_name = "libgcore.so";
    s.lib_name32 = "libgcore32.so";
    s.mode = "script";
    s.port = 27052;
    s.delay_ms = 1200;
    s.enabled = true;
    s.hide_maps = true;
    s.hide_module_map = false;
    s.hide_threads = true;
    s.no_log = true;
    s.write_state = true;
    s.thread_alias = "auto";
    s.targets.clear();

    FILE *f = fopen(s.config_path.c_str(), "re");
    if (!f) return false;

    char line[1024];
    while (fgets(line, sizeof(line), f)) {
        std::string l = trim(std::string(line));
        if (l.empty() || l[0] == '#') continue;
        size_t eq = l.find('=');
        if (eq == std::string::npos) continue;
        std::string k = trim(l.substr(0, eq));
        std::string v = trim(l.substr(eq + 1));

        if (k == "target") {
            Target t = parse_target(v, s.delay_ms);
            if (!t.package.empty()) s.targets.push_back(t);
        } else if (k == "enabled") s.enabled = as_bool(v.c_str());
        else if (k == "lib_name") { if (!v.empty()) s.lib_name = v; }
        else if (k == "lib_name32") { if (!v.empty()) s.lib_name32 = v; }
        else if (k == "mode") { if (v == "listen" || v == "script") s.mode = v; }
        else if (k == "port") s.port = as_uint(v.c_str(), s.port);
        else if (k == "delay_ms") s.delay_ms = as_uint(v.c_str(), s.delay_ms);
        else if (k == "hide_maps") s.hide_maps = as_bool(v.c_str());
        else if (k == "hide_module_map") s.hide_module_map = as_bool(v.c_str());
        else if (k == "hide_threads") s.hide_threads = as_bool(v.c_str());
        else if (k == "no_log") s.no_log = as_bool(v.c_str());
        else if (k == "write_state") s.write_state = as_bool(v.c_str());
        else if (k == "thread_alias") { if (!v.empty()) s.thread_alias = v; }
        // data_dir 由重定向文件决定，配置里的同名键仅作展示，不重复解析
    }
    fclose(f);
    s.loaded = true;
    return true;
}
