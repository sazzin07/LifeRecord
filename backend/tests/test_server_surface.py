"""Safety net for splitting server.py (F-02): the public API must not change when routes move to other modules, and
every name the tests (and other scripts) take from `server` must stay available there.

The first test compares today's OpenAPI paths with a committed snapshot. If a route is added, removed or renamed ON
PURPOSE, regenerate the snapshot (and say so in the commit message):

    python tests/test_server_surface.py --write
"""
import ast
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
GOLDEN = HERE / "golden_api_surface.json"


def current_surface():
    import server
    out = []
    for path, ops in server.app.openapi()["paths"].items():
        for method in ops:
            if method.lower() in ("get", "post", "put", "patch", "delete"):
                out.append(f"{method.upper()} {path}")
    return sorted(out)


def test_the_api_surface_is_unchanged():
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    actual = current_surface()
    missing, extra = sorted(set(expected) - set(actual)), sorted(set(actual) - set(expected))
    assert not missing and not extra, f"routes removed: {missing}\nroutes added: {extra}\n(regenerate with --write if intended)"
    assert len(actual) == len(set(actual))  # no route registered twice


def _names_taken_from_server():
    """Every `from server import X` and every `server.X` in the test files and the backend's own scripts."""
    wanted = {}
    for path in list(HERE.glob("*.py")) + [p for p in BACKEND.glob("*.py") if p.name != "server.py"]:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "server":
                for alias in node.names:
                    wanted.setdefault(alias.name, path.name)
            elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in ("server", "srv"):
                wanted.setdefault(node.attr, path.name)
    return wanted


def test_every_name_other_code_takes_from_server_still_exists_there():
    import server
    wanted = _names_taken_from_server()
    assert len(wanted) > 20, "the scan found suspiciously few names"
    gone = {name: who for name, who in wanted.items() if not hasattr(server, name)}
    assert gone == {}, f"server.py no longer provides: {gone}"


def shadowed_routes(routes):
    """Routes that an earlier route would answer instead. FastAPI uses the FIRST route that matches, so registering
    `/things/{id}` before `/things/mine` makes the second unreachable, silently."""
    import re
    shadowed = []
    for route in routes:
        concrete = re.sub(r"\{[^}/]+(:path)?\}", "x", route.path)
        for method in route.methods - {"HEAD", "OPTIONS"}:
            scope = {"type": "http", "method": method, "path": concrete, "root_path": "", "query_string": b"", "headers": []}
            first = next((r for r in routes if method in r.methods and r.matches(scope)[0].name == "FULL"), None)
            if first is not route and not (first and first.path == route.path):
                shadowed.append(f"{method} {route.path} is answered by {first.path if first else None}")
    return shadowed


def test_no_route_is_shadowed_by_an_earlier_one():
    """Moving routes between modules changes registration order; this resolves a concrete URL for every route and checks
    that the route which would answer is the route itself."""
    import server
    routes = [r for r in server.api_router.routes if hasattr(r, "methods")]
    assert len(routes) > 150
    assert shadowed_routes(routes) == []


def test_the_shadowing_check_can_fail():
    """Negative control: a broad route registered ahead of a narrow one must be reported."""
    from fastapi import APIRouter
    router = APIRouter()
    router.get("/things/{item_id}")(lambda item_id: item_id)
    router.get("/things/mine")(lambda: "mine")
    found = shadowed_routes([r for r in router.routes if hasattr(r, "methods")])
    assert found == ["GET /things/mine is answered by /things/{item_id}"]


if __name__ == "__main__" and "--write" in sys.argv:
    import os
    sys.path.insert(0, str(BACKEND))
    for key, value in {"JWT_SECRET": "x" * 40, "ADMIN_EMAIL": "a@example.com", "ADMIN_PASSWORD": "Aa1-xxxxxxxxxxxxxxxx",
                       "DATABASE_NAME": "liferecord_test_1", "SCHEDULER_ENABLED": "false",
                       "STORAGE_DIR": os.path.join(os.environ.get("TEMP", "."), "lr-surface-storage")}.items():
        os.environ.setdefault(key, value)
    GOLDEN.write_text(json.dumps(current_surface(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {GOLDEN} ({len(current_surface())} routes)")
