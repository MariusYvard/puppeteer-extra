# puppeteer-extra-plugin-ghost-cursor

> A [`puppeteer-extra`](https://github.com/berstend/puppeteer-extra) plugin that integrates [`ghost-cursor`](https://github.com/Xetera/ghost-cursor) for human-like mouse movements powered by Bezier curves.

## Install

```bash
npm install puppeteer-extra-plugin-ghost-cursor ghost-cursor
```

## Usage

```js
const puppeteer = require('puppeteer-extra')
const GhostCursorPlugin = require('puppeteer-extra-plugin-ghost-cursor')

puppeteer.use(GhostCursorPlugin())

const browser = await puppeteer.launch({ headless: false })
const page = await browser.newPage()
await page.goto('https://example.com')

// Human-like click via CSS selector
await page.humanClick('button#submit')

// Human-like click via ElementHandle
const btn = await page.$('button#submit')
await page.humanClick(btn)

// Move without clicking
await page.humanMove(500, 300)

// Raw cursor access for custom interactions
await page.ghostCursor.moveTo({ x: 200, y: 400 })
```

## Options

```js
GhostCursorPlugin({
  moveDelay: 150 // ms to wait between move and click (simulates hesitation)
})
```

## API

### `page.humanClick(selectorOrHandle)`

Moves the cursor to the centre of the target element using a Bezier-curved path, then fires a native mouse click.

Accepts either a CSS selector string or an `ElementHandle`. Coordinates are resolved via `ElementHandle.boundingBox()` to ensure reliable clicks on elements that may be partially off-screen or inside scrollable containers.

### `page.humanMove(x, y)`

Moves the cursor to the given viewport coordinates using a Bezier-curved path.

### `page.ghostCursor`

The underlying `GhostCursor` instance, for advanced use cases not covered by the helpers above.

## Why `boundingBox()` instead of `cursor.click(handle)` directly?

`ghost-cursor`'s built-in `click(ElementHandle)` calls `elementHandle.clickablePoint()` internally. This can throw or silently miss when the element is partially off-screen or inside a scrollable container. Resolving coordinates via `handle.boundingBox()` first and then dispatching `page.mouse.click(x, y)` after the move is more reliable across different viewport sizes and page layouts.

## License

MIT
