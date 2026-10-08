"""Capture iPad 13" App Store screenshots (2048x2732) of the live customer app."""
import json, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = "https://mrc-barbershop-mrc-0043.vercel.app"
OUT = "/home/hatch/workspace/mrc-barbershop/assets/store/screenshots/ipad"
EMAIL = "apple.reviewer@mrc-demo.com"
PASSWORD = "Review123!"
BARBER_ID = "0ba6dee5-c9b1-4cba-9aa5-0d58da0033ce"

def api_login():
    req = urllib.request.Request(
        f"{BASE}/api/auth/customer",
        data=json.dumps({"mode": "login", "email": EMAIL, "password": PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    return d["token"], d["customer"].get("name", "")

def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    token, name = api_login()
    print("logged in as", name)
    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    # playwright needs the proxy split into server/username/password
    proxy = None
    if proxy_url:
        from urllib.parse import urlparse
        u = urlparse(proxy_url)
        proxy = {"server": f"{u.scheme}://{u.hostname}:{u.port}"}
        if u.username:
            from urllib.parse import unquote
            proxy["username"] = unquote(u.username)
            proxy["password"] = unquote(u.password or "")
    with sync_playwright() as p:
        browser = p.chromium.launch(proxy=proxy)
        # iPad 13" native: 2048x2732
        ctx = browser.new_context(viewport={"width": 1024, "height": 1366},
                                  device_scale_factor=2, is_mobile=False)
        page = ctx.new_page()
        # seed auth token
        page.goto(BASE + "/customer/login")
        page.evaluate(
            """([tok, nm]) => {
                localStorage.setItem('mrc_customer_token', tok);
                localStorage.setItem('mrc_customer_name', nm);
            }""",
            [token, name],
        )
        shots = [
            ("01-home-map-ipad.png", "/customer", 6),
            ("02-booking-ipad.png", f"/customer/book/{BARBER_ID}", 5),
            ("03-offers-ipad.png", "/customer/offers", 4),
            ("04-appointments-ipad.png", "/customer/appointments", 4),
            ("05-profile-ipad.png", "/customer/profile", 4),
        ]
        for fname, path, wait in shots:
            page.goto(BASE + path)
            page.wait_for_timeout(wait * 1000)
            page.screenshot(path=f"{OUT}/{fname}")
            print("saved", fname, page.viewport_size)
        browser.close()
    print("done")

if __name__ == "__main__":
    main()
