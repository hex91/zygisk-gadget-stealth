// SPDX-License-Identifier: MIT
// Zygisk 入口：按配置把 frida-gadget 注入指定 App，并做去特征 + 状态上报
#include "config.h"
#include "stealth.h"
#include "zygisk.h"

#include <dlfcn.h>
#include <jni.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <string>
#include <thread>

extern "C" {
#include "xdl.h"
}

extern "C" void gs_set_log_enabled(bool on);

using zygisk::Api;
using zygisk::AppSpecializeArgs;
using zygisk::ModuleBase;

namespace {

const char *kTag = "gs";

std::string process_name() {
    FILE *f = fopen("/proc/self/cmdline", "re");
    if (!f) return std::string();
    char buf[512] = {0};
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    for (size_t i = 0; i < n; i++) if (buf[i] == 0) buf[i] = ' ';
    return std::string(buf);
}

void wait_for_init(const std::string &pkg) {
    for (int i = 0; i < 500; i++) {
        if (process_name().find(pkg) != std::string::npos) break;
        usleep(10000);
    }
    usleep(100000);
}

std::string gadget_abi() {
#if defined(__aarch64__)
    return "arm64";
#elif defined(__arm__)
    return "arm";
#elif defined(__x86_64__)
    return "x86_64";
#else
    return "x86";
#endif
}

std::string state_payload(const Settings &s, const std::string &pkg,
                          const std::string &lib, int ok, const char *detail) {
    char buf[1024];
    snprintf(buf, sizeof(buf),
             "ok=%d;pkg=%s;pid=%d;ts=%lld;mode=%s;port=%u;lib=%s;gver=%s;abi=%s;"
             "maps=%d;threads=%d;detail=%s",
             ok, pkg.c_str(), getpid(), (long long)time(nullptr), s.mode.c_str(),
             s.port, lib.c_str(), GADGET_VERSION, gadget_abi().c_str(),
             s.hide_maps ? 1 : 0, s.hide_threads ? 1 : 0, detail);
    return std::string(buf);
}

void inject_worker(Settings s, Target t, std::string pkg) {
    wait_for_init(pkg);
    unsigned delay = t.delay_set ? t.delay_ms : s.delay_ms;
    if (delay) usleep(delay * 1000);

    const std::string &lib = lib_for_this_abi(s);
    std::string so = s.data_dir + "/" + lib;
    void *h = xdl_open(so.c_str(), XDL_TRY_FORCE_LOAD);
    const char *via = "xdl";
    if (!h) {
        h = dlopen(so.c_str(), RTLD_NOW | RTLD_LOCAL);
        via = "dlopen";
    }

    if (!h) {
        gs_log(kTag, "inject failed: %s (%s)", so.c_str(), dlerror() ? dlerror() : "?");
        if (s.write_state) write_state(pkg, state_payload(s, pkg, lib, 0, "dlopen-failed"));
        return;
    }
    gs_log(kTag, "injected via %s", via);

    if (s.hide_maps) {
        int n = remap_library(lib.c_str());
        gs_log(kTag, "remapped %d segments", n);
    }
    // 实验性：匿名化 Zygisk 模块自身的映射（模块目录名是已知特征）
    if (s.hide_module_map) {
        int n = remap_library(MODULE_ID);
        gs_log(kTag, "remapped module %d segments", n);
    }
    if (s.hide_threads) start_thread_cloak(s.thread_alias);

    if (s.write_state) write_state(pkg, state_payload(s, pkg, lib, 1, via));
}

}  // namespace

class StealthGadgetModule : public ModuleBase {
public:
    void onLoad(Api *api, JNIEnv *env) override {
        api_ = api;
        env_ = env;
    }

    void postAppSpecialize(const AppSpecializeArgs *args) override {
        if (!api_ || !env_ || !args || !args->nice_name) {
            if (api_) api_->setOption(zygisk::Option::DLCLOSE_MODULE_LIBRARY);
            return;
        }

        const char *raw = env_->GetStringUTFChars(args->nice_name, nullptr);
        std::string pkg = raw ? raw : "";
        if (raw) env_->ReleaseStringUTFChars(args->nice_name, raw);

        Settings s;
        if (!load_settings(s)) {
            api_->setOption(zygisk::Option::DLCLOSE_MODULE_LIBRARY);
            return;
        }
        gs_set_log_enabled(!s.no_log);

        const Target *t = s.enabled ? find_target(s, pkg.c_str()) : nullptr;
        if (!t || !t->enabled) {
            // 非目标进程立即卸载本模块 so，减少暴露面
            api_->setOption(zygisk::Option::DLCLOSE_MODULE_LIBRARY);
            return;
        }

        std::thread(inject_worker, s, *t, pkg).detach();
        // 目标进程保留模块 so（注入线程与改名线程的代码在这里）
    }

private:
    Api *api_ = nullptr;
    JNIEnv *env_ = nullptr;
};

REGISTER_ZYGISK_MODULE(StealthGadgetModule)
