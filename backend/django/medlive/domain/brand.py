"""A hospital's colours, logo and installable app (ports of `brand/theme.ts`,
`brand/manifest.ts` and `network/publishing.ts`; FR-BRD-*, FR-NET-01..03)."""

from __future__ import annotations

import math
import re
from typing import Any

from ..core.schema import z

# --- Theme ---------------------------------------------------------------------

BRAND_TOKENS = ("brand-900", "brand-700", "brand-600", "brand-300", "brand-100", "brand-border")
_hex = z.string().regex(r"^#[0-9a-fA-F]{6}$", js="/^#[0-9a-fA-F]{6}$/")
brand_theme = z.strict_object({"colors": z.strict_object({token: _hex for token in BRAND_TOKENS})})

CANVAS = "#f6f4ef"
ON_BRAND = "#ffffff"
MIN_TEXT_CONTRAST = 4.5
STEP = 0.01


def _channel(value: int) -> float:
    scaled = value / 255
    return scaled / 12.92 if scaled <= 0.03928 else ((scaled + 0.055) / 1.055) ** 2.4


def _luminance(colour: str) -> float:
    red, green, blue = int(colour[1:3], 16), int(colour[3:5], 16), int(colour[5:7], 16)
    return 0.2126 * _channel(red) + 0.7152 * _channel(green) + 0.0722 * _channel(blue)


