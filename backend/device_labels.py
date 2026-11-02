"""A short, human name for a browser or app, such as "Chrome on Windows", for the list of where an account is signed in.

Only this label is ever stored. The raw User-Agent is long, unique enough to follow a person around, and not something the
list needs, so it is read once here and dropped. Order matters below: Edge, Opera and Chrome all say "Chrome", and every
browser on a phone says "Safari" or "Mobile".
"""
import re

MAX_LENGTH = 80

_BROWSERS = (  # first match wins
    (re.compile(r"Edg(e|A|iOS)?/"), "Edge"),
    (re.compile(r"OPR/|Opera"), "Opera"),
    (re.compile(r"Firefox/|FxiOS/"), "Firefox"),
    (re.compile(r"Chrome/|CriOS/"), "Chrome"),
    (re.compile(r"Safari/"), "Safari"),
)
_SYSTEMS = (
    (re.compile(r"iPhone"), "iPhone"),
    (re.compile(r"iPad"), "iPad"),
    (re.compile(r"Android"), "Android"),
    (re.compile(r"Windows"), "Windows"),
    (re.compile(r"Macintosh|Mac OS X"), "macOS"),
    (re.compile(r"CrOS"), "ChromeOS"),
    (re.compile(r"Linux|X11"), "Linux"),
)


def device_label(user_agent: str) -> str:
    agent = (user_agent or "").strip()[:512]
    if not agent:
        return "Unknown device"
    browser = next((name for pattern, name in _BROWSERS if pattern.search(agent)), None)
    system = next((name for pattern, name in _SYSTEMS if pattern.search(agent)), None)
    if browser and system:
        return f"{browser} on {system}"
    if browser:
        return browser
    return "Another app"
