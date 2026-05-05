'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')

/**
 * A puppeteer-extra plugin that integrates `ghost-cursor` for human-like
 * mouse movements powered by Bezier curves.
 *
 * Automatically attaches a cursor instance to every page and adds two
 * convenience helpers:
 *
 * - `page.humanClick(selectorOrHandle)` — moves to the element's centre
 *   using a curved path, then fires a native mouse click.
 * - `page.humanMove(x, y)` — moves to the given coordinates with a
 *   natural curve.
 * - `page.ghostCursor` — the raw `GhostCursor` instance for advanced use.
 *
 * ## Why `boundingBox()` instead of `cursor.click(handle)` directly?
 *
 * `ghost-cursor`'s built-in `click(ElementHandle)` calls
 * `elementHandle.clickablePoint()` internally, which can throw or silently
 * miss when the element is partially off-screen or inside a scrollable
 * container.  Resolving the target coordinates via `handle.boundingBox()`
 * first and then calling `page.mouse.click(x, y)` after the move is more
 * reliable across viewport sizes and page layouts.
 *
 * @param {object} [opts]
 * @param {number} [opts.moveDelay=0] Extra delay (ms) to add between move
 *   and click, simulating a moment of hesitation.
 *
 * @example
 * const puppeteer = require('puppeteer-extra')
 * const GhostCursorPlugin = require('puppeteer-extra-plugin-ghost-cursor')
 *
 * puppeteer.use(GhostCursorPlugin())
 *
 * const browser = await puppeteer.launch({ headless: false })
 * const page = await browser.newPage()
 * await page.goto('https://example.com')
 *
 * // Human-like click on a CSS selector
 * await page.humanClick('button#submit')
 *
 * // Human-like click on an ElementHandle
 * const btn = await page.$('button#submit')
 * await page.humanClick(btn)
 *
 * // Raw cursor access for custom paths
 * await page.ghostCursor.moveTo({ x: 500, y: 300 })
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor (opts = {}) {
    super(opts)
  }

  get name () {
    return 'ghost-cursor'
  }

  get defaults () {
    return { moveDelay: 0 }
  }

  async onPageCreated (page) {
    let createCursor
    try {
      createCursor = require('ghost-cursor').createCursor
    } catch (_) {
      throw new Error(
        "puppeteer-extra-plugin-ghost-cursor: peer dependency 'ghost-cursor' not found.\n" +
        'Please install it: npm install ghost-cursor'
      )
    }

    const cursor = createCursor(page)

    /** The underlying GhostCursor instance. */
    page.ghostCursor = cursor

    /**
     * Move to the centre of an element using a Bezier-curved path, then
     * click it via a native mouse event.
     *
     * Coordinates are resolved with `ElementHandle.boundingBox()` rather
     * than `cursor.click(handle)` to avoid silent misses on elements that
     * are partially off-screen or inside scrollable containers.
     *
     * @param {string|import('puppeteer').ElementHandle} selectorOrHandle
     */
    page.humanClick = async (selectorOrHandle) => {
      const handle =
        typeof selectorOrHandle === 'string'
          ? await page.$(selectorOrHandle)
          : selectorOrHandle

      if (!handle) {
        throw new Error(
          `humanClick: element not found for selector "${selectorOrHandle}"`
        )
      }

      const box = await handle.boundingBox()
      if (!box) {
        throw new Error(
          'humanClick: element has no boundingBox — it may be hidden or detached'
        )
      }

      const x = box.x + box.width / 2
      const y = box.y + box.height / 2

      await cursor.moveTo({ x, y })

      if (this.opts.moveDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.opts.moveDelay))
      }

      await page.mouse.click(x, y)
    }

    /**
     * Move the cursor to (x, y) using a Bezier-curved path.
     *
     * @param {number} x
     * @param {number} y
     */
    page.humanMove = async (x, y) => {
      await cursor.moveTo({ x, y })
    }
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
