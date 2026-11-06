#!/usr/bin/env python3
"""打包 KernelSU / SukiSU / Magisk 模块 zip。

用法: python tools/build_zip.py
输出: dist/gadget-stealth-1.0.0.zip
"""
import hashlib
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "module")
OUT = os.path.join(ROOT, "dist", "gadget-stealth-1.0.0.zip")

TEXT_EXT = {".sh", ".prop", ".conf", ".txt", ".js", ".html", ".json", ".md"}


def collect(base, prefix=""):
    items = []
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name)
        rel = (prefix + "/" + name) if prefix else name
        if os.path.isdir(p):
            items += collect(p, rel)
        else:
            items.append((p, rel))
    return items


def main():
    files = collect(MOD)
    for p, rel in collect(os.path.join(ROOT, "gadget")):
        files.append((p, "gadget/" + rel))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p, rel in files:
            data = open(p, "rb").read()
            if os.path.splitext(rel)[1] in TEXT_EXT:
                assert b"\r" not in data, "CRLF 污染: " + rel
            z.writestr(rel, data)
            print("  %-42s %10d" % (rel, len(data)))

    print("\nzip :", OUT)
    print("size:", os.path.getsize(OUT))
    print("sha :", hashlib.sha256(open(OUT, "rb").read()).hexdigest())


if __name__ == "__main__":
    main()
