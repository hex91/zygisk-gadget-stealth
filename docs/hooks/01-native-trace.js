/*
 * 01-native-trace.js —— Native 层通用追踪（纯 Native，无需编译）
 *
 * 覆盖：so 加载、文件打开、SSL 明文（BoringSSL）、常用字符串比较。
 * 适合：不知道从哪下手时先跑一遍，看 App 读了什么、连了什么、so 加载顺序。
 *
 * 注意：open/openat 量非常大，默认关闭；开启后务必用 keyword 过滤。
 * 递归保护：本脚本自己写日志会触发 open → 用 IN_LOG 标记掐断。
 */
'use strict';

var CFG = {
  dlopen: true,
  files: false,          // 打开文件追踪（量大）
  fileKeyword: '',       // 只记录路径含该子串的 open，如 '.so' / 'shared_prefs'
  ssl: true,             // SSL_read / SSL_write 明文
  strcmp: false,         // 字符串比较（逆向校验逻辑时再开）
  strcmpKeyword: 'licen',// 只记录参数含该子串的 strcmp
  maxBytes: 200          // 单次最多打印字节数
};

/* ---------- 日志：console + App 私有目录 ---------- */
var LOGPATH = (function () {
  try {
    var raw = File.readAllBytes('/proc/self/cmdline');
    var u8 = new Uint8Array(raw), s = '';
    for (var i = 0; i < u8.length && u8[i] !== 0; i++) s += String.fromCharCode(u8[i]);
    return '/data/user/0/' + s.split(':')[0] + '/gs-hook.log';
  } catch (e) { return null; }
})();

var IN_LOG = false;
function log() {
  if (IN_LOG) return;
  IN_LOG = true;
  var line = Array.prototype.slice.call(arguments).join(' ');
  try { console.log(line); } catch (e) {}
  if (LOGPATH) {
    try {
      var f = new File(LOGPATH, 'a');
      f.write(new Date().toISOString() + ' ' + line + '\n');
      f.flush(); f.close();
    } catch (e) {}
  }
  IN_LOG = false;
}

function safeStr(p, max) {
  if (p.isNull()) return '<null>';
  try { return JSON.stringify(p.readUtf8String(Math.min(max || CFG.maxBytes, 512))); }
  catch (e) { return '<unreadable>'; }
}

/* ---------- 导出查找：兼容 frida 16 与 17 ----------
 * frida 17 删掉了 Module.findExportByName(null, name) 和 Module.getExportByName(mod, name)
 * 17 的新写法：Module.findGlobalExportByName(name) / 模块实例 m.findExportByName(name)
 */
function findGlobal(name) {
  if (typeof Module.findGlobalExportByName === 'function') {
    try { return Module.findGlobalExportByName(name); } catch (e) { return null; }
  }
  try { return Module.findExportByName(null, name); } catch (e) { return null; }
}
function findIn(moduleName, name) {
  var m = Process.findModuleByName(moduleName);
  if (!m) return null;
  try { return m.findExportByName(name); } catch (e) { return null; }
}

/* ---------- 1. so 加载 ---------- */
function hookDlopen() {
  ['dlopen', 'android_dlopen_ext'].forEach(function (name) {
    var addr = findGlobal(name);
    if (!addr) return;
    Interceptor.attach(addr, {
      onEnter: function (args) {
        this.path = safeStr(args[0]);
      },
      onLeave: function (ret) {
        if (ret.isNull()) return;
        log('[dlopen] ' + this.path);
      }
    });
  });
}

/* ---------- 2. 文件打开 ---------- */
function hookFiles() {
  ['open', 'openat', 'fopen'].forEach(function (name) {
    var addr = findGlobal(name);
    if (!addr) return;
    Interceptor.attach(addr, {
      onEnter: function (args) {
        if (IN_LOG) return;
        var p = (name === 'openat') ? args[1] : args[0];
        var s = safeStr(p, 300);
        if (CFG.fileKeyword && s.indexOf(CFG.fileKeyword) < 0) return;
        log('[' + name + '] ' + s);
      }
    });
  });
}

/* ---------- 3. SSL 明文 ---------- */
function hookSsl() {
  var targets = [
    { name: 'SSL_read',  bufIdx: 1, lenIdx: 2, dir: 'S->C' },
    { name: 'SSL_write', bufIdx: 1, lenIdx: 2, dir: 'C->S' }
  ];
  targets.forEach(function (t) {
    var addr = findIn('libssl.so', t.name) || findGlobal(t.name);
    if (!addr) { log('[ssl] ' + t.name + ' 未找到（App 可能用 Cronet/BoringSSL 静态链接）'); return; }
    Interceptor.attach(addr, {
      onEnter: function (args) {
        this.buf = args[t.bufIdx];
        this.want = args[t.lenIdx].toInt32();
      },
      onLeave: function (ret) {
        var n = ret.toInt32();
        if (n <= 0 || this.buf.isNull()) return;
        var take = Math.min(n, CFG.maxBytes);
        var body;
        try { body = JSON.stringify(this.buf.readUtf8String(take)); }
        catch (e) { body = '<binary ' + n + 'B> ' + hexdump(this.buf, { length: Math.min(take, 32), ansi: false }); }
        log('[ssl ' + t.dir + '] ' + t.name + ' ' + n + 'B ' + body);
      }
    });
    log('[ssl] hooked ' + t.name + ' @ ' + addr);
  });
}

/* ---------- 4. 字符串比较（可选） ---------- */
function hookStrcmp() {
  ['strcmp', 'strncmp'].forEach(function (name) {
    var addr = findGlobal(name);
    if (!addr) return;
    Interceptor.attach(addr, {
      onEnter: function (args) {
        if (IN_LOG) return;
        var a = safeStr(args[0], 120), b = safeStr(args[1], 120);
        if (CFG.strcmpKeyword && (a + b).toLowerCase().indexOf(CFG.strcmpKeyword.toLowerCase()) < 0) return;
        log('[' + name + '] ' + a + ' vs ' + b);
      }
    });
  });
}

/* ---------- 启动 ---------- */
log('=== gs-native-trace === pid=' + Process.id + ' arch=' + Process.arch);
if (CFG.dlopen) hookDlopen();
if (CFG.files) hookFiles();
if (CFG.ssl) hookSsl();
if (CFG.strcmp) hookStrcmp();
log('=== hooks installed ===');
