// SPDX-License-Identifier: MIT
// 去特征实现：maps 匿名化 + 线程名伪装 + 状态落盘 + 可控日志
#include "stealth.h"

#include <android/log.h>
#include <dirent.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <unistd.h>

#include <cctype>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace {

struct MapEntry {
    uintptr_t start, end;
    int prot;
};

bool g_log_enabled = false;  // 由 gs_set_log_enabled 控制；native 默认静默

// 伪装成 ART / 应用里本来就会出现的线程名，比 "ThreadPool-123" 自然
static const char *kAliasPool[] = {
    "pool-2-thread-1", "pool-2-thread-2", "pool-2-thread-3",
    "ReferenceQueueD", "FinalizerWatchd", "hwuiTask2",
    "SurfaceSyncGrou", "AsyncTask #3"
};
static const int kAliasCount = (int)(sizeof(kAliasPool) / sizeof(kAliasPool[0]));

bool name_matches(const char *name) {
    if (!name) return false;
    // frida-gadget / gum-js-loop / gmain / gdbus / gjs-* 等
    static const char *k[] = {"frida", "gadget", "gum-", "gmain", "gdbus", "gjs", nullptr};
    for (int i = 0; k[i]; i++) {
        if (strstr(name, k[i])) return true;
    }
    return false;
}

bool write_comm(int tid, const char *new_name) {
    char path[128];
    snprintf(path, sizeof(path), "/proc/self/task/%d/comm", tid);
    int fd = open(path, O_WRONLY | O_TRUNC);
    if (fd < 0) return false;
    size_t n = strlen(new_name);
    ssize_t w = write(fd, new_name, n);
    close(fd);
    return w == (ssize_t)n;
}

}  // namespace

void gs_log(const char *tag, const char *fmt, ...) {
    if (!g_log_enabled) return;
    va_list ap;
    va_start(ap, fmt);
    __android_log_vprint(ANDROID_LOG_INFO, tag, fmt, ap);
    va_end(ap);
}

// 由 main.cpp 在读完配置后调用
extern "C" void gs_set_log_enabled(bool on) { g_log_enabled = on; }

int remap_library(const char *needle) {
    if (!needle || !*needle) return 0;
    FILE *fp = fopen("/proc/self/maps", "re");
    if (!fp) return 0;

    std::vector<MapEntry> entries;
    char buf[512];
    while (fgets(buf, sizeof(buf), fp)) {
        if (!strstr(buf, needle)) continue;
        unsigned long start = 0, end = 0, off = 0;
        char perms[8] = {0}, dev[32] = {0}, path[256] = {0};
        unsigned long inode = 0;
        if (sscanf(buf, "%lx-%lx %7s %lx %31s %lu %255s",
                   &start, &end, perms, &off, dev, &inode, path) < 2) continue;
        if (end <= start) continue;
        int prot = 0;
        if (strchr(perms, 'r')) prot |= PROT_READ;
        if (strchr(perms, 'w')) prot |= PROT_WRITE;
        if (strchr(perms, 'x')) prot |= PROT_EXEC;
        entries.push_back({(uintptr_t)start, (uintptr_t)end, prot});
    }
    fclose(fp);

    int done = 0;
    for (const auto &e : entries) {
        size_t size = e.end - e.start;
        void *addr = reinterpret_cast<void *>(e.start);
        void *tmp = mmap(nullptr, size, PROT_READ | PROT_WRITE,
                         MAP_ANONYMOUS | MAP_PRIVATE, -1, 0);
        if (tmp == MAP_FAILED) continue;

        if (!(e.prot & PROT_READ)) mprotect(addr, size, PROT_READ | e.prot);
        memcpy(tmp, addr, size);
        void *r = mremap(tmp, size, size, MREMAP_MAYMOVE | MREMAP_FIXED, addr);
        if (r == MAP_FAILED) {
            munmap(tmp, size);
            continue;
        }
        mprotect(addr, size, e.prot);
        done++;
    }
    return done;
}

void start_thread_cloak(const std::string &alias) {
    std::thread([alias]() {
        // 守护线程自己也不叫 "gs-cloak"，避免留下奇怪的 comm
        prctl(PR_SET_NAME, (unsigned long)"pool-2-thread-9", 0, 0, 0);
        bool auto_alias = (alias.empty() || alias == "auto");
        int idx = 0, round = 0;
        for (;;) {
            DIR *d = opendir("/proc/self/task");
            if (d) {
                struct dirent *de;
                while ((de = readdir(d))) {
                    if (!isdigit((unsigned char)de->d_name[0])) continue;
                    int tid = atoi(de->d_name);
                    char cp[128], comm[64] = {0};
                    snprintf(cp, sizeof(cp), "/proc/self/task/%d/comm", tid);
                    FILE *f = fopen(cp, "re");
                    if (!f) continue;
                    if (fgets(comm, sizeof(comm), f)) {
                        size_t n = strlen(comm);
                        while (n && (comm[n - 1] == '\n' || comm[n - 1] == '\r')) comm[--n] = 0;
                        if (name_matches(comm)) {
                            char nn[16];
                            if (auto_alias) {
                                snprintf(nn, sizeof(nn), "%s", kAliasPool[idx % kAliasCount]);
                                idx++;
                            } else {
                                // comm 上限 15 字符
                                snprintf(nn, sizeof(nn), "%.7s-%03d", alias.c_str(), tid % 1000);
                            }
                            write_comm(tid, nn);
                        }
                    }
                    fclose(f);
                }
                closedir(d);
            }
            // 前 10 秒高频，之后降为 1 秒一次，开销可忽略
            usleep(round < 100 ? 100000 : 1000000);
            round++;
        }
    }).detach();
}

void write_state(const std::string &pkg, const std::string &payload) {
    if (pkg.empty()) return;
    char path[512];
    const char *roots[] = {"/data/data", "/data/user/0", nullptr};
    for (int i = 0; roots[i]; i++) {
        snprintf(path, sizeof(path), "%s/%s/.gs_state.%d", roots[i], pkg.c_str(), getpid());
        FILE *f = fopen(path, "we");
        if (!f) continue;
        fwrite(payload.c_str(), 1, payload.size(), f);
        fputc('\n', f);
        fclose(f);
        return;
    }
}
