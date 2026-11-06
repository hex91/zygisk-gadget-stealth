#!/system/bin/sh
# 卸载时清掉我们放在 /data/local/tmp 与 App 私有目录的文件
DATA=/data/local/tmp/.gsys
if [ -f /data/local/tmp/.gsys_redirect ]; then
  _r=$(head -1 /data/local/tmp/.gsys_redirect 2>/dev/null)
  case "$_r" in /*) DATA=${_r%/} ;; esac
fi

for p in $(awk -F= '$1=="target"{split($2,a,",");print a[1]}' "$DATA/settings.conf" 2>/dev/null); do
  rm -f /data/data/$p/.gs_state.* /data/user/0/$p/.gs_state.* /data/data/$p/gs_proof.txt 2>/dev/null
done

rm -f "$DATA/libgcore.so" "$DATA/libgcore32.so" \
      "$DATA/libgcore.config" "$DATA/libgcore.config.so" \
      "$DATA/libgcore32.config" "$DATA/libgcore32.config.so" \
      "$DATA/hook.js" "$DATA/settings.conf" "$DATA/.ctl.tmp" 2>/dev/null
rmdir "$DATA" 2>/dev/null
rm -f /data/local/tmp/.gsys_redirect 2>/dev/null
