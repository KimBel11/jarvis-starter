"""Private multi-window browser for Jarvis commands without a connected Mac app."""
import sys, json, uuid
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = None
    pages = {}
    active = None
    minimized = set()

    def forget(window_id):
        global active
        pages.pop(window_id, None)
        minimized.discard(window_id)
        if active == window_id:
            active = next(reversed(pages), None)

    def register(page):
        global active
        for window_id, existing in pages.items():
            if existing is page:
                return window_id
        window_id = str(uuid.uuid4())
        pages[window_id] = page
        page.set_default_timeout(15000)
        page.on('close', lambda: forget(window_id))
        active = window_id
        return window_id

    def info(window_id):
        page = pages[window_id]
        return {'windowId': window_id, 'url': page.url, 'title': page.title(),
                'minimized': window_id in minimized, 'background': True}

    def inventory():
        for window_id, page in list(pages.items()):
            if page.is_closed():
                forget(window_id)
        return {'windows': [info(window_id) for window_id in list(pages)],
                'activeWindowId': active, 'background': True}

    for line in sys.stdin:
        try:
            command = json.loads(line)
            action = command['action']
            if action == 'list':
                result = inventory()
            else:
                window_id = command.get('windowId')
                if window_id is not None and (window_id not in pages or pages[window_id].is_closed()):
                    raise ValueError('Browser window is closed or does not exist')
                if action == 'open' and window_id is None:
                    if browser is None:
                        browser = p.chromium.launch_persistent_context(
                            sys.argv[1], channel='chrome', headless=True,
                            viewport={'width': 1280, 'height': 900}, accept_downloads=False)
                        # Persistent context starts with a blank page; do not expose a phantom window.
                        browser.on('page', register)
                        for page in browser.pages:
                            register(page)
                        window_id = active or register(browser.new_page())
                    else:
                        window_id = register(browser.new_page())
                else:
                    window_id = window_id or active
                if window_id not in pages or pages[window_id].is_closed():
                    raise ValueError('No browser window is open. Open a URL first.')
                page = pages[window_id]
                active = window_id
                result = {}
                if action in ('open', 'navigate'):
                    page.goto(command['url'], wait_until='domcontentloaded', timeout=45000)
                elif action == 'back':
                    page.go_back(wait_until='domcontentloaded')
                elif action == 'forward':
                    page.go_forward(wait_until='domcontentloaded')
                elif action == 'reload':
                    page.reload(wait_until='domcontentloaded')
                elif action == 'click':
                    page.locator(command['selector']).first.click()
                elif action == 'type':
                    page.locator(command['selector']).first.fill(command.get('text', ''))
                elif action == 'read':
                    result = page.evaluate("""() => ({text:(document.body?.innerText||'').slice(0,40000),links:Array.from(document.querySelectorAll('a[href]')).slice(0,150).map(a=>({text:a.innerText.slice(0,200),href:a.href}))})""")
                elif action == 'close':
                    page.close()
                    forget(window_id)
                elif action == 'minimize':
                    minimized.add(window_id)
                elif action == 'restore':
                    minimized.discard(window_id)
                else:
                    raise ValueError('Unsupported browser action')
                if window_id in pages:
                    result.update(info(window_id))
                else:
                    result.update(windowId=window_id, closed=True, background=True)
                result.update(inventory())
            print(json.dumps({'ok': True, 'result': result}), flush=True)
        except Exception as e:
            print(json.dumps({'ok': False, 'error': str(e)[:1000]}), flush=True)
    if browser:
        browser.close()
