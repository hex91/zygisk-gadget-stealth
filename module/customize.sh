#!/system/bin/sh
# KernelSU / SukiSU / Magisk 安装钩子
# zip 由管理器自动解包到 $MODPATH，这里只负责把 gadget 放到 App 可读的位置
MODID=zygisk_gadget_stealth
DEFAULT_DATA=/data/local/tmp/.gsys
REDIRECT=/data/local/tmp/.gsys_redirect

DATA="$DEFAULT_DATA"
if [ -f "$REDIRECT" ]; then
  _r=$(head -1 "$REDIRECT" 2>/dev/null)
  case "$_r" in /*) DATA=${_r%/} ;; esac
fi

BB=""
for p in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /data/adb/ap/bin/busybox; do
  [ -x "$p" ] && BB="$p" && break
done
if [ -z "$BB" ]; then
  echo "! 未找到 busybox，无法解压 gadget"
  exit 1
fi

mkdir -p "$DATA"
chmod 755 "$DATA"

# 官方 frida-gadget 17.5.2，改成中性文件名
$BB unxz -c "$MODPATH/gadget/libgadget-arm64.so.xz" > "$DATA/libgcore.so" 2>/dev/null
$BB unxz -c "$MODPATH/gadget/libgadget-arm.so.xz"    > "$DATA/libgcore32.so" 2>/dev/null
chmod 644 "$DATA/libgcore.so" "$DATA/libgcore32.so"

# 首次安装才写默认配置，升级不覆盖用户配置
[ -f "$DATA/settings.conf" ] || cat "$MODPATH/settings.default.conf" > "$DATA/settings.conf"
[ -f "$DATA/hook.js" ]       || cat "$MODPATH/hook.default.js"       > "$DATA/hook.js"
chmod 644 "$DATA/settings.conf" "$DATA/hook.js"

chmod 755 "$MODPATH"/*.sh 2>/dev/null
chmod 644 "$MODPATH/module.prop" 2>/dev/null

# 生成 <lib_name>.config + 刷新模块说明
sh "$MODPATH/gadget_ctl.sh" reload >/dev/null 2>&1

echo "- frida-gadget 17.5.2: $DATA/libgcore.so"
echo "- 配置: $DATA/settings.conf"
echo "- 状态: sh $MODPATH/gadget_ctl.sh status"
