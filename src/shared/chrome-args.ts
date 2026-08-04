/**
 * Flags that let a warmup session run without taking over the operator's
 * screen.
 *
 * Input is already non-intrusive without any of this: the driver dispatches
 * mouse and keyboard over CDP, which goes straight to the browser target. The
 * real cursor never moves, keyboard focus is never taken, and typing cannot
 * land in whatever the operator is doing. Measured: the page still sees
 * `isTrusted === true` on both.
 *
 * What these solve is the window being *visible*. Position it off-screen and
 * Chrome may treat it as occluded — clamping timers to 1/sec, starving
 * requestAnimationFrame and pausing video. Watch-to-completion is a core
 * warmup action, so a throttled session would silently do nothing.
 *
 * ⚠️ Measured at 60fps / 10 timers-per-sec / video playing with these present.
 * The measurement could NOT prove they are each necessary, because Playwright
 * injects three of them by default and the driver-launched comparison was
 * therefore not flag-free. They are passed explicitly rather than inherited
 * from a driver's undocumented defaults — and CalculateNativeWinOcclusion is
 * not in Playwright's set at all.
 */
export const BACKGROUND_ARGS = [
  '--window-position=-32000,-32000',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'
]
