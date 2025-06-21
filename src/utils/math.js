// Math utility functions

export function poissonRandom(lambda) {
  if (lambda <= 0) return 0;
  let L = Math.exp(-lambda);
  let p = 1.0;
  let k = 0;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return Math.max(0, k - 1) + (Math.random() < lambda ? 1 : 0);
}

export function gaussianClamp(mean, sigma) {
  const u = Math.random();
  const v = Math.random();
  const x = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const raw = mean + x * sigma;
  return Math.min(1, Math.max(0, raw));
}

export function randomNormal() {
  let u = 0, v = 0;
  while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
  while(v === 0) v = Math.random();
  let z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
  // Clamp z to a reasonable range (e.g., +/- 7 standard deviations)
  // to prevent extreme outliers from floating point issues or rare stats.
  z = Math.max(-7.0, Math.min(7.0, z));
  return z;
}
