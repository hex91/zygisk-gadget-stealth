首个版本：把 frida-gadget 统一到官方 **17.5.2**，按 App 注入、去特征、可配置、可看状态。

## 安装包

| 文件 | 大小 | sha256 |
|---|---|---|
| `gadget-stealth-1.0.0.zip` | 13,925,205 B | `029ede666232c4cc0b163e4004a29181c8cef23fb181102e230c5b8d003022fd` |

内含官方 `frida-gadget 17.5.2` arm64（24,872,296 B，`2752115850c4fd85a239d039aa414a20b29d79eb6082592ee0d816b2917d0f7d`）与 arm（15,700,304 B，`61b940b7fd149148690273710826d261370e02fa880e7a46c053934512fcf02a`）。

## 安装

```bash
adb push gadget-stealth-1.0.0.zip /data/local/tmp/
adb shell su -c 'ksud module install /data/local/tmp/gadget-stealth-1.0.0.zip'
adb reboot        # Zygisk 模块必须重启才加载
```

Magisk 用户在管理器里「从本地安装」。

## 特性

- **版本统一**：gadget 与 PC `frida==17.5.2` / `frida-tools==14.5.2` 严格一致
- **默认零端口**：`script` 模式自动执行 `hook.js`，不监听任何端口；需要交互调试再切 `listen`
- **去特征**：maps 段匿名重映射、so 命名为 `libgcore.so`、数据目录 `.gsys`、Gum/GLib 线程名轮换伪装、logcat 默认静默
- **可配置**：`/data/local/tmp/.gsys/settings.conf`，含模式、端口、延迟、目标白名单、各去特征开关
- **可看状态**：管理器 WebUI（状态卡 + 安装自检 + 目标管理 + 来源链接）、设备端 `gadget_ctl.sh status`、PC 端 `tools/status.py`
- **不 ptrace / 不改 APK 签名**：Zygisk `dlopen` 注入，配合 xDL 绕过 linker namespace

## 真机验证

Pixel 6 / Android 15 / KernelSU + Zygisk Next 1.5.2：

- `Frida.version = 17.5.2`，script 模式脚本自动执行，零监听端口
- 2826 行 maps 中 `gadget / frida / libgcore / .gsys / 模块路径` 出现次数均为 **0**
- 线程名中 frida 相关项 **0** 个
- listen 模式 `frida-ps -H 127.0.0.1:27052` 正常，与设备端 frida-server（39527）双路共存

细节见仓库 `docs/真机验证报告.md`。

## 署名

- gadget 二进制：[frida/frida](https://github.com/frida/frida) 17.5.2 官方 release，wxWindows Library Licence
- 注入思路 / Zygisk API 头： [lico-n/ZygiskFrida](https://github.com/lico-n/ZygiskFrida)，MIT
- linker 强制加载：[HexHacking/xDL](https://github.com/hexhacking/xDL)，MIT

本仓库未修改 frida 本体。与 [frida-persistent-module](https://github.com/hex91/frida-persistent-module) 互补：那个管整机任意进程临时调试，这个管固定 App 长期 hook。

> 仅限自有设备或已授权目标的安全研究用途。
