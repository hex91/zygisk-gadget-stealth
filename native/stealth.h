// SPDX-License-Identifier: MIT
#pragma once

#include <string>

// 把 /proc/self/maps 里含 needle 的段重映射为匿名内存，抹掉文件路径
int  remap_library(const char *needle);
// 起一个低频守护线程，把 Gum/GLib 的线程名改成中性名字
void start_thread_cloak(const std::string &alias);
// 在 App 私有目录写一行状态，供 gadget_ctl.sh / WebUI 读取
void write_state(const std::string &pkg, const std::string &payload);
// no_log=1 时为空操作
void gs_log(const char *tag, const char *fmt, ...);
