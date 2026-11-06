#!/system/bin/sh
# 管理器「执行」按钮：打印完整状态面板
MODDIR=${0%/*}
sh "$MODDIR/gadget_ctl.sh" status
