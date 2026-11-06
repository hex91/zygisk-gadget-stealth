#!/usr/bin/env bash
# 用 Android NDK 直接编译 Zygisk 模块（不依赖 Gradle / prefab / dobby）
# 用法: NDK=/path/to/ndk bash native/build.sh
# 支持增量：源文件没变就跳过编译，几秒内完成。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NDK="${NDK:-/e/repo/android/Sdk/ndk-bundle}"
BIN="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin"
[ -x "$BIN/aarch64-linux-android30-clang++" ] || { echo "NDK 未找到: $BIN" >&2; exit 1; }

OUT="$ROOT/build"
mkdir -p "$OUT" "$ROOT/module/zygisk"

CXXFLAGS="-std=c++17 -O2 -fPIC -fno-exceptions -fno-rtti -fvisibility=hidden -Wall -Wno-unused-parameter"
CFLAGS="-O2 -fPIC -fvisibility=hidden -Wall"
DEFS=(-DGADGET_VERSION='"17.5.2"' -DMODULE_ID='"zygisk_gadget_stealth"')
INCS="-I$ROOT/native -I$ROOT/native/xdl/include -I$ROOT/native/xdl"

XDL_SRC="xdl/xdl.c xdl/xdl_iterate.c xdl/xdl_linker.c xdl/xdl_lzma.c xdl/xdl_util.c"
CPP_SRC="native/main.cpp native/config.cpp native/stealth.cpp"

# 有任何一个源文件比目标 so 新，才需要重编
needs_build() {
  local target="$1"
  [ -f "$target" ] || return 0
  find native -type f \( -name '*.c' -o -name '*.cpp' -o -name '*.h' \) -newer "$target" | grep -q .
}

build_abi() {
  local abi="$1" cc="$2" cxx="$3"
  local so="$OUT/$abi.so"
  if ! needs_build "$so"; then
    echo "[=] $abi 未变更，跳过编译"
    return 0
  fi
  echo "[*] build $abi ..."
  local objs=()
  for f in $XDL_SRC; do
    local o="$OUT/${abi}_$(basename "${f%.c}").o"
    "$BIN/$cc" $CFLAGS $INCS -c "native/$f" -o "$o"
    objs+=("$o")
  done
  for f in $CPP_SRC; do
    local o="$OUT/${abi}_$(basename "${f%.cpp}").o"
    "$BIN/$cxx" $CXXFLAGS "${DEFS[@]}" $INCS -c "$f" -o "$o"
    objs+=("$o")
  done
  "$BIN/$cxx" -shared -fPIC -o "$so" "${objs[@]}" \
      -static-libstdc++ -llog -Wl,--exclude-libs,ALL
  echo "[+] $(basename "$so") $(stat -c %s "$so") bytes"
}

build_abi "arm64-v8a"   "aarch64-linux-android30-clang"       "aarch64-linux-android30-clang++"
build_abi "armeabi-v7a" "armv7a-linux-androideabi30-clang"    "armv7a-linux-androideabi30-clang++"

cp "$OUT/arm64-v8a.so"   "$ROOT/module/zygisk/arm64-v8a.so"
cp "$OUT/armeabi-v7a.so" "$ROOT/module/zygisk/armeabi-v7a.so"

# 快速符号校验：直接扫字节，不启动 llvm-nm（Windows 上偶尔卡住）
for f in "$ROOT/module/zygisk/"*.so; do
  if grep -aq 'zygisk_module_entry' "$f"; then
    echo "  $(basename "$f")  $(stat -c %s "$f") bytes  entry=OK"
  else
    echo "  $(basename "$f")  缺少 zygisk_module_entry" >&2; exit 1
  fi
done
echo "[*] 完成"
