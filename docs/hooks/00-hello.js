/*
 * 00-hello.js —— 最小可用模板（纯 Native，无需编译）
 *
 * 用途：确认 hook.js 真的被加载、拿到当前进程信息、并在 App 私有目录留一条证据。
 * 用法：复制到 /data/local/tmp/.gsys/hook.js 后，force-stop 目标 App 再启动。
 * 验证：sh gadget_ctl.sh showlog   或   cat /data/user/0/<包名>/gs-hook.log
 */
'use strict';

/* ---------- 通用：日志同时写 console 与 App 私有目录 ---------- */
var PKG = (function () {
  try {
    var raw = File.readAllBytes('/proc/self/cmdline');
    var u8 = new Uint8Array(raw), s = '';
    for (var i = 0; i < u8.length && u8[i] !== 0; i++) s += String.fromCharCode(u8[i]);
    return s.split(':')[0];
  } catch (e) { return null; }
})();
var LOGPATH = PKG ? ('/data/user/0/' + PKG + '/gs-hook.log') : null;

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
      f.flush();
      f.close();
    } catch (e) {}
  }
  IN_LOG = false;
}

/* ---------- 正文 ---------- */
log('=== gs-hello ===');
log('pid   =', Process.id);
log('arch  =', Process.arch);
log('page  =', Process.pageSize);
log('pkg   =', PKG || 'unknown');
log('frida =', Frida.version);
log('runtime =', Script.runtime);
log('modules =', Process.enumerateModules().length);

/* 统计一下前 10 个已加载的 so，确认能在进程里看到东西 */
Process.enumerateModules().slice(0, 10).forEach(function (m) {
  log('  mod ' + m.name + ' @ ' + m.base + ' (' + m.size + ')');
});

log('=== 如果看到这些行，说明 hook.js 已经跑起来了 ===');
