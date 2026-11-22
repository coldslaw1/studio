// Lightning and thunder for a storm. A strike is a short run of flashes now and a thunderclap
// later: sound takes about three seconds a kilometre. All of its state is plain numbers, so it
// saves and loads with the weather.
import { lerp } from './noise.js';

const SPEED_OF_SOUND = 343; // metres a second
const FLASH_FADE = 0.11;    // seconds for a flash to fall to about a third

/** Fresh lightning state: { next, age, power, pulses, pending }. */
export function createLightningState() {
  return { next: 3, age: 1e9, power: 0, pulses: [], pending: [] };
}

/**
 * Move lightning on by dt seconds.
 * @param {object} st       From createLightningState (changed in place).
 * @param {number} dt       Seconds.
 * @param {number} storm    The storm channel, 0..1. Under 0.25 nothing strikes.
 * @param {() => number} rng
 * @param {(name:string, event:object) => void} emit  Gets 'lightning' { distance, bearing, power } and,
 *   later, 'thunder' { distance, power, delay }.
 * @returns {number} how bright the flash is right now, 0..1
 */
export function stepLightning(st, dt, storm, rng, emit) {
  st.age += dt;
  if (storm > 0.25) {
    st.next -= dt;
    if (st.next <= 0) {
      const distance = Math.round(250 + rng() * rng() * lerp(7000, 3500, storm)); // metres; most are near in a full storm
      const power = Math.max(0.25, 1 - distance / 7500);
      const bearing = Math.round(rng() * 360);
      st.pulses = [0];
      const more = Math.floor(rng() * 3);
      for (let i = 0; i < more; i++) st.pulses.push(st.pulses[i] + 0.07 + rng() * 0.12);
      st.age = 0; st.power = power;
      const delay = Math.min(12, distance / SPEED_OF_SOUND);
      st.pending.push({ in: delay, distance, power, delay });
      st.next = lerp(18, 4, storm) * (0.4 + rng() * 1.2);
      emit('lightning', { distance, bearing, power });
    }
  } else if (st.next > 4) st.next = 4; // the next storm does not wait long for its first strike
  for (let i = st.pending.length - 1; i >= 0; i--) {
    const p = st.pending[i];
    p.in -= dt;
    if (p.in <= 0) { st.pending.splice(i, 1); emit('thunder', { distance: p.distance, power: p.power, delay: p.delay }); }
  }
  return flashOf(st);
}

/** How bright the flash is for a state, 0..1. */
export function flashOf(st) {
  let flash = 0;
  for (const at of st.pulses) {
    const t = st.age - at;
    if (t >= 0 && t < 1) flash = Math.max(flash, st.power * Math.exp(-t / FLASH_FADE));
  }
  return flash < 0.004 ? 0 : Math.min(1, flash);
}
