#!/usr/bin/env python3
"""通过 gadget 的 listen 端口加载 hook 脚本（PC 端调试用）。

前置：
  1. 手机端切到 listen 模式：sh gadget_ctl.sh mode listen
  2. 目标 App 必须在前台（后台会被系统冻结，gadget 线程停摆，连接会挂住）
  3. adb forward tcp:27052 tcp:27052

用法示例：
  python tools/load_hook.py --script docs/hooks/00-hello.js --forward --seconds 5
  python tools/load_hook.py --script docs/hooks/dist/02-ssl-bypass.js
  python tools/load_hook.py --ps
  python tools/load_hook.py --script my.js --pid 12345 --host 127.0.0.1:27099
"""
import argparse
import subprocess
import sys
import time

try:
    import frida
except ImportError:
    sys.exit("未安装 frida，请先 pip install -r requirements.txt")


def adb_forward(host):
    port = host.split(":")[-1]
    cmd = ["adb", "forward", "tcp:%s" % port, "tcp:%s" % port]
    print("[*] " + " ".join(cmd))
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        print("[!] 没找到 adb，跳过 forward（请自行确保端口已转发）")
    except subprocess.CalledProcessError as e:
        print("[!] adb forward 失败: %s" % e)


def resolve_target(dev, pid):
    procs = dev.enumerate_processes()
    if pid:
        for p in procs:
            if p.pid == pid:
                return p
        raise SystemExit("没有 pid=%s 的进程" % pid)
    for p in procs:
        if p.name == "Gadget":
            return p
    raise SystemExit(
        "没有找到 Gadget 进程。检查：\n"
        "  1) 手机端是不是 listen 模式（gadget_ctl.sh mode listen）\n"
        "  2) 目标 App 是否在前台运行\n"
        "  3) adb forward 是否建立\n"
        "现有进程: %s" % [(p.pid, p.name) for p in procs]
    )


def main():
    ap = argparse.ArgumentParser(description="加载 hook 脚本到 gadget")
    ap.add_argument("--host", default="127.0.0.1:27052", help="gadget 监听地址")
    ap.add_argument("--script", help="要加载的 js 文件")
    ap.add_argument("--pid", type=int, help="目标 pid（默认按名字 Gadget）")
    ap.add_argument("--forward", action="store_true", help="自动执行 adb forward")
    ap.add_argument("--seconds", type=float, default=0, help="运行 N 秒后退出，0=一直跑")
    ap.add_argument("--ps", action="store_true", help="只列出进程")
    ap.add_argument("--out", help="同时把日志写到这个文件")
    args = ap.parse_args()

    if args.forward:
        adb_forward(args.host)

    dev = frida.get_device_manager().add_remote_device(args.host)

    if args.ps:
        for p in dev.enumerate_processes():
            print("%6d  %s" % (p.pid, p.name))
        return

    if not args.script:
        ap.error("--script 必填（或用 --ps 查看进程）")

    target = resolve_target(dev, args.pid)
    print("[*] 附着 %s (pid=%d)" % (target.name, target.pid))
    session = dev.attach(target.pid)

    with open(args.script, encoding="utf-8") as f:
        source = f.read()
    script = session.create_script(source)

    sink = open(args.out, "w", encoding="utf-8") if args.out else None

    def emit(line):
        print(line, flush=True)
        if sink:
            sink.write(line + "\n")
            sink.flush()

    def on_message(message, data):
        if message["type"] == "log":
            emit(message["payload"])
        elif message["type"] == "error":
            emit("[error] %s\n%s" % (message.get("description"), message.get("stack", "")))
        else:
            emit("[%s] %s" % (message["type"], message.get("payload", message)))

    script.on("message", on_message)

    try:
        script.load()
    except Exception as e:
        print("[!] 脚本加载失败: %s" % e)
        print("    常见原因：Java 脚本没打包（frida 17 需要 frida-compile）、"
              "script 里有 import 语句、语法错误")
        return 2

    print("[*] 已加载 %s（Ctrl+C 退出）" % args.script)
    try:
        if args.seconds > 0:
            time.sleep(args.seconds)
        else:
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            session.detach()
        except Exception:
            pass
        if sink:
            sink.close()
        print("[*] 已断开")
    return 0


if __name__ == "__main__":
    sys.exit(main())
