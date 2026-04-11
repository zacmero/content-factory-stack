#!/usr/bin/env python3

import html
import json
import mimetypes
import os
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


HOST = os.environ.get("INSTAGRAM_PULLER_HOST", "0.0.0.0")
PORT = int(os.environ.get("INSTAGRAM_PULLER_PORT", "8788"))
CHROMIUM = os.environ.get("INSTAGRAM_PULLER_CHROMIUM", "/usr/bin/chromium")
ENV_FILE = Path(os.environ.get("INSTAGRAM_PULLER_ENV_FILE", ".env"))
STATE_FILE = Path(os.environ.get("INSTAGRAM_PULLER_STATE_FILE", ".instagram_playwright_state.json"))
TMPFILES_UPLOAD_URL = os.environ.get("INSTAGRAM_PULLER_TMPFILES_UPLOAD_URL", "https://tmpfiles.org/api/v1/upload")
TMPFILES_RAW_BASE = os.environ.get("INSTAGRAM_PULLER_TMPFILES_RAW_BASE", "https://tmpfiles.org/dl")

DEFAULT_SOURCES = [
    {
        "title": "healthh.hacksss",
        "url": "https://www.instagram.com/healthh.hacksss/?g=5",
    },
    {
        "title": "grandma.healer",
        "url": "https://www.instagram.com/grandma.healer/",
    },
    {
        "title": "elderly health popular",
        "url": "https://www.instagram.com/popular/elderly-health/",
    },
]


def load_env_file(path):
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


load_env_file(ENV_FILE)

INSTAGRAM_LOGIN = (
    os.environ.get("INSTAGRAM_PULLER_LOGIN")
    or os.environ.get("META_INSTAGRAM_USERNAME")
    or os.environ.get("META_INSTAGRAM_EMAIL")
    or ""
).strip()
INSTAGRAM_PASSWORD = (
    os.environ.get("INSTAGRAM_PULLER_PASSWORD")
    or os.environ.get("META_INSTAGRAM_PASSWORD")
    or ""
).strip()
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
)


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def normalize_sources(raw_sources):
    if not raw_sources:
        return DEFAULT_SOURCES
    sources = []
    for item in raw_sources:
        if isinstance(item, str):
            url = item.strip()
            title = urlparse(url).path.strip("/") or url
        elif isinstance(item, dict):
            url = str(item.get("url") or item.get("link") or "").strip()
            title = str(item.get("title") or item.get("name") or urlparse(url).path.strip("/") or url).strip()
        else:
            continue
        if url:
            sources.append({"title": title, "url": url})
    return sources or DEFAULT_SOURCES


def decode_ig_url(value):
    value = html.unescape(value or "")
    value = value.replace("\\/", "/")
    value = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), value)
    return value


