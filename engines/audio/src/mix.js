// Settings for the safety limiter on the master output (a Web Audio
// DynamicsCompressor). The browser's default compressor starts squeezing at
// -24 dB, which makes ordinary music swell and dip whenever an effect plays.
// These settings leave a normal mix alone and only catch peaks that would clip.

/** Limiter settings createAudio puts on its master output. */
export const LIMITER = { threshold: -3, knee: 3, ratio: 20, attack: 0.002, release: 0.12 };
