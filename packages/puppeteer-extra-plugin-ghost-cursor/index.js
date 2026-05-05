'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')
const fs = require('fs')
const path = require('path')

// ---------------------------------------------------------------------------
// Bezier curve helper — used as fallback for Playwright pages where
// ghost-cursor is not available, and for humanMove() on both platforms.
// ---------------------------------------------------------------------------

/**
 * Generate N points along a cubic Bezier curve between (x0,y0) and (x1,y1).
 * Control points are randomised to produce natural-looking paths.
 * @private
 */
function bezierPoints (x0, y0, x1, y1, steps) {
  const cp1x = x0 + (x1 - x0) * (0.2 + Math.random() * 0.3)
  const cp1y = y0 + (Math.random() - 0.5) * Math.abs(y1 - y0) * 1.2
  const cp2x = x0 + (x1 - x0) * (0.6 + Math.random() * 0.3)
  const cp2y = y1 + (Math.random() - 0.5) * Math.abs(y1 - y0) * 1.2
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    pts.push({
      x: mt ** 3 * x0 + 3 * mt ** 2 * t * cp1x + 3 * mt * t ** 2 * cp2x + t ** 3 * x1,
      y: mt ** 3 * y0 + 3 * mt ** 2 * t * cp1y + 3 * mt * t ** 2 * cp2y + t ** 3 * y1
    })
  }
  return pts
}

// ---------------------------------------------------------------------------
// Platform detection helpers
// ---------------------------------------------------------------------------

