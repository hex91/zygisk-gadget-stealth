/*
 * 03-crypto-hook.js —— Java 加密算法 Hook（需 frida-compile 打包）
 *
 * 抓什么：Cipher.doFinal 的算法/输入/输出、MessageDigest 摘要、Mac(HMAC)、
 *        SecretKeySpec（密钥）、IvParameterSpec（IV）、Base64。
 * 典型用途：看清 App 的请求签名/参数加密，拿到 key 后离线复现。
 *
 * 打包：cd docs/hooks && npm install && npm run build:crypto
 * 产物：docs/hooks/dist/03-crypto-hook.js
 */
import Java from 'frida-java-bridge';

var CFG = {
  algoFilter: /AES|DES|RSA|HMAC|SHA|MD5|SM4|SM3/i,  // 只关心这些算法，避免刷屏
  maxBytes: 96,      // 每次最多打印多少字节
  printKey: true
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
function skip(name, e) { log('[skip] ' + name + ' :: ' + e.message); }

/* ---------- 字节数组工具 ---------- */
function hex(jbytes, max) {
  if (!jbytes) return '<null>';
  var n = Math.min(jbytes.length, max || CFG.maxBytes);
  var s = '';
  for (var i = 0; i < n; i++) {
    var b = jbytes[i] & 0xff;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return jbytes.length > n ? s + '...(' + jbytes.length + 'B)' : s;
}
function text(jbytes, max) {
  if (!jbytes) return '';
  try {
    var String = Java.use('java.lang.String');
    var s = String.$new(jbytes).toString();
    var clean = s.replace(/[^\x20-\x7e\u4e00-\u9fa5]/g, '.');
    return ' | "' + clean.slice(0, max || 48) + '"';
  } catch (e) { return ''; }
}
function interesting(name) { return CFG.algoFilter.test(name); }

Java.perform(function () {
  log('=== gs-crypto-hook === pid=' + Process.id);

  /* 1. 密钥：SecretKeySpec 构造时把 key 打出来 */
  if (CFG.printKey) {
    try {
      var SKS = Java.use('javax.crypto.spec.SecretKeySpec');
      SKS.$init.overload('[B', 'java.lang.String').implementation = function (key, algo) {
        log('[key] ' + algo + ' len=' + key.length + 'B hex=' + hex(key, 64));
        return this.$init(key, algo);
      };
      log('[ok  ] SecretKeySpec');
    } catch (e) { skip('SecretKeySpec', e); }

    try {
      var IVS = Java.use('javax.crypto.spec.IvParameterSpec');
      IVS.$init.overload('[B').implementation = function (iv) {
        log('[iv ] len=' + iv.length + 'B hex=' + hex(iv, 32));
        return this.$init(iv);
      };
      log('[ok  ] IvParameterSpec');
    } catch (e) { skip('IvParameterSpec', e); }
  }

  /* 2. Cipher.doFinal —— 主菜 */
  try {
    var Cipher = Java.use('javax.crypto.Cipher');
    var alg = function (self) {
      try { return self.getAlgorithm(); } catch (e) { return '?'; }
    };

    Cipher.doFinal.overload('[B').implementation = function (input) {
      var a = alg(this);
      if (!interesting(a)) return this.doFinal(input);
      log('[cipher] ' + a + ' in=' + input.length + 'B hex=' + hex(input) + text(input));
      var out = this.doFinal(input);
      log('[cipher] ' + a + ' out=' + (out ? out.length : 0) + 'B hex=' + hex(out) + text(out));
      return out;
    };
    log('[ok  ] Cipher.doFinal([B)');

    Cipher.doFinal.overload('[B', 'int', 'int').implementation = function (input, off, len) {
      var a = alg(this);
      if (!interesting(a)) return this.doFinal(input, off, len);
      log('[cipher] ' + a + ' off=' + off + ' len=' + len + ' hex=' + hex(input));
      var out = this.doFinal(input, off, len);
      log('[cipher] ' + a + ' out=' + (out ? out.length : 0) + 'B hex=' + hex(out) + text(out));
      return out;
    };
    log('[ok  ] Cipher.doFinal([B,int,int)');
  } catch (e) { skip('Cipher.doFinal', e); }

  /* 3. 摘要：MessageDigest */
  try {
    var MD = Java.use('java.security.MessageDigest');
    MD.digest.overload('[B').implementation = function (input) {
      var a = this.getAlgorithm();
      if (interesting(a)) log('[digest] ' + a + ' in=' + input.length + 'B hex=' + hex(input) + text(input));
      var out = this.digest(input);
      if (interesting(a)) log('[digest] ' + a + ' out=' + hex(out, 32));
      return out;
    };
    log('[ok  ] MessageDigest.digest([B)');
  } catch (e) { skip('MessageDigest', e); }

  /* 4. HMAC */
  try {
    var Mac = Java.use('javax.crypto.Mac');
    Mac.doFinal.overload('[B').implementation = function (input) {
      var a = this.getAlgorithm();
      if (interesting(a)) log('[hmac] ' + a + ' in=' + hex(input) + text(input));
      var out = this.doFinal(input);
      if (interesting(a)) log('[hmac] ' + a + ' out=' + hex(out, 32));
      return out;
    };
    log('[ok  ] Mac.doFinal([B)');
  } catch (e) { skip('Mac', e); }

  /* 5. Base64（很多签名最后一步是 base64） */
  try {
    var B64 = Java.use('android.util.Base64');
    B64.encodeToString.overload('[B', 'int').implementation = function (data, flags) {
      var out = this.encodeToString(data, flags);
      log('[b64 ] in=' + data.length + 'B -> ' + (out ? out.substring(0, 64) : 'null'));
      return out;
    };
    log('[ok  ] Base64.encodeToString');
  } catch (e) { skip('Base64', e); }

  log('=== crypto hooks ready ===');
});
