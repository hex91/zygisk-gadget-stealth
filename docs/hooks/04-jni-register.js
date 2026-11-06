/*
 * 04-jni-register.js —— JNI 动态注册枚举 + 指定 native 方法追踪（纯 Native，无需编译）
 *
 * 背景：很多加固/风控 App 用 RegisterNatives 动态注册 JNI 方法，Java 层看不到实现，
 *      静态分析也很难定位。这里在注册那一刻把 [Java 方法名 → 函数地址] 全打出来，
 *      之后可以直接按名字 hook 对应地址。
 *
 * 用法：
 *   1) 先只开 dump，跑一遍，拿到方法名/地址清单（写进 gs-hook.log）；
 *   2) 把感兴趣的方法名填到 CFG.watch，再跑一次，打印调用参数与返回值。
 */
'use strict';

var CFG = {
  dumpAll: true,              // 打印所有 RegisterNatives 注册项
  watch: /decrypt|encrypt|sign|verify|check|native/i,  // 命中这些名字就挂 Interceptor
  dumpArgs: 4,                // 打印前几个参数
  maxBytes: 64
};

/* ---------- 日志 ---------- */
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
    try { var f = new File(LOGPATH, 'a'); f.write(new Date().toISOString() + ' ' + line + '\n'); f.flush(); f.close(); } catch (e) {}
  }
  IN_LOG = false;
}

/* ---------- 找 RegisterNatives ---------- */
function findGlobal(name) {
  if (typeof Module.findGlobalExportByName === 'function') {
    try { return Module.findGlobalExportByName(name); } catch (e) { return null; }
  }
  try { return Module.findExportByName(null, name); } catch (e) { return null; }
}

function findRegisterNatives() {
  var direct = findGlobal('RegisterNatives');
  if (direct) return { addr: direct, how: 'export' };
  var libart = Process.findModuleByName('libart.so');
  if (!libart || typeof libart.enumerateSymbols !== 'function') return null;
  var syms = libart.enumerateSymbols();
  for (var i = 0; i < syms.length; i++) {
    if (syms[i].name.indexOf('RegisterNatives') >= 0 && syms[i].address) {
      return { addr: syms[i].address, how: syms[i].name };
    }
  }
  return null;
}

function cstr(p) {
  if (!p || p.isNull()) return null;
  try { return p.readUtf8String(); } catch (e) { return null; }
}

var hookedFns = {};   // 避免重复 hook 同一地址

function watchNative(name, sig, addr) {
  var key = addr.toString();
  if (hookedFns[key]) return;
  hookedFns[key] = true;
  Interceptor.attach(addr, {
    onEnter: function (args) {
      this.tid = Process.getCurrentThreadId();
      var parts = [];
      for (var i = 0; i < CFG.dumpArgs; i++) parts.push('a' + i + '=' + args[i]);
      log('[jni-call] ' + name + sig + ' tid=' + this.tid + ' ' + parts.join(' '));
    },
    onLeave: function (ret) {
      log('[jni-ret ] ' + name + sig + ' => ' + ret);
    }
  });
}

function install() {
  var found = findRegisterNatives();
  if (!found) { log('[jni] RegisterNatives 未找到，跳过'); return; }
  log('[jni] RegisterNatives @ ' + found.addr + ' (' + found.how + ')');

  var ptrSize = Process.pointerSize;
  var entrySize = ptrSize * 3;   // { const char* name; const char* signature; void* fnPtr; }

  Interceptor.attach(found.addr, {
    onEnter: function (args) {
      var arr = args[2];
      var count = args[3].toInt32();
      if (arr.isNull() || count <= 0 || count > 4096) return;
      for (var i = 0; i < count; i++) {
        var base = arr.add(i * entrySize);
        var nameP = base.readPointer();
        var sigP = base.add(ptrSize).readPointer();
        var fnP = base.add(ptrSize * 2).readPointer();
        var name = cstr(nameP), sig = cstr(sigP);
        if (!name) continue;
        if (CFG.dumpAll) log('[jni-reg] ' + name + sig + ' -> ' + fnP);
        if (CFG.watch.test(name) && !fnP.isNull()) watchNative(name, sig || '', fnP);
      }
    }
  });
  log('[jni] 已挂 RegisterNatives，等待注册...');
}

install();