/** Returns true when `page` is a Playwright Page (has locator API). */
function isPlaywright (page) {
  return typeof page.locator === 'function'
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * A `puppeteer-extra` / `playwright-extra` plugin that integrates
 * [`ghost-cursor`](https://github.com/Xetera/ghost-cursor) for human-like
 * mouse movements on Puppeteer, and a built-in Bezier curve implementation
 * for Playwright.
 *
 * Attached to every page:
 * - `page.humanClick(selectorOrHandle)` — curved move → native click
 * - `page.humanMove(x, y)` — curved move without click
 * - `page.ghostCursor` — raw GhostCursor (Puppeteer only, `null` on Playwright)
 *
 * ### Autonomous debug mode (`opts.debug: true`)
 *
 * When a `humanClick` fails, the plugin automatically:
 * 1. Takes a full-page screenshot and saves it to `opts.debugDir`.
 * 2. Logs the target selector, page URL and error message.
 * 3. Retries **once** using a direct `page.click()` / `locator.click()` call
 *    as a fallback, so a transient positioning error does not abort the run.
 * 4. Reports whether the fallback succeeded.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.moveDelay=0]       Ms to wait between move and click.
 * @param {boolean} [opts.debug=false]       Enable autonomous debug mode.
 * @param {string}  [opts.debugDir='ghost-cursor-debug'] Directory for debug artefacts.
 *
 * @example
 * // Puppeteer
 * const puppeteer = require('puppeteer-extra')
 * const GhostCursorPlugin = require('puppeteer-extra-plugin-ghost-cursor')
 * puppeteer.use(GhostCursorPlugin({ debug: true }))
 *
 * @example
 * // Playwright
 * const { chromium } = require('playwright-extra')
 * const GhostCursorPlugin = require('puppeteer-extra-plugin-ghost-cursor')
 * chromium.use(GhostCursorPlugin())
 * const browser = await chromium.launch()
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor (opts = {}) {
    super(opts)
  }

  get name () { return 'ghost-cursor' }

  get defaults () {
    return {
      moveDelay: 0,
      debug: false,
      debugDir: 'ghost-cursor-debug'
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Ensure the debug directory exists. */
  _ensureDebugDir () {
    if (!fs.existsSync(this.opts.debugDir)) {
      fs.mkdirSync(this.opts.debugDir, { recursive: true })
    }
  }

  /**
   * Autonomous debug handler — called when humanClick throws.
   * Saves a screenshot, logs context, retries once with a direct click.
   *
   * @param {object} page
   * @param {string} selector  - CSS selector used (or '[ElementHandle]')
   * @param {Error}  err       - The original error
   * @param {object} [handle]  - ElementHandle for Puppeteer direct-click fallback
   * @returns {Promise<boolean>} true if the fallback click succeeded
   */
  async _debugAndRetry (page, selector, err, handle) {
    this._ensureDebugDir()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const slug = (selector || 'handle').replace(/[^\w-]/g, '_').slice(0, 40)
    const screenshotPath = path.join(this.opts.debugDir, `${ts}_${slug}.jpg`)

    // 1 — screenshot
    try {
      await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 70, fullPage: true })
    } catch (_) { /* non-blocking */ }

    // 2 — log
    console.warn(
      `[ghost-cursor] humanClick failed on "${selector}" @ ${page.url()}\n` +
      `  Error   : ${err.message}\n` +
      `  Snapshot: ${screenshotPath}`
    )

    // 3 — fallback click (direct, no curve)
    try {
      if (isPlaywright(page)) {
        await page.locator(selector).click({ timeout: 5000 })
      } else if (handle) {
        await handle.click()
      } else {
        await page.click(selector, { timeout: 5000 })
      }
      console.warn(`[ghost-cursor] Fallback click succeeded for "${selector}".`)
      return true
    } catch (retryErr) {
      console.warn(`[ghost-cursor] Fallback click also failed: ${retryErr.message}`)
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Puppeteer path — uses ghost-cursor
  // -------------------------------------------------------------------------

  /**
   * Wire up a ghost-cursor on a Puppeteer page and attach helpers.
   * @private
   */
  async _setupPuppeteer (page) {
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
    page.ghostCursor = cursor

    const self = this

    page.humanMove = async (x, y) => {
      await cursor.moveTo({ x, y })
    }

    /**
     * Move to the element centre using a Bezier-curved path, then click.
     *
     * Coordinates are resolved via `ElementHandle.boundingBox()` rather than
     * `cursor.click(handle)` to avoid silent misses on elements that are
     * partially off-screen or inside scrollable containers.
     *
     * @param {string|import('puppeteer').ElementHandle} selectorOrHandle
     */
    page.humanClick = async (selectorOrHandle) => {
      const isPureHandle = typeof selectorOrHandle !== 'string'
      const selector = isPureHandle ? '[ElementHandle]' : selectorOrHandle
      const handle = isPureHandle ? selectorOrHandle : await page.$(selectorOrHandle)

      const run = async () => {
        if (!handle) throw new Error(`Element not found for selector "${selector}"`)
        const box = await handle.boundingBox()
        if (!box) throw new Error(`Element has no boundingBox — hidden or detached`)
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await cursor.moveTo({ x, y })
        if (self.opts.moveDelay > 0) {
          await new Promise(r => setTimeout(r, self.opts.moveDelay))
        }
        await page.mouse.click(x, y)
      }

      if (!self.opts.debug) {
        return run()
      }
      try {
        return await run()
      } catch (err) {
        const fallbackOk = await self._debugAndRetry(page, selector, err, handle)
        if (!fallbackOk) throw err
      }
    }
  }

  // -------------------------------------------------------------------------
  // Playwright path — built-in Bezier curves via page.mouse
  // -------------------------------------------------------------------------

  /**
   * Wire up Bezier-curve mouse helpers on a Playwright page.
   * ghost-cursor is not used on this path.
   * @private
   */
  async _setupPlaywright (page) {
    page.ghostCursor = null // not available on Playwright

    const self = this

    page.humanMove = async (x, y) => {
      const currentPos = { x: 0, y: 0 } // Playwright has no getCursorPos; start from 0,0
      const pts = bezierPoints(currentPos.x, currentPos.y, x, y, 20)
      for (const pt of pts) {
        await page.mouse.move(pt.x, pt.y)
      }
    }

    /**
     * Move to the element centre via a Bezier path, then click.
     * Uses Playwright's `locator().boundingBox()` for accurate coordinates.
     *
     * @param {string|import('playwright').Locator} selectorOrLocator
     */
    page.humanClick = async (selectorOrLocator) => {
      const isLocator = selectorOrLocator && typeof selectorOrLocator.boundingBox === 'function'
      const selector = isLocator ? '[Locator]' : selectorOrLocator
      const locator = isLocator ? selectorOrLocator : page.locator(selector)

      const run = async () => {
        const box = await locator.boundingBox({ timeout: 5000 })
        if (!box) throw new Error(`Element has no boundingBox — hidden or detached`)
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        // Move in a Bezier curve toward the target
        const pts = bezierPoints(x - 200, y - 100, x, y, 20)
        for (const pt of pts) {
          await page.mouse.move(pt.x, pt.y)
        }
        if (self.opts.moveDelay > 0) {
          await new Promise(r => setTimeout(r, self.opts.moveDelay))
        }
        await page.mouse.click(x, y)
      }

      if (!self.opts.debug) {
        return run()
      }
      try {
        return await run()
      } catch (err) {
        const fallbackOk = await self._debugAndRetry(page, selector, err)
        if (!fallbackOk) throw err
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle hook
  // -------------------------------------------------------------------------

  async onPageCreated (page) {
    if (isPlaywright(page)) {
      await this._setupPlaywright(page)
    } else {
      await this._setupPuppeteer(page)
    }
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
