#!/system/bin/sh
# zygisk-gadget-stealth 管理脚本
# 设备侧: sh /data/adb/modules/zygisk_gadget_stealth/gadget_ctl.sh <子命令>
# WebUI 用的 status1 / check1 / info1 均为「单行 key=value」输出
# ------------------------------------------------------------------
MODID=zygisk_gadget_stealth
MODDIR=${0%/*}
[ -d "$MODDIR" ] || MODDIR=/data/adb/modules/$MODID
DEFAULT_DATA=/data/local/tmp/.gsys
REDIRECT=/data/local/tmp/.gsys_redirect
GVER=17.5.2
MODVER=1.0.1
UPSTREAM=https://github.com/frida/frida
RELEASE=https://github.com/frida/frida/releases/tag/17.5.2
REFMODULE=https://github.com/lico-n/ZygiskFrida
LIC='wxWindows Library Licence'

DATA="$DEFAULT_DATA"
[ -f "$REDIRECT" ] && _r=$(head -1 "$REDIRECT" 2>/dev/null)
case "${_r:-}" in /*) DATA=${_r%/} ;; esac
CONF="$DATA/settings.conf"
TMP="$DATA/.ctl.tmp"

v() { # 读配置项
  _val=$(awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/,""); print}' "$CONF" 2>/dev/null | tail -1)
  _val=$(echo "$_val" | tr -d ' \t\r')
  [ -n "$_val" ] && echo "$_val" || echo "$2"
}
setv() { # 写配置项（cat 覆盖，保持 inode / SELinux context）
  _k="$1"; _val="$2"
  awk -F= -v k="$_k" -v v="$_val" '
    $1==k {print k "=" v; done=1; next} {print}
    END {if(!done) print k "=" v}
  ' "$CONF" > "$TMP" 2>/dev/null
  cat "$TMP" > "$CONF"; rm -f "$TMP"
  echo "OK;msg=$_k=$_val"
}
targets_raw() { awk -F= '$1=="target"{print $2}' "$CONF" 2>/dev/null; }
target_names() { targets_raw | awk -F, '{print $1}' | grep -v '^$'; }

cfg_name() { echo "${1%.so}"; }

sync_prop() {
  _mode=$(v mode script); _port=$(v port 27052)
  _n=$(target_names | wc -l | tr -d ' ')
  _en=$(v enabled 1)
  [ "$_mode" = script ] && _p='端口: 无(script)' || _p="端口: 127.0.0.1:$_port"
  [ "$_en" = 1 ] && _st='' || _st=' [已停用]'
  cat > "$MODDIR/module.prop" <<EOF
id=$MODID
name=Gadget Stealth
version=$MODVER
versionCode=10000
author=hex91
description=frida-gadget $GVER (Zygisk) | 模式: $_mode | $_p | 目标: $_n | 去特征: maps+线程 | 打开 WebUI 查看状态$_st
EOF
}

gen_gadget_cfg() {
  _mode=$(v mode script); _port=$(v port 27052)
  _l64=$(v lib_name libgcore.so); _l32=$(v lib_name32 libgcore32.so)
  [ -f "$DATA/hook.js" ] || cat "$MODDIR/hook.default.js" > "$DATA/hook.js"
  if [ "$_mode" = listen ]; then
    _js="{\"interaction\":{\"type\":\"listen\",\"address\":\"127.0.0.1\",\"port\":$_port,\"on_port_conflict\":\"pick-next\",\"on_load\":\"resume\"}}"
  else
    _js="{\"interaction\":{\"type\":\"script\",\"path\":\"$DATA/hook.js\",\"on_change\":\"reload\"}}"
  fi
  for _l in "$_l64" "$_l32"; do
    _stem=$(cfg_name "$_l")
    echo "$_js" > "$TMP"
    cat "$TMP" > "$DATA/$_stem.config";       chmod 644 "$DATA/$_stem.config"
    cat "$TMP" > "$DATA/$_stem.config.so";    chmod 644 "$DATA/$_stem.config.so"
  done
  rm -f "$TMP"
  chmod 644 "$DATA/hook.js"
}

clear_states() {
  for _p in $(target_names); do
    rm -f /data/data/$_p/.gs_state.* /data/user/0/$_p/.gs_state.* 2>/dev/null
  done
}

fix_context() {
  # /data/local/tmp 下新文件默认是 shell_data_file，untrusted_app 不允许 execute，
  # dlopen 会被 SELinux 拒绝。参考 ZygiskFrida：统一改成 system_file。
  chcon -R u:object_r:system_file:s0 "$DATA" 2>/dev/null
}

reload() {
  mkdir -p "$DATA" 2>/dev/null
  gen_gadget_cfg
  fix_context
  clear_states
  sync_prop
  echo "OK;msg=配置已生成，重启目标 App 生效"
}

zy_loaded() {
  grep -q "$MODID" /data/adb/zygisksu/modules_info 2>/dev/null && return 0
  grep -q "$MODID" /data/adb/magisk/zygisk/modules_info 2>/dev/null && return 0
  return 1
}

state_summary() { # 输出: 活动数 最新"pkg:pid"
  # 只扫 /data/data：在多用户设备上它就是当前用户的 /data/user/<id> 的入口，
  # 两个路径都扫会把同一份状态重复计数。
  _cnt=0; _last=-
  for _p in $(target_names); do
    for _f in /data/data/$_p/.gs_state.*; do
      [ -f "$_f" ] || continue
      grep -q '^ok=1' "$_f" || continue
      _cnt=$((_cnt+1))
      _pid=$(awk -F'[;=]' '{for(i=1;i<=NF;i++) if($i=="pid") print $(i+1)}' "$_f" 2>/dev/null | head -1)
      _last="$_p:${_pid:-?}"
    done
  done
  echo "$_cnt $_last"
}

status1() {
  _en=$(v enabled 1); _mode=$(v mode script); _port=$(v port 27052)
  _delay=$(v delay_ms 1200); _maps=$(v hide_maps 1); _thr=$(v hide_threads 1)
  _nolog=$(v no_log 1); _lib=$(v lib_name libgcore.so)
  _tg=$(target_names | awk 'NR>1{printf "|"}{printf "%s",$0}END{print ""}' 2>/dev/null)
  _tinfo=$(targets_raw | awk -F, 'NR>1{printf "|"}{printf "%s:%s:%s",$1,$2,$3}END{print ""}' 2>/dev/null)
  _sum=$(state_summary); _cnt=${_sum%% *}; _last=${_sum#* }
  _zy=0; zy_loaded && _zy=1
  _cfg=0; [ -f "$CONF" ] && _cfg=1
  _l64=0; [ -f "$DATA/$_lib" ] && _l64=1
  echo "OK;ver=$MODVER;gver=$GVER;enabled=$_en;loaded=$_zy;mode=$_mode;port=$_port;delay=$_delay;n=$(target_names | wc -l | tr -d ' ');targets=$_tg;tinfo=$_tinfo;active=$_cnt;last=$_last;lib=$_lib;maps=$_maps;threads=$_thr;nolog=$_nolog;cfg=$_cfg;lib64=$_l64;data=$DATA"
}

check1() {
  _mod=0; [ -f "$MODDIR/zygisk/arm64-v8a.so" ] && _mod=1
  _zy=0; zy_loaded && _zy=1
  _l64=$(v lib_name libgcore.so); _l32=$(v lib_name32 libgcore32.so)
  _a=0; [ -f "$DATA/$_l64" ] && _a=1
  _b=0; [ -f "$DATA/$_l32" ] && _b=1
  _c=0; [ -f "$CONF" ] && _c=1
  _g=0; [ -f "$DATA/$(cfg_name "$_l64").config" ] && _g=1
  _h=0; [ -f "$DATA/hook.js" ] && _h=1
  _sum=$(state_summary); _states=${_sum%% *}
  _port=$(v port 27052)
  _lis=0; netstat -tln 2>/dev/null | grep -q ":$_port " && _lis=1
  echo "OK;module=$_mod;zygisk=$_zy;lib64=$_a;lib32=$_b;settings=$_c;gadgetcfg=$_g;hook=$_h;states=$_states;listen=$_lis"
}

info1() {
  _l64=$(v lib_name libgcore.so); _l32=$(v lib_name32 libgcore32.so)
  _s64=0; [ -f "$DATA/$_l64" ] && _s64=$(stat -c %s "$DATA/$_l64" 2>/dev/null)
  _s32=0; [ -f "$DATA/$_l32" ] && _s32=$(stat -c %s "$DATA/$_l32" 2>/dev/null)
  _c="$MODDIR/.gadget_sha"
  if [ -f "$_c" ] && [ "$(head -1 "$_c")" = "$_s64:$_s32" ]; then
    _sha=$(sed -n '2p' "$_c")
  else
    _sha=$(sha256sum "$DATA/$_l64" 2>/dev/null | cut -c1-16)
    { echo "$_s64:$_s32"; echo "$_sha"; } > "$TMP"; cat "$TMP" > "$_c"; rm -f "$TMP"
  fi
  echo "OK;gver=$GVER;arch=arm64+arm;size64=$_s64;size32=$_s32;sha=$_sha;up=$UPSTREAM;release=$RELEASE;ref=$REFMODULE;lic=$LIC"
}

status() {
  _s=$(status1); _c=$(check1)
  echo "=================================================="
  echo " Gadget Stealth  $MODVER   (frida-gadget $GVER)"
  echo "=================================================="
  echo "$_s" | tr ';' '\n' | grep -v '^OK$' | sed 's/^/  /'
  echo "---- 安装自检 ----"
  echo "$_c" | tr ';' '\n' | grep -v '^OK$' | sed 's/^/  /'
  echo "---- 目标 ----"
  targets_raw | sed 's/^/  /'
  echo "---- 当前 gadget 配置 ----"
  _l=$(v lib_name libgcore.so); cat "$DATA/$(cfg_name "$_l").config" 2>/dev/null
  echo "---- 最近注入状态 ----"
  for _p in $(target_names); do
    for _f in /data/data/$_p/.gs_state.*; do
      [ -f "$_f" ] && echo "  $_p: $(cat "$_f")"
    done
  done
  echo "---- 监听端口 ----"
  _port=$(v port 27052)
  netstat -tlnp 2>/dev/null | grep -E ":$_port |:39527 |:27042 " | sed 's/^/  /'
  echo "=================================================="
}

case "${1:-status}" in
  status1|check1|info1) "$1" ;;
  status|info)
     if [ "$1" = info ]; then info1 | tr ';' '\n' | sed 's/^/  /'; else status; fi ;;
  targets) targets_raw ;;
  reload) reload ;;
  on)  setv enabled 1 >/dev/null; reload ;;
  off) setv enabled 0 >/dev/null; reload ;;
  mode)
    case "${2:-}" in script|listen) setv mode "$2" >/dev/null; reload ;; *) echo "ERR;msg=mode 只能是 script|listen";; esac ;;
  port)
    case "${2:-}" in ''|*[!0-9]*) echo "ERR;msg=端口必须是数字";; *) setv port "$2" >/dev/null; reload;; esac ;;
  delay)
    case "${2:-}" in ''|*[!0-9]*) echo "ERR;msg=延迟必须是数字";; *) setv delay_ms "$2" >/dev/null; reload;; esac ;;
  stealth)
    case "${2:-}" in hide_maps|hide_module_map|hide_threads|no_log|write_state)
      case "${3:-}" in 0|1) setv "$2" "$3" >/dev/null; reload;; *) echo "ERR;msg=值只能是 0|1";; esac ;;
      *) echo "ERR;msg=未知开关";; esac ;;
  add)
    _p="${2:-}"; [ -z "$_p" ] && { echo "ERR;msg=缺包名"; exit 0; }
    _d=$(v delay_ms 1200)
    if target_names | grep -Fxq "$_p"; then
      awk -F= -v p="$_p" -v d="$_d" '$1=="target" && index($2,p",")==1 {print "target=" p ",1," d; next} {print}' "$CONF" > "$TMP"
    else
      cat "$CONF" > "$TMP"; echo "target=$_p,1,$_d" >> "$TMP"
    fi
    cat "$TMP" > "$CONF"; rm -f "$TMP"; reload ;;
  del)
    _p="${2:-}"
    awk -F= -v p="$_p" '!($1=="target" && index($2,p",")==1)' "$CONF" > "$TMP"
    cat "$TMP" > "$CONF"; rm -f "$TMP"; reload ;;
  enable|disable)
    _p="${2:-}"; _e=1; [ "$1" = disable ] && _e=0; _d=$(v delay_ms 1200)
    awk -F= -v p="$_p" -v e="$_e" -v d="$_d" '$1=="target" && index($2,p",")==1 {print "target=" p "," e "," d; next} {print}' "$CONF" > "$TMP"
    cat "$TMP" > "$CONF"; rm -f "$TMP"; reload ;;
  datadir)
    _p="${2:-}"; case "$_p" in /*) ;; *) echo "ERR;msg=需绝对路径"; exit 0;; esac
    mkdir -p "$_p" 2>/dev/null
    echo "$_p" > "$TMP"; cat "$TMP" > "$REDIRECT"; rm -f "$TMP"
    echo "OK;msg=数据目录改为 $_p，请重新运行 customize/install 或手动复制 so/config" ;;
  verify)
    info1 | tr ';' '\n' | grep -E 'gver|size64|size32|sha' ;;
  log)
    logcat -d -s gs 2>/dev/null | tail -20 ;;
  *) echo "ERR;msg=未知子命令: $1" ;;
esac
