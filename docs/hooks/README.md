# hook 模板集

配套文档：[手机端使用说明](../手机端使用说明.md) · [PC端使用说明](../PC端使用说明.md)

| 文件 | 需要打包 | 用途 |
|---|---|---|
| `00-hello.js` | 否 | 验证链路：pid / arch / 包名 / frida 版本 / 已加载 so |
| `01-native-trace.js` | 否 | dlopen / open / SSL 明文 / strcmp |
| `02-ssl-bypass.js` | ✅ | TrustManager / OkHttp Pinner / HostnameVerifier / Conscrypt |
| `03-crypto-hook.js` | ✅ | Cipher / MessageDigest / HMAC / SecretKeySpec / IV / Base64 |
| `04-jni-register.js` | 否 | 枚举 RegisterNatives 注册的 native 方法并追踪调用 |

## 编译 Java 模板

```bash
cd docs/hooks
npm install
npm run build            # 产出 dist/02-ssl-bypass.js、dist/03-crypto-hook.js
```

`npm install` 时如果提示 frida 的安装脚本被拦截，执行：

```bash
npm install-scripts approve frida
npm rebuild frida --foreground-scripts
```

## 怎么用

**PC 调试（listen 模式）**

```bash
python tools/load_hook.py --script docs/hooks/01-native-trace.js
python tools/load_hook.py --script docs/hooks/dist/02-ssl-bypass.js
```

**手机持久化（script 模式）**

```bash
adb push docs/hooks/01-native-trace.js /data/local/tmp/gs_hook.js
adb shell su -c 'cp /data/local/tmp/gs_hook.js /data/local/tmp/.gsys/hook.js'
adb shell su -c 'chcon u:object_r:system_file:s0 /data/local/tmp/.gsys/hook.js'
adb shell am force-stop <包名>
```

日志：`/data/user/0/<包名>/gs-hook.log`

## 写自己的模板

- 纯 Native：复制 `01-native-trace.js`，改 `CFG` 和正文，注意用 `findGlobal()` / `findIn()` 而不是 `Module.findExportByName`。
- 用到 `Java`：复制 `02`/`03` 的开头 `import Java from 'frida-java-bridge'`，在 `package.json` 里加一条 `frida-compile` 脚本。
- 日志：直接复用模板里的 `log()`，它会同时写 console 和 App 私有目录，并且自带递归保护（hook `open` 时必看）。
