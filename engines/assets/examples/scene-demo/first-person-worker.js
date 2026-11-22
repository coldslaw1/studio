// Worker for the first-person and orbit views: draws each picture off the page's own thread and
// hands it back as one bitmap. Messages in: { init } once, then one request a picture (see
// first-person-core.js). Messages out: { ready }, then { picture, cols, rows, eye, ms, stats, ... },
// or { error } when something went wrong.
import { createFpRenderer } from './first-person-core.js';

let renderer = null; let noSky = false; let noWeather = false;
self.onmessage = async ({ data }) => {
  try {
    if (data.init) { renderer = await createFpRenderer(data.init); self.postMessage({ ready: true }); return; }
    if (data.sky && !renderer.skyReady && !noSky) {
      // the first request with a sample of the sky: take up the sky engine (once); without it the hour is simply not followed
      try { await renderer.useSky(); } catch (e) { noSky = true; self.postMessage({ warn: 'the sky engine is not vendored here, so the 3D views keep the look they were built with (' + String(e?.message ?? e) + ')' }); }
    }
    if (data.weather && !renderer.weatherReady && !noWeather) {
      try { await renderer.useWeather(); } catch (e) { noWeather = true; self.postMessage({ warn: 'the weather engine is not vendored here, so the 3D views show no rain or fog (' + String(e?.message ?? e) + ')' }); }
    }
    const out = renderer.frame(data);
    self.postMessage(out, [out.picture, out.depth.buffer]);
  } catch (e) {
    self.postMessage({ error: String(e?.message ?? e) });
  }
};
