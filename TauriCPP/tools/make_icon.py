"""
TauriCPP 多分辨率图标生成工具
从源 PNG 图像生成包含多种分辨率的 .ico 文件

标准 Windows 图标分辨率: 16, 24, 32, 48, 64, 128, 256

依赖: pip install Pillow
"""
import os
import sys
import argparse
from PIL import Image

DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256]
DEFAULT_PAD = 0.06  # 裁边后四周留白占画布比例，避免图形贴边


def normalize(img, trim=False, pad=DEFAULT_PAD):
    """裁掉透明边并把图形居中铺满正方形画布，缩小到小尺寸时才不会偏心/偏小。"""
    if not trim and pad <= 0:
        return img

    bbox = img.getbbox() if trim else None
    content = img.crop(bbox) if bbox else img

    inner = 1.0 - 2.0 * max(pad, 0.0)
    side = int(max(content.width, content.height) / inner) if inner > 0 else content.width
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(content, ((side - content.width) // 2, (side - content.height) // 2))
    return canvas


def make_icon(source_path, output_path, sizes=None, trim=False, pad=DEFAULT_PAD):
    if sizes is None:
        sizes = DEFAULT_SIZES

    if not os.path.isfile(source_path):
        print(f"Error: source image not found: {source_path}")
        sys.exit(1)

    img = Image.open(source_path)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    img = normalize(img, trim=trim, pad=pad)

    frames = []
    for size in sizes:
        resized = img.resize((size, size), Image.LANCZOS)
        frames.append(resized)

    frames[-1].save(
        output_path,
        format="ICO",
        sizes=[(f.width, f.height) for f in frames],
        append_images=frames[:-1],
    )

    size_kb = os.path.getsize(output_path) / 1024
    print(f"Generated {output_path} ({size_kb:.1f} KB)")
    print(f"  Sizes: {', '.join(str(s) for s in sizes)}")


def main():
    parser = argparse.ArgumentParser(description="TauriCPP Multi-Resolution Icon Generator")
    parser.add_argument("source", help="Source PNG image path")
    parser.add_argument("-o", "--output", default="icon.ico", help="Output .ico file path")
    parser.add_argument(
        "-s", "--sizes",
        default=None,
        help="Comma-separated sizes (default: 16,24,32,48,64,128,256)",
    )
    parser.add_argument(
        "--trim",
        action="store_true",
        help="Trim transparent borders before resizing (recommended for logos)",
    )
    parser.add_argument(
        "--pad",
        type=float,
        default=DEFAULT_PAD,
        help=f"Padding ratio around the artwork after trim (default: {DEFAULT_PAD})",
    )
    args = parser.parse_args()

    sizes = None
    if args.sizes:
        try:
            sizes = [int(s.strip()) for s in args.sizes.split(",")]
        except ValueError:
            print("Error: invalid size list, must be comma-separated integers")
            sys.exit(1)

    make_icon(args.source, args.output, sizes, trim=args.trim, pad=args.pad)


if __name__ == "__main__":
    main()
