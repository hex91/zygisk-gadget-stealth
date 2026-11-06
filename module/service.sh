#!/system/bin/sh
# 开机：确保 gadget 配置与 settings.conf 一致，并刷新模块卡片说明
MODDIR=${0%/*}
sh "$MODDIR/gadget_ctl.sh" reload >/dev/null 2>&1
