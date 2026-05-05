# puppeteer-extra-plugin-ghost-cursor

> A [`puppeteer-extra`](https://github.com/berstend/puppeteer-extra) / [`playwright-extra`](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) plugin for human-like mouse movements powered by Bezier curves.

On **Puppeteer** it wraps [`ghost-cursor`](https://github.com/Xetera/ghost-cursor).
On **Playwright** it uses a built-in Bezier curve implementation via `page.mouse`.

## Install

```bash
# Puppeteer
npm install puppeteer-extra-plugin-ghost-cursor ghost-cursor

# Playwright (ghost-cursor not required)
npm install puppeteer-extra-plugin-ghost-cursor
```

## Usage

### Puppeteer

```js
const puppeteer = require('puppeteer-extra')
const GhostCursorPlugin = require('puppeteer-extra-plugin-ghost-cursor')

puppeteer.use(GhostCursorPlugin())

const browser = await puppeteer.launch({ headless: false })
const page = await browser.newPage()
await page.goto('https://example.com')

await page.humanClick('button#submit')       // curved move + click
await page.humanMove(500, 300)               // curved move, no click
await page.ghostCursor.moveTo({ x: 200, y: 400 }) // raw cursor access
```

### Playwright

```js
const { chromium } = require('playwright-extra')
const GhostCursorPlugin = require('puppeteer-extra-plugin-ghost-cursor')

chromium.use(GhostCursorPlugin())

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage()
await page.goto('https://example.com')

await page.humanClick('button#submit')       // Bezier path + click
await page.humanMove(500, 300)               // Bezier path, no click
// page.ghostCursor is null on Playwright
```

## Autonomous debug mode

Enable `debug: true` to get automatic failure recovery and diagnostics:

```js
puppeteer.use(GhostCursorPlugin({
  debug: true,
  debugDir: 'my-debug-screenshots'  // default: 'ghost-cursor-debug'
}))
```

When `humanClick` fails, the plugin automatically:

1. Takes a full-page JPEG screenshot and saves it to `debugDir`.
2. Logs the target selector, current page URL and error message.
3. Retries **once** using a direct `page.click()` fallback (no cursor movement).
4. Reports whether the fallback succeeded.

If the fallback also fails, the original error is re-thrown — nothing is silently swallowed.

```
[ghost-cursor] humanClick failed on "button#submit" @ https://example.com
  Error   : Element has no boundingBox — hidden or detached
  Snapshot: ghost-cursor-debug/2025-01-15T10-30-00-000Z_button_submit.jpg
[ghost-cursor] Fallback click succeeded for "button#submit".
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `moveDelay` | `number` | `0` | Ms to wait between move completion and click |
| `debug` | `boolean` | `false` | Enable autonomous debug mode |
| `debugDir` | `string` | `'ghost-cursor-debug'` | Directory for debug screenshots |

## API

### `page.humanClick(selectorOrHandle)`

Moves to the centre of the target element via a Bezier-curved path, then fires a native mouse click. Accepts a CSS selector string or an `ElementHandle` (Puppeteer) / `Locator` (Playwright).

Coordinates are resolved via `boundingBox()` rather than ghost-cursor's built-in `click(handle)` to avoid silent misses on elements that are partially off-screen or inside scrollable containers.

### `page.humanMove(x, y)`

Moves the cursor to the given viewport coordinates via a Bezier-curved path, without clicking.

### `page.ghostCursor`

The underlying `GhostCursor` instance (Puppeteer only). `null` on Playwright.

## License

MIT
