import argparse
import mimetypes
from pathlib import Path
from wsgiref.simple_server import make_server

BASE_DIR = Path(__file__).resolve().parent


def response(body, content_type, status="200 OK"):
    return status, [("Content-Type", content_type), ("Content-Length", str(len(body))), ("Cache-Control", "no-store")], [body]


def serve_file(path):
    try:
        path = path.resolve()
        path.relative_to(BASE_DIR)
    except (ValueError, OSError):
        return response(b"Not found", "text/plain; charset=utf-8", "404 Not Found")
    if not path.is_file():
        return response(b"Not found", "text/plain; charset=utf-8", "404 Not Found")
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or "javascript" in content_type:
        content_type += "; charset=utf-8"
    return response(path.read_bytes(), content_type)


def application(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    mount = "/tools/annotate"
    if path == mount:
        path = "/"
    elif path.startswith(mount + "/"):
        path = path[len(mount):]
    if path in ("", "/"):
        result = serve_file(BASE_DIR / "index.html")
    elif path.startswith("/styles/") or path.startswith("/static/"):
        result = serve_file(BASE_DIR / path.lstrip("/"))
    else:
        result = response(b"Not found", "text/plain; charset=utf-8", "404 Not Found")
    status, headers, body = result
    start_response(status, headers)
    return body


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the Annotate development server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8002)
    args = parser.parse_args()
    with make_server(args.host, args.port, application) as server:
        print(f"Annotate running at http://{args.host}:{args.port}/")
        server.serve_forever()
