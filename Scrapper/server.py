import json
import os
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("FIELDNOTES_PORT", "8765"))
MAX_ASSET_BYTES = 200 * 1024 * 1024
ALLOWED_MEDIA_HOSTS = {
    "xeno-canto.org",
    "inaturalist-open-data.s3.amazonaws.com",
    "inaturalist.org",
    "wikimedia.org",
    "flickr.com",
    "staticflickr.com",
    "gbif.org",
    "cdn.download.ams.birds.cornell.edu",
}


def validate_media_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only public HTTPS media URLs are allowed.")
    if parsed.port not in (None, 443):
        raise ValueError("Media URLs must use the standard HTTPS port.")
    hostname = parsed.hostname.lower().rstrip(".")
    if not any(hostname == domain or hostname.endswith(f".{domain}") for domain in ALLOWED_MEDIA_HOSTS):
        raise ValueError(f"Media host is not allow-listed: {hostname}")
    return url


class SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        validate_media_url(new_url)
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


class FieldnotesHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == "/asset-proxy":
            self.proxy_asset()
            return
        super().do_GET()

    def proxy_asset(self):
        values = parse_qs(urlsplit(self.path).query).get("url", [])
        if len(values) != 1 or len(values[0]) > 4096:
            self.send_json_error(400, "Provide one valid media URL.")
            return
        try:
            remote_url = validate_media_url(values[0])
            request = Request(remote_url, headers={"User-Agent": "Fieldnotes local dictionary builder"})
            opener = build_opener(SafeRedirectHandler())
            with opener.open(request, timeout=60) as response:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_ASSET_BYTES:
                    self.send_json_error(413, "Media file exceeds the 200 MB per-file limit.")
                    return
                with tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024) as media_file:
                    copied = 0
                    while True:
                        chunk = response.read(64 * 1024)
                        if not chunk:
                            break
                        copied += len(chunk)
                        if copied > MAX_ASSET_BYTES:
                            self.send_json_error(413, "Media file exceeds the 200 MB per-file limit.")
                            return
                        media_file.write(chunk)
                    media_file.seek(0)
                    self.send_response(200)
                    self.send_header("Content-Type", response.headers.get("Content-Type", "application/octet-stream"))
                    self.send_header("Content-Length", str(copied))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    while True:
                        chunk = media_file.read(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except ValueError as error:
            self.send_json_error(400, str(error))
        except HTTPError as error:
            self.send_json_error(502, f"Media source returned HTTP {error.code}.")
        except (URLError, TimeoutError, OSError) as error:
            self.send_json_error(502, f"Could not retrieve media: {error}")

    def send_json_error(self, status, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), FieldnotesHandler)
    print(f"Fieldnotes is running at http://127.0.0.1:{PORT}/index.html")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Fieldnotes.")
    finally:
        server.server_close()
