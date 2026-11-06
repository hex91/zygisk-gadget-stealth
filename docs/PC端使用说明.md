# PC 端使用说明（连接与交互调试）

> 面向「在电脑上连上手机里的 gadget，实时加载脚本、看输出、改完再固化到手机」。
> 手机端持久化那套（`hook.js` 放哪、参数意义）见 [手机端使用说明.md](手机端使用说明.md)。

---

## 1. 连接拓扑

```
┌─────────────┐   USB/无线 adb    ┌──────────┐   tcp:27052   ┌──────────────────────────┐
│  PC         │ ────────────────► │  adb     │ ────────────► │ 手机 127.0.0.1:27052      │
│  frida CLI  │  adb forward      │  server  │               │ 目标 App 进程内的 gadget  │
│  python     │                   └──────────┘               └──────────────────────────┘
└─────────────┘
```

要点：**端口是 App 进程里的 gadget 开的**，不是系统服务。所以：

- 目标 App 没运行 → 没人在 27052 监听；
- App 在后台被系统冻结 → 端口还在 LISTEN，但 gadget 线程停摆，连接会**挂住**（实测表现：`attach` 不返回，或被踢成 `Failed to spawn: connection closed`）。

---

## 2. 环境

```bash
cd zygisk-gadget-stealth
python -m pip install -r requirements.txt     # frida==17.5.2 / frida-tools==14.5.2
```

| 组件 | 版本 | 说明 |
|---|---|---|
| `frida`（Python 包） | **17.5.2** | 必须与设备端 gadget 一致 |
| `frida-tools` | **14.5.2** | 14.11+ 会把 frida 连带升上去，别升 |
| 设备端 gadget | 17.5.2 | 本模块内置 |

验证：

```bash
frida --version            # 17.5.2
adb devices                # 有设备
```

---

## 3. 手机侧三步准备

```bash
# ① 切 listen 模式（script 模式没有端口，PC 连不上）
adb shell su -c 'sh /data/adb/modules/zygisk_gadget_stealth/gadget_ctl.sh mode listen'

# ② 端口转发（每次重新插拔 USB / 重启 adb 后都要做）
adb forward tcp:27052 tcp:27052

# ③ 把目标 App 拉到前台（后台会被冻结）
adb shell am force-stop com.example.app
adb shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1

# 确认有人监听
adb shell su -c 'netstat -tln | grep 27052'
```

> `script` 模式与 `listen` 模式互斥。调试完记得切回 `script`（零端口最隐蔽），否则每次都白开一个端口。

---

## 4. 四种连接方式

### 方式 A：`tools/load_hook.py`（推荐，最省事）

```bash
# 列进程
python tools/load_hook.py --ps

# 加载脚本，跑 5 秒退出
python tools/load_hook.py --script docs/hooks/00-hello.js --forward --seconds 5

# 一直跑，Ctrl+C 退出；日志同时存盘
python tools/load_hook.py --script docs/hooks/dist/03-crypto-hook.js --out run.log

# 端口不是默认值时
python tools/load_hook.py --host 127.0.0.1:27099 --script my.js
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--host` | `127.0.0.1:27052` | gadget 地址 |
| `--script` | 必填 | 要加载的 js（Java 脚本必须用 `dist/` 里打包后的） |
| `--pid` | 自动找 `Gadget` | 指定进程 |
| `--forward` | 关 | 自动执行 `adb forward` |
| `--seconds` | `0` | 跑 N 秒退出，0 = 一直跑 |
| `--out` | 无 | 日志另存文件 |
| `--ps` | — | 只列进程 |

### 方式 B：frida CLI

```bash
# 拿 pid（gadget 只暴露一个进程，名字固定是 Gadget）
frida-ps -H 127.0.0.1:27052
#   PID  Name
# 20298  Gadget

# 用 pid 附着最稳（用名字当目标时，CLI 有时会误判成 spawn 而失败）
frida -H 127.0.0.1:27052 -p 20298 -l docs/hooks/00-hello.js -q
```

用名字的写法（能用，但不稳定）：

```bash
frida -H 127.0.0.1:27052 Gadget -l my.js
```

进交互后常用命令：

| 命令 | 作用 |
|---|---|
| `%resume` | 恢复被挂起的进程（`on_load: wait` 时用） |
| `%reload` | 重载当前脚本 |
| `%script` / `%scripts` | 看已加载脚本 |
| `%exit` | 断开（不会杀 App） |

### 方式 C：frida-trace（不想写脚本时）

```bash
frida-trace -H 127.0.0.1:27052 -p 20298 -i "SSL_read" -i "SSL_write"
frida-trace -H 127.0.0.1:27052 -p 20298 -i "open*" -X "*.so"
```

实测会打印 `Started tracing N functions`，并在 `http://localhost:34479/` 起一个本地 Web UI 看调用树。

### 方式 D：Python API（自己写工具）

```python
import frida, time

dev = frida.get_device_manager().add_remote_device("127.0.0.1:27052")
procs = dev.enumerate_processes()
target = next(p for p in procs if p.name == "Gadget")

session = dev.attach(target.pid)
script = session.create_script(open("docs/hooks/00-hello.js", encoding="utf-8").read())
script.on("message", lambda m, d: print(m.get("payload", m)))
script.load()
time.sleep(5)
session.detach()
```