def contrast_ratio(a: str, b: str) -> float:
    lighter, darker = sorted([_luminance(a), _luminance(b)], reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def brand_problems(theme: dict[str, Any]) -> list[str]:
    colors = theme["colors"]
    problems = []
    if contrast_ratio(ON_BRAND, colors["brand-600"]) < MIN_TEXT_CONTRAST:
        problems.append("button_text_unreadable")
    if contrast_ratio(colors["brand-700"], CANVAS) < MIN_TEXT_CONTRAST:
        problems.append("heading_unreadable")
    if contrast_ratio(colors["brand-600"], colors["brand-100"]) < MIN_TEXT_CONTRAST:
        problems.append("accent_unreadable_on_tint")
    return problems


def _to_hsl(colour: str) -> tuple[float, float, float]:
    red, green, blue = int(colour[1:3], 16) / 255, int(colour[3:5], 16) / 255, int(colour[5:7], 16) / 255
    high, low = max(red, green, blue), min(red, green, blue)
    lightness = (high + low) / 2
    if high == low:
        return 0.0, 0.0, lightness
    spread = high - low
    saturation = spread / (2 - high - low) if lightness > 0.5 else spread / (high + low)
    if high == red:
        sector = (green - blue) / spread + (6 if green < blue else 0)
    elif high == green:
        sector = (blue - red) / spread + 2
    else:
        sector = (red - green) / spread + 4
    return sector * 60, saturation, lightness


def _js_round(value: float) -> int:
    return math.floor(value + 0.5)


def _from_hsl(h: float, s: float, lightness: float) -> str:
    chroma = (1 - abs(2 * lightness - 1)) * s
    sector = h / 60
    second = chroma * (1 - abs(math.fmod(sector, 2) - 1))
    if sector < 1:
        red, green, blue = chroma, second, 0.0
    elif sector < 2:
        red, green, blue = second, chroma, 0.0
    elif sector < 3:
        red, green, blue = 0.0, chroma, second
    elif sector < 4:
        red, green, blue = 0.0, second, chroma
    elif sector < 5:
        red, green, blue = second, 0.0, chroma
    else:
        red, green, blue = chroma, 0.0, second
    lift = lightness - chroma / 2

    def part(value: float) -> str:
        return format(_js_round(min(1, max(0, value + lift)) * 255), "02x")

    return f"#{part(red)}{part(green)}{part(blue)}"


def theme_from_colour(colour: str) -> dict[str, Any]:
    """A readable theme built around one chosen colour (FR-BRD-02)."""
    h, chosen_s, chosen_l = _to_hsl(colour)
    s = min(chosen_s, 0.85)
    tint = _from_hsl(h, min(s, 0.35), 0.93)
    border = _from_hsl(h, min(s, 0.3), 0.84)
    light = _from_hsl(h, min(s, 0.6), 0.72)

    def carries(candidate: str) -> bool:
        return contrast_ratio(ON_BRAND, candidate) >= MIN_TEXT_CONTRAST and contrast_ratio(candidate, tint) >= MIN_TEXT_CONTRAST

    main_lightness = chosen_l
    main = colour.lower()
    while not carries(main) and main_lightness > STEP:
        main_lightness -= STEP
        main = _from_hsl(h, s, main_lightness)
    deep_lightness = max(main_lightness - 0.08, STEP)
    deep = _from_hsl(h, s, deep_lightness)
    while contrast_ratio(deep, CANVAS) < MIN_TEXT_CONTRAST and deep_lightness > STEP:
        deep_lightness -= STEP
        deep = _from_hsl(h, s, deep_lightness)
    darkest = _from_hsl(h, min(s, 0.75), max(min(deep_lightness - 0.07, 0.14), 0.04))
    return {
        "colors": {
            "brand-900": darkest,
            "brand-700": deep,
            "brand-600": main,
            "brand-300": light,
            "brand-100": tint,
            "brand-border": border,
        }
    }


brand_body = z.strict_object({"theme": brand_theme.nullable()})

LOGO_FILE_TYPES = ("image/png", "image/jpeg", "image/webp")
LOGO_MAX_BYTES = 256 * 1024
logo_body = z.strict_object(
    {
        "fileType": z.enum(LOGO_FILE_TYPES),
        "content": z.string().min(1).max(math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4),
    }
)


def logo_bytes_match(kind: str, data: bytes) -> bool:
    def starts(*signature: int) -> bool:
        return all(index < len(data) and data[index] == value for index, value in enumerate(signature))

    if kind == "image/png":
        return starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    if kind == "image/jpeg":
        return starts(0xFF, 0xD8, 0xFF)
    if kind == "image/webp":
        return starts(0x52, 0x49, 0x46, 0x46) and len(data) >= 12 and data[8:12] == b"WEBP"
    return False


def read_brand_theme(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    parsed = brand_theme.safe_parse(value)
    if not parsed.success:
        return None
    return parsed.data if not brand_problems(parsed.data) else None


# --- The installable app ---------------------------------------------------------

PLATFORM_INSTALL = {
    "name": "MedLiveBD",
    "description": "ডাক্তারের সিরিয়াল নিন, আর অপেক্ষা সরাসরি দেখুন।",
    "ground": "#F6F4EF",
    "icons": [
        {"src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
        {"src": "/icon-maskable.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable"},
    ],
}
INSTALL_ICON_MIN_PIXELS = 192
SHORT_NAME_MAX = 12


def png_size(head_hex: str) -> dict[str, int] | None:
    hexed = head_hex.lower()
    if len(hexed) < 48 or not hexed.startswith("89504e470d0a1a0a") or hexed[24:32] != "49484452":
        return None
    try:
        width, height = int(hexed[32:40], 16), int(hexed[40:48], 16)
    except ValueError:
        return None
    return {"width": width, "height": height} if width > 0 and height > 0 else None


def install_icon_usable(icon: dict[str, Any] | None) -> bool:
    return (
        icon is not None
        and icon["type"] == "image/png"
        and icon["width"] == icon["height"]
        and icon["width"] >= INSTALL_ICON_MIN_PIXELS
    )


def short_install_name(name: str) -> str:
    words = re.split(r"\s+", name.strip())
    short = ""
    for word in words:
        following = word if short == "" else f"{short} {word}"
        if len(following) > SHORT_NAME_MAX:
            break
        short = following
    if short != "":
        return short
    return (words[0] if words else name)[:SHORT_NAME_MAX]


def install_manifest(subject: dict[str, Any] | None) -> dict[str, Any]:
    base = {
        "lang": "bn",
        "dir": "ltr",
        "scope": "/",
        "display": "standalone",
        "orientation": "portrait",
        "background_color": PLATFORM_INSTALL["ground"],
        "categories": ["health", "medical"],
    }
    if subject is None:
        return {
            **base,
            "name": PLATFORM_INSTALL["name"],
            "short_name": PLATFORM_INSTALL["name"],
            "description": PLATFORM_INSTALL["description"],
            "start_url": "/",
            "theme_color": PLATFORM_INSTALL["ground"],
            "icons": PLATFORM_INSTALL["icons"],
        }
    icon = subject.get("icon")
    return {
        **base,
        "name": subject["nameBn"],
        "short_name": short_install_name(subject["nameBn"]),
        "description": subject["descriptionBn"] if subject.get("descriptionBn") is not None else PLATFORM_INSTALL["description"],
        "start_url": subject["startUrl"],
        "theme_color": subject["mainColour"] if subject.get("mainColour") is not None else PLATFORM_INSTALL["ground"],
        "icons": [{"src": icon["src"], "sizes": f"{icon['width']}x{icon['height']}", "type": icon["type"], "purpose": "any"}]
        if install_icon_usable(icon)
        else PLATFORM_INSTALL["icons"],
    }


# --- What a hospital shares with the network ----------------------------------------

PUBLISHABLE_FIGURES = ("serials", "beds", "stock")
MODULE_OF_FIGURE = {"serials": "queue", "beds": "beds", "stock": "pharmacy"}


def is_publishable_figure(value: str) -> bool:
    return value in PUBLISHABLE_FIGURES


def not_shared_of(unpublished: list[str], modules_off: list[str] | tuple[str, ...]) -> list[str]:
    return [f for f in PUBLISHABLE_FIGURES if f in unpublished and MODULE_OF_FIGURE[f] not in modules_off]


publishing_body = z.strict_object(
    {
        "unpublished": z.array(z.enum(PUBLISHABLE_FIGURES))
        .max(len(PUBLISHABLE_FIGURES))
        .refine(lambda values: len(set(values)) == len(values), "each figure once")
    }
)