def extract_meta(html_text, property_name):
    patterns = [
        rf'<meta[^>]+property=["\']{re.escape(property_name)}["\'][^>]+content=["\']([^"\']+)',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']{re.escape(property_name)}["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html_text, re.IGNORECASE)
        if match:
            return html.unescape(match.group(1)).strip()
    return ""


def clean_caption(description):
    text = html.unescape(description or "").replace("\n", " ").strip()
    match = re.search(r"-\s+([A-Za-z0-9_.]+)\s+on\s+[^:]+:\s+\"(.+?)\"\.?\s*$", text)
    if match:
        return match.group(2).strip(), "@" + match.group(1)
    return text, ""


def source_handle_from_url(url):
    path = urlparse(url).path.strip("/")
    if not path:
        return ""
    parts = [part for part in path.split("/") if part]
    if not parts:
        return ""
    if parts[0] == "popular" and len(parts) > 1:
        return "@" + parts[1]
    return "@" + parts[0]


def unique_post_links(page_url, html_text):
    links = []
    for match in re.finditer(r"/(?:p|reel)/[A-Za-z0-9_-]+", html_text):
        links.append("https://www.instagram.com" + match.group(0) + "/")
    for match in re.finditer(r"https:\\/\\/www\.instagram\.com\\/(?:p|reel)\\/[A-Za-z0-9_-]+", html_text):
        links.append(decode_ig_url(match.group(0)) + "/")
    seen = set()
    result = []
    for link in links:
        normalized = re.sub(r"/+$", "/", link)
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def unique_post_links_from_dom(page):
    try:
        anchors = page.evaluate(
            """
            () => Array.from(document.querySelectorAll('a[href]'))
              .map((node) => node.getAttribute('href') || '')
              .filter((href) => href.includes('/reel/') || href.includes('/p/'))
            """
        )
    except Exception:
        anchors = []
    links = []
    for href in anchors:
        value = str(href or "").strip()
        if not value:
            continue
        link = value if value.startswith("http") else "https://www.instagram.com" + value
        links.append(re.sub(r"/+$", "/", link))
    return list(dict.fromkeys(links))


def extract_mp4_urls(html_text):
    candidates = []
    for match in re.finditer(r"https?:\\?/\\?/[^\"'<> ]+?\.mp4[^\"'<> ]*", html_text):
        url = decode_ig_url(match.group(0))
        if "bytestart=" in url or "byteend=" in url:
            continue
        if url not in candidates:
            candidates.append(url)
    return candidates


def guess_mime_type(url, fallback="application/octet-stream"):
    mime_type, _ = mimetypes.guess_type(url)
    return mime_type or fallback


def download_bytes(url):
    raise NotImplementedError("Use download_bytes_with_context")


def upload_to_tmpfiles(file_bytes, filename, mime_type):
    suffix = Path(filename).suffix or ".bin"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        result = subprocess.run(
            [
                "curl",
                "-sS",
                "-f",
                "-A",
                DEFAULT_USER_AGENT,
                "-F",
                f"file=@{tmp_path};filename={filename};type={mime_type}",
                TMPFILES_UPLOAD_URL,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        data = json.loads(result.stdout)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    raw_url = str(data.get("data", {}).get("url", "")).strip()
    if raw_url.startswith("http://tmpfiles.org/"):
        raw_url = raw_url.replace("http://tmpfiles.org/", f"{TMPFILES_RAW_BASE}/", 1)
    elif raw_url.startswith("https://tmpfiles.org/"):
        raw_url = raw_url.replace("https://tmpfiles.org/", f"{TMPFILES_RAW_BASE}/", 1)
    return raw_url, data


def upload_bytes_to_tmpfiles(file_bytes, filename, mime_type):
    return upload_to_tmpfiles(file_bytes, filename, mime_type)


def download_bytes_with_context(request_context, url, referer=""):
    response = request_context.get(
        url,
        headers={
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "*/*",
            **({"Referer": referer} if referer else {}),
        },
        timeout=60000,
    )
    if not response.ok:
        raise RuntimeError(f"HTTP {response.status} while fetching {url}")
    return response.body(), response.headers.get("content-type", "")


def rehost_media(request_context, source_url, upload_name, referer=""):
    file_bytes, content_type = download_bytes_with_context(request_context, source_url, referer=referer)
    mime_type = (content_type or "").split(";")[0].strip() or guess_mime_type(upload_name)
    raw_url, response = upload_to_tmpfiles(file_bytes, upload_name, mime_type)
    return raw_url, response


def build_context(browser):
    kwargs = {
        "user_agent": DEFAULT_USER_AGENT,
        "viewport": {"width": 1440, "height": 1200},
        "locale": "en-US",
        "timezone_id": "America/Sao_Paulo",
    }
    if STATE_FILE.exists():
        kwargs["storage_state"] = str(STATE_FILE)
    return browser.new_context(**kwargs)


def has_login_form(page):
    try:
        return page.locator('input[name="username"]').count() > 0
    except Exception:
        return False


def save_state(context):
    context.storage_state(path=str(STATE_FILE))


def login_if_needed(context):
    if not INSTAGRAM_LOGIN or not INSTAGRAM_PASSWORD:
        return

    page = context.new_page()
    try:
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        if not has_login_form(page) and "/accounts/login" not in page.url:
            save_state(context)
            return
        page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        dismiss_texts = [
            "Only allow essential cookies",
            "Allow all cookies",
            "Permitir apenas cookies essenciais",
            "Permitir todos os cookies",
        ]
        for text in dismiss_texts:
            try:
                button = page.get_by_role("button", name=text)
                if button.count() > 0:
                    button.first.click(timeout=2000)
                    page.wait_for_timeout(1000)
                    break
            except Exception:
                continue

        page.locator('input[name="username"]').fill(INSTAGRAM_LOGIN, timeout=10000)
        page.locator('input[name="password"]').fill(INSTAGRAM_PASSWORD, timeout=10000)
        page.locator('button[type="submit"]').click(timeout=10000)
        page.wait_for_timeout(6000)

        if has_login_form(page):
            raise RuntimeError("Instagram login did not complete. Credentials may be blocked or checkpointed.")
        if "/challenge/" in page.url or page.locator('input[name="verificationCode"]').count() > 0:
            raise RuntimeError("Instagram login requires challenge/verification code.")

        post_login_dismiss = ["Not now", "Agora não", "Not Now"]
        for text in post_login_dismiss:
            try:
                button = page.get_by_role("button", name=text)
                if button.count() > 0:
                    button.first.click(timeout=2000)
                    page.wait_for_timeout(1000)
            except Exception:
                continue

        save_state(context)
    finally:
        page.close()


def open_profile_page(context, url):
    page = context.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        for _ in range(2):
            page.mouse.wheel(0, 1800)
            page.wait_for_timeout(1500)
        return page
    except Exception:
        page.close()
        raise


def normalize_exclude_links(raw_links):
    if not raw_links:
        return set()
    links = set()
    for item in raw_links:
        value = str(item or "").strip()
        if not value:
            continue
        links.add(re.sub(r"/+$", "/", value))
    return links


def pull_source(sources, exclude_post_links=None):
    errors = []
    shuffled_sources = list(sources)
    random.shuffle(shuffled_sources)
    excluded = normalize_exclude_links(exclude_post_links)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            executable_path=CHROMIUM,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-crash-reporter",
                "--disable-crashpad",
            ],
        )
        try:
            context = build_context(browser)
            login_if_needed(context)
            request_context = context.request
            for source in shuffled_sources:
                page = None
                try:
                    page = open_profile_page(context, source["url"])
                    page_html = page.content()
                    links = unique_post_links_from_dom(page) or unique_post_links(source["url"], page_html)
                    if not links:
                        errors.append(
                            {
                                "source": source["url"],
                                "error": "No visible posts/reels in rendered page",
                                "pageUrl": page.url,
                                "title": page.title(),
                            }
                        )
                        continue

                    random.shuffle(links)
                    for post_link in links[:8]:
                        normalized_post_link = re.sub(r"/+$", "/", post_link)
                        if normalized_post_link in excluded:
                            continue
                    post_page = context.new_page()
                    seen_media = {}
                    try:
                        def capture_response(response):
                            if (
                                (".mp4" in response.url or ".jpg" in response.url or ".jpeg" in response.url or ".png" in response.url)
                                and "bytestart=" not in response.url
                            ):
                                seen_media.setdefault(
                                    response.url,
                                    {
                                        "body": response.body() if response.ok else b"",
                                        "content_type": response.headers.get("content-type", ""),
                                    },
                                )

                        post_page.on("response", capture_response)
                        post_page.goto(post_link, wait_until="domcontentloaded", timeout=30000)
                        post_page.wait_for_timeout(5000)
                        post_html = post_page.content()
                        description = extract_meta(post_html, "og:description")
                        caption, handle_from_caption = clean_caption(description)
                        image_url = extract_meta(post_html, "og:image")
                        mp4_urls = extract_mp4_urls(post_html)
                        if not mp4_urls:
                            try:
                                video_src = post_page.evaluate(
                                    """
                                    () => {
                                      const video = document.querySelector('video');
                                      return video ? (video.currentSrc || video.src || '') : '';
                                    }
                                    """
                                )
                                if video_src and "blob:" not in video_src:
                                    mp4_urls = [video_src]
                            except Exception:
                                pass
                        video_url = mp4_urls[0] if mp4_urls else ""
                        if not video_url:
                            video_url = next(
                                (
                                    url
                                    for url in seen_media.keys()
                                    if ".mp4" in url and "bytestart=" not in url
                                ),
                                "",
                            )
                        handle = handle_from_caption or source_handle_from_url(source["url"])

                        if not image_url and not video_url:
                            errors.append({"source": post_link, "error": "No media found on rendered post"})
                            continue

                        public_image_url = ""
                        public_video_url = ""
                        if video_url:
                            try:
                                media_record = seen_media.get(video_url, {})
                                if media_record.get("body"):
                                    public_video_url, _ = upload_bytes_to_tmpfiles(
                                        media_record["body"],
                                        "source-video.mp4",
                                        (media_record.get("content_type") or "video/mp4").split(";")[0].strip(),
                                    )
                                else:
                                    public_video_url, _ = rehost_media(
                                        request_context,
                                        video_url,
                                        "source-video.mp4",
                                        referer=post_link,
                                    )
                            except Exception as exc:
                                errors.append({"source": post_link, "error": f"Video rehost failed: {exc}"})
                        if not public_video_url and image_url:
                            try:
                                media_record = seen_media.get(image_url, {})
                                if media_record.get("body"):
                                    public_image_url, _ = upload_bytes_to_tmpfiles(
                                        media_record["body"],
                                        "source-image.jpg",
                                        (media_record.get("content_type") or "image/jpeg").split(";")[0].strip(),
                                    )
                                else:
                                    public_image_url, _ = rehost_media(
                                        request_context,
                                        image_url,
                                        "source-image.jpg",
                                        referer=post_link,
                                    )
                            except Exception as exc:
                                errors.append({"source": post_link, "error": f"Image rehost failed: {exc}"})

                        if not public_image_url and not public_video_url:
                            try:
                                screenshot_bytes = post_page.screenshot(full_page=False)
                                public_image_url, _ = upload_bytes_to_tmpfiles(
                                    screenshot_bytes,
                                    "source-screenshot.png",
                                    "image/png",
                                )
                            except Exception as exc:
                                errors.append(
                                    {
                                        "source": post_link,
                                        "error": f"Screenshot fallback failed: {exc}",
                                    }
                                )
                                errors.append(
                                    {
                                        "source": post_link,
                                        "error": "No media could be rehosted to a public URL",
                                    }
                                )
                                continue

                        return {
                            "ok": True,
                            "sourceTitle": source["title"],
                            "sourcePageLink": source["url"],
                            "sourcePostLink": post_link,
                            "sourceLink": post_link,
                            "sourceHandle": handle,
                            "sourceSnippet": caption or description,
                            "sourceImageUrl": public_image_url,
                            "sourceVideoUrl": public_video_url,
                            "sourceImageOriginalUrl": image_url,
                            "sourceVideoOriginalUrl": video_url,
                            "sourceMediaUrl": public_video_url or public_image_url,
                            "sourceResolution": "browser-rendered-post + tmpfiles",
                            "attemptedSources": errors,
                        }
                    finally:
                        post_page.close()
                except Exception as exc:
                    errors.append({"source": source["url"], "error": str(exc)})
                finally:
                    if page:
                        page.close()
            context.close()
        finally:
            browser.close()

    return {
        "ok": False,
        "error": "No source page yielded an extractable Instagram post",
        "attemptedSources": errors,
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            json_response(self, 200, {"ok": True})
            return
        json_response(self, 404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/pull-source":
            json_response(self, 404, {"ok": False, "error": "Not found"})
            return
        length = int(self.headers.get("content-length") or "0")
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw or "{}")
            sources = normalize_sources(payload.get("sources"))
            exclude_post_links = payload.get("excludePostLinks") or []
            result = pull_source(sources, exclude_post_links=exclude_post_links)
            json_response(self, 200 if result.get("ok") else 502, result)
        except Exception as exc:
            json_response(self, 500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"instagram source puller listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