> 建议先 `enumerate_processes()` 拿 pid 再 attach。Python 侧 `attach("Gadget")` 一般也能用，但 CLI 用名字时可能误走 spawn 分支，统一用 pid 可以避开这类玄学。

---

## 5. 加载什么脚本

| 脚本类型 | 例子 | 直接 `-l` 加载 | 说明 |
|---|---|---|---|
| 纯 Native | `00-hello.js`、`01-native-trace.js`、`04-jni-register.js` | ✅ | 单文件即可 |
| 用 Java bridge | `02-ssl-bypass.js`、`03-crypto-hook.js` | ❌ | 必须先 `npm run build`，加载 `dist/*.js` |

未打包就加载会直接报（实测）：

```
frida.InvalidArgumentError: script(line 11): SyntaxError: expecting '('
```

打包：

```bash
cd docs/hooks && npm install && npm run build
# dist/02-ssl-bypass.js 约 520 KB（内联 java bridge）
```

加载打包产物：

```bash
python tools/load_hook.py --script docs/hooks/dist/02-ssl-bypass.js
```

---

## 6. 关于「冷启动」的限制

gadget 是**进程内**的 agent，不是 spawn 型的 server，所以：

- ❌ `frida -f com.example.app`（spawn）不适用；
- ✅ 想 hook 得早，靠 `delay_ms` 把它调到「App 初始化之后、业务逻辑之前」，或者干脆用 `script` 模式让它在真机上自动跑；
- ✅ `listen` 模式下 gadget 默认 `on_load: resume`，App 不会停在启动页等你；要手动控制时机，把 `gadget.config` 改成 `wait` 再 `%resume`。

改了 `delay_ms` 之后要 `reload` + 重启 App 才生效，这点和手机端一致。

---

## 7. 典型工作流

```
① 先用 01-native-trace 看它连了哪、读了什么
        ↓ 有 HTTPS 但抓不到明文 / 抓包工具提示证书错误
② 上 02-ssl-bypass 过 pin，再抓
        ↓ 参数是密文，看不出结构
③ 上 03-crypto-hook 抓算法 + key + 明文
        ↓ 关键逻辑在 native，Java 层只是壳
④ 上 04-jni-register 拿 RegisterNatives 映射，再 Interceptor 具体函数
        ↓ 调通了
⑤ 把 final.js push 成 /data/local/tmp/.gsys/hook.js，切回 script 模式，重启 App
```

第 ⑤ 步就是从「PC 调试」转到「手机持久化」：

```bash
adb push final.js /data/local/tmp/gs_final.js
adb shell su -c 'cp /data/local/tmp/gs_final.js /data/local/tmp/.gsys/hook.js'
adb shell su -c 'chcon u:object_r:system_file:s0 /data/local/tmp/.gsys/hook.js'
adb shell su -c 'sh /data/adb/modules/zygisk_gadget_stealth/gadget_ctl.sh mode script'
adb shell am force-stop com.example.app
adb shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1
```

---

## 8. 报错对照表（都是实测遇到的）

| 报错 / 现象 | 原因 | 处理 |
|---|---|---|
| `Failed to spawn: connection closed` | 拿 `Gadget` 当目标名去 attach，CLI 走了 spawn 分支；或 App 被冻结 | 用 `-p <pid>`；把 App 拉到前台 |
| `attach` 卡住不返回 | App 在后台被系统冻结（`ps` 里是 `do_freezer_trap`） | `am start` 拉回前台再连 |
| `unable to find process with name 'Gadget'` | 手机端不是 `listen` 模式，或 App 没在跑 | `mode listen` + 重启 App + `adb forward` |
| `SyntaxError: expecting '('` | 加载了未打包的 Java 脚本 | `npm run build` 后用 `dist/` 产物 |
| `Java is not defined` | 同上 | 同上 |
| `TypeError: not a function` | 脚本用了 frida 17 已删的 `Module.findExportByName` | 改 `findGlobal` / 模块实例 `findExportByName` |
| `frida-ps` 能列出来但脚本收了不到日志 | 脚本用了 `console.log`，但 `no_log=1` 只影响 logcat，不影响 PC | PC 侧应能收到；收不到说明脚本没 `load` 成功 |
| 连上后手机 App 卡死 | 脚本里有死循环 / 在 `onEnter` 里做了重活 | 断开（`%exit`），改脚本，减小 `delay_ms` 冲突面 |

---

## 9. 和 frida-server 怎么选

| | 本模块 gadget（27052） | frida-server（39527） |
|---|---|---|
| 连接方式 | `adb forward` + `-H` | `frida -U` 直接可见 |
| 能 attach 谁 | 只有 `target` 白名单里的 App，且只有一个 `Gadget` 条目 | 整机任意进程 |
| spawn | 不支持 | 支持 |
| 持久化 | 随 App 启动自动注入 | 需要常驻守护进程 |
| 隐蔽性 | 零端口（script 模式）+ maps/线程名处理 | 进程名可扫、maps 有 agent |

**不要用 frida-server 去 attach 已经加载 gadget 的进程** —— 两份 Gum 在同一地址做 inline hook 会互相踩，轻则脚本失效，重则 App 崩溃。

---

## 10. 边界

- 只对自有设备或已授权目标使用。
- `listen` 模式会开端口，调试完切回 `script`。
- PC 端断开（`%exit` / `detach`）不会杀 App，也不会清掉已装的钩子 —— 脚本还在进程里跑到 App 结束。
