/*
 * 02-ssl-bypass.js —— Java 层 SSL Pinning 绕过（需 frida-compile 打包）
 *
 * 覆盖：自定义 TrustManager、OkHttp CertificatePinner、HostnameVerifier、Conscrypt 链校验。
 * 打包：cd docs/hooks && npm install && npm run build:ssl
 * 产物：docs/hooks/dist/02-ssl-bypass.js → 推到手机当 hook.js 用
 *
 * 注意：frida 17 起 GumJS 不再内置 Java，必须 import 'frida-java-bridge' 并打包，
 *      不能直接把本文件丢到 /data/local/tmp/.gsys/hook.js（会报 Java is not defined）。
 */
import Java from 'frida-java-bridge';

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
function ok(name) { log('[ok  ] ' + name); }
function skip(name, e) { log('[skip] ' + name + ' :: ' + e.message); }

Java.perform(function () {
  log('=== gs-ssl-bypass === pid=' + Process.id);

  /* 1. 全局替换 SSLContext.init 的 TrustManager —— 覆盖绝大多数自签/抓包场景 */
  try {
    var X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
    var TrustAll = Java.registerClass({
      name: 'gs.TrustAllManager',
      implements: [X509TrustManager],
      methods: {
        checkClientTrusted: function () {},
        checkServerTrusted: function () {},
        getAcceptedIssuers: function () {
          return Java.array('java.security.cert.X509Certificate', []);
        }
      }
    });
    var SSLContext = Java.use('javax.net.ssl.SSLContext');
    var init = SSLContext.init.overload(
      '[Ljavax.net.ssl.KeyManager;',
      '[Ljavax.net.ssl.TrustManager;',
      'java.security.SecureRandom'
    );
    init.implementation = function (km, tm, sr) {
      log('[ssl] SSLContext.init -> trust-all');
      return init.call(this, km, [TrustAll.$new()], sr);
    };
    ok('SSLContext.init');
  } catch (e) { skip('SSLContext.init', e); }

  /* 2. Conscrypt 的链路校验（系统默认实现） */
  try {
    var TMI = Java.use('com.android.org.conscrypt.TrustManagerImpl');
    TMI.verifyChain.implementation = function () {
      log('[ssl] TrustManagerImpl.verifyChain -> 放行');
      return arguments[0];
    };
    ok('TrustManagerImpl.verifyChain');
  } catch (e) { skip('TrustManagerImpl.verifyChain', e); }

  /* 3. OkHttp 的 CertificatePinner（最常见的一道 pin） */
  ['okhttp3.CertificatePinner', 'com.squareup.okhttp.CertificatePinner'].forEach(function (cn) {
    try {
      var CP = Java.use(cn);
      CP.check.overload('java.lang.String', 'java.util.List').implementation = function (h, l) {
        log('[ssl] ' + cn + '.check(' + h + ') -> 放行');
      };
      ok(cn + '.check(String,List)');
    } catch (e) { skip(cn + '.check(String,List)', e); }
    try {
      var CP2 = Java.use(cn);
      CP2.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;').implementation = function (h) {
        log('[ssl] ' + cn + '.check(' + h + ') -> 放行');
      };
      ok(cn + '.check(String,Certificate[])');
    } catch (e) { skip(cn + '.check(String,Certificate[])', e); }
  });

  /* 4. HostnameVerifier 一律通过（证书对但域名不匹配的情况） */
  try {
    var HV = Java.use('javax.net.ssl.HostnameVerifier');
    var classes = Java.enumerateLoadedClassesSync().filter(function (n) {
      return /HostnameVerifier/.test(n) && n.indexOf('gs.') !== 0;
    });
    var hit = 0;
    classes.forEach(function (n) {
      try {
        var C = Java.use(n);
        var m = C.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession');
        m.implementation = function (h) { log('[ssl] ' + n + '.verify(' + h + ') -> true'); return true; };
        hit++;
      } catch (e) {}
    });
    log('[ssl] HostnameVerifier 实现命中 ' + hit + ' 个');
  } catch (e) { skip('HostnameVerifier', e); }

  log('=== ssl bypass ready ===');
});
