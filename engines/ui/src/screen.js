// A custom screen: your own update and draw, living in the ui's menu stack.
// It blocks the game like a menu, is drawn where menus are drawn, and kit
// menus (a confirm box, the pause menu) can open on top of it.

/**
 * createScreen(options, close) -> screen   (normally made by ui.openScreen)
 *   options: {
 *     id = 'screen',                         name reported by snapshot().screen
 *     update(dt, input, viewport),           called every update while this screen is on top.
 *                                            input is core's input (null if ui.update got none)
 *     draw(ctx, theme, viewport, frame),     required. frame: { width, height, time, motion } plus the kit's
 *                                            drawing helpers: frame.drawSurface(ctx, rect, theme, unit, o),
 *                                            frame.drawIcon(ctx, icon, cx, cy, size, color),
 *                                            frame.drawSlot(ctx, cell, rect, theme, unit, o),
 *                                            frame.drawText(ctx, theme, text, x, y, { size, color, align, maxWidth, weight }),
 *                                            frame.focusRing(ctx, rect, theme, unit)
 *     wheel(deltaY, pointer, viewport),      the mouse wheel or a trackpad scroll while this screen is on top.
 *                                            deltaY: pixels, positive is down. pointer: { x, y } or null
 *     backdrop = 'dim',                      'dim', 'solid' or 'none', drawn before draw()
 *     cancel = true,                         cancel / pause closes the screen. false: handle it yourself
 *     onCancel(),                            called instead of closing when cancel is pressed
 *     onClose(),                             called once when the screen leaves the stack
 *     snapshot(),                            extra plain data merged into ui.snapshot() (for play-tests)
 *   }
 *   close: function that removes this screen from the stack (given by the ui).
 * viewport is { width, height, unit, safe, device }.
 */
export function createScreen(options, close) {
  if (!options || typeof options.draw !== 'function') throw new Error('ui.openScreen: options.draw(ctx, theme, viewport) must be a function');
  for (const name of ['update', 'wheel', 'onCancel', 'onClose', 'snapshot']) {
    if (options[name] !== undefined && typeof options[name] !== 'function') throw new Error(`ui.openScreen: "${name}" must be a function`);
  }
  const backdrop = options.backdrop ?? 'dim';
  let viewport = null;
  let closed = false;
  const screen = {
    custom: true,
    id: options.id ?? 'screen',
    age: 0,
    capturing: null,
    canCancel: options.cancel !== false,
    setViewport(v) { viewport = v; },
    tick(dt) { screen.age += dt; },
    update(dt, input) { if (options.update) options.update(dt, input, viewport); },
    /** action('cancel') closes the screen (or calls onCancel). Other actions are yours to read from input. */
    action(name) {
      if (name !== 'cancel' || options.cancel === false) return false;
      if (options.onCancel) options.onCancel(); else screen.close();
      return true;
    },
    pointer() { return true; },
    wheel(deltaY, pointer) { if (options.wheel) options.wheel(deltaY, pointer, viewport); },
    draw(ctx, theme, frame) {
      ctx.save();
      if (backdrop === 'solid' || backdrop === 'dim') {
        ctx.fillStyle = backdrop === 'solid' ? theme.bg : theme.dim;
        ctx.fillRect(0, 0, frame.width, frame.height);
      }
      ctx.restore();
      ctx.save();
      options.draw(ctx, theme, viewport, frame);
      ctx.restore();
    },
    snapshot() {
      return { screen: screen.id, title: '', focus: null, capturing: null, items: [], ...(options.snapshot ? options.snapshot() : {}) };
    },
    /** close() removes the screen (and anything opened on top of it). */
    close() { close(screen); },
    /** Called by the ui when the screen has left the stack. */
    left() {
      if (closed) return;
      closed = true;
      if (options.onClose) options.onClose();
    },
  };
  return screen;
}
