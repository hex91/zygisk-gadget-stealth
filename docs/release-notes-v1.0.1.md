UI 修复版：`script` 模式下「端口监听」不再像报错。

## 改了什么

- **自检项「端口监听」重新定义语义**：零端口不是故障。`script` 模式显示绿色中性样式 `端口监听 不监听（script 预期）`；`listen` 模式但目标 App 还没起来，显示 `端口监听 未监听（等 App 启动）`；只有真正该管的项才标红。
- **「注入记录」同理**：全新安装还没启动过目标 App 时显示 `暂无（还没启动目标 App）`，不再红色 ✗。
- **当前状态「端口」行**：`script` 模式写明 `—（script 不监听）`，`listen` 模式显示 `127.0.0.1:27052`。
- **打包脚本**：`tools/build_zip.py` 版本号改为从 `module.prop` 读取，产物名随版本自动变（以后不必手改文件名）。

## 三态实测（Pixel 6 / Android 15 / 模块 1.0.1）

| 场景 | 自检显示 | 颜色 | 旁证 |
|---|---|---|---|
| `script` 模式（零端口） | `端口监听 不监听（script 预期）` | 绿 | `netstat -tln` 无 27052 |
| `listen` 模式、目标 App 未运行 | `端口监听 未监听（等 App 启动）` | 绿 | 同上 |
| `listen` 模式、目标 App 已运行 | `端口监听 ✓` | 绿 | `127.0.0.1:27052 LISTEN` |

## 安装

```bash
adb push gadget-stealth-1.0.1.zip /data/local/tmp/
adb shell su -c 'ksud module install /data/local/tmp/gadget-stealth-1.0.1.zip'
adb reboot
```

从 1.0.0 升级会保留 `settings.conf` 与 `hook.js`（安装脚本只在文件不存在时写默认值）。

## 文件

| 文件 | 大小 | sha256 |
|---|---|---|
| `gadget-stealth-1.0.1.zip` | 13,925,426 B | `19324ef60cc6e650e9011ec5797e1de3357074f903d052ef7a29012ef864fddb` |

gadget 二进制未变，仍为官方 17.5.2（arm64 `27521158…`、arm `61b940b7…`）。

> 仅限自有设备或已授权目标的安全研究用途。
