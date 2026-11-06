#!/usr/bin/env python3
"""PC 端一键查看 Gadget Stealth 安装/注入状态。

用法:
  python tools/status.py              # 状态 + 自检 + 版本
  python tools/status.py --check      # 只看自检
  python tools/status.py --info       # 只看版本与来源
  python tools/status.py --web        # 在手机上打开 WebUI
  python tools/status.py --cmd 'add com.foo.bar'   # 透传设备侧子命令
"""
import argparse
import os
import subprocess

ADB = os.environ.get("ADB", r"E:\repo\android\Sdk\platform-tools\adb.exe")
CTL = "/data/adb/modules/zygisk_gadget_stealth/gadget_ctl.sh"
PKG = "sbojim.vbtcfn.kjhzlb"  # 用户自定义包名的 SukiSU 管理器，可用 --manager 覆盖

LABELS = {
    "ver": "模块版本", "gver": "frida-gadget 版本", "enabled": "全局开关",
    "loaded": "Zygisk 已加载", "mode": "注入模式", "port": "listen 端口",
    "delay": "注入延迟(ms)", "n": "目标数", "targets": "目标列表",
    "active": "已记录注入次数", "last": "最近一次", "lib": "伪装 so",
    "maps": "maps 匿名化", "threads": "线程名伪装", "nolog": "静默日志",
    "cfg": "settings.conf", "lib64": "gadget 64 位", "data": "数据目录",
}
CHECKS = {
    "module": "模块 so", "zygisk": "Zygisk 加载", "lib64": "gadget(arm64)",
    "lib32": "gadget(arm)", "settings": "settings.conf", "gadgetcfg": "gadget.config",
    "hook": "hook.js", "states": "注入记录数", "listen": "端口监听",
}
INFO = {
    "gver": "frida-gadget", "arch": "架构", "size64": "arm64 大小(B)",
    "size32": "arm 大小(B)", "sha": "sha256(前16)", "up": "上游项目",
    "release": "发布页", "ref": "参考项目", "lic": "许可",
}


def sh(cmd, use_su=True):
    args = [ADB, "shell"]
    if use_su:
        args += ["su", "-c", cmd]
    else:
        args += [cmd]
    r = subprocess.run(args, capture_output=True, text=True, timeout=30)
    return (r.stdout or r.stderr).strip().replace("\r", "")


def kv(line):
    out = {}
    for part in (line or "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
    return out


def show(title, m, labels):
    print("\n== %s ==" % title)
    for k, label in labels.items():
        if k in m:
            v = m[k]
            if v in ("0", "1") and k not in ("n", "active", "states", "size64", "size32"):
                v = "是" if v == "1" else "否"
            print("  %-20s %s" % (label, v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--info", action="store_true")
    ap.add_argument("--web", action="store_true")
    ap.add_argument("--manager", default=PKG)
    ap.add_argument("--cmd")
    a = ap.parse_args()

    if a.cmd:
        print(sh("sh %s %s" % (CTL, a.cmd)))
        return
    if a.web:
        act = "%s/%s.ui.webui.WebUIActivity" % (a.manager, a.manager)
        print(sh("am start -n %s --es id zygisk_gadget_stealth" % act))
        return

    s = kv(sh("sh %s status1" % CTL))
    c = kv(sh("sh %s check1" % CTL))
    i = kv(sh("sh %s info1" % CTL))
    if not s.get("ver"):
        print("读取失败，请确认模块已安装并重启过手机。")
        print("原始输出:", s)
        return
    if not (a.check or a.info):
        show("当前状态", s, LABELS)
    if a.check or not (a.check or a.info):
        show("安装自检", c, CHECKS)
    if a.info or not (a.check or a.info):
        show("版本与来源", i, INFO)
    print("\n设备侧完整面板: adb shell su -c 'sh %s status'" % CTL)


if __name__ == "__main__":
    main()
