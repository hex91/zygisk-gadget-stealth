// 默认 script 模式脚本（frida-gadget 17.5.2）
// 作用：在 App 私有目录写一条证据，证明 gadget 确实随 App 启动执行了。
// 你的实际 hook 逻辑直接写在这个文件里即可，改完 App 重启会自动 reload。
try {
  var raw = File.readAllBytes('/proc/self/cmdline');
  var u = new Uint8Array(raw);
  var pkg = '';
  for (var i = 0; i < u.length && u[i] !== 0; i++) {
    pkg += String.fromCharCode(u[i]);
  }
  var line = 'pid=' + Process.id +
             ' frida=' + Frida.version +
             ' arch=' + Process.arch +
             ' modules=' + Process.enumerateModules().length + '\n';
  File.writeAllText('/data/data/' + pkg + '/gs_proof.txt', line);
} catch (e) {
  // 静默：不要因为占位脚本抛异常影响 App
}
