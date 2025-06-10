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
