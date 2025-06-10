// Intensity and frequency calculation utility functions
import { poissonRandom } from './math.js'

export function getIntensityForLayer(layerName, progress) {
  // Example: intensity increases with progress for most layers
  // 'breath' layer has a sinusoidal intensity pattern
  if (layerName !== 'breath') {
    // Linear increase, capped, ensuring it starts reasonably
    return Math.min(2, 0.5 + progress * 1.5) // Example: 0.5 to 2.0
  }
  // Sinusoidal pattern for breath, ranging from 1 to 2 and back to 1
  return 1 + Math.abs(Math.sin(progress * Math.PI))
}

export function interpolateIntensity(layerData, intensity) {
  const intensityKeys = Object.keys(layerData.intensity)
    .map(Number)
    .sort((a, b) => a - b)

  let lowerKey = intensityKeys.findLast((key) => key <= intensity)
  if (lowerKey === undefined) lowerKey = intensityKeys[0] // Default to the lowest if no key is <= intensity

  let upperKey = intensityKeys.find((key) => key > intensity)
  if (upperKey === undefined) upperKey = lowerKey // If no key is > intensity, use lowerKey (or highest key)

  const weight =
    lowerKey === upperKey ? 0 : (intensity - lowerKey) / (upperKey - lowerKey)

  return { lowerKey, upperKey, weight }
}

export function calculateFrequenciesAndCounts(
  layerName,
  layerData,
  intensity,
  lowerKey,
  upperKey,
  config
) {
  const sets = Object.keys(layerData.sets)
  const frequencies = {} // Actual event frequencies (e.g., events per second)
  const scaledFrequencies = {} // Frequencies scaled by scheduleGranularity for direct use in poisson/counts
  const counts = {} // Target number of events in a sub-block, if using variance

  const weight =
    lowerKey === upperKey ? 0 : (intensity - lowerKey) / (upperKey - lowerKey)

  for (const set of sets) {
    const frequencyKey = `${set}_frequency`

    // Determine base frequency for the set from intensity keyframes
    // Fallback: set-specific frequency -> general frequency for the keyframe -> layer's base frequency
    const lowerFrequency =
      layerData.intensity[lowerKey][frequencyKey] ??
      layerData.intensity[lowerKey].frequency ??
      layerData.frequency
    const upperFrequency =
      layerData.intensity[upperKey][frequencyKey] ??
      layerData.intensity[upperKey].frequency ??
      layerData.frequency

    // Interpolate the base frequency
    const baseFrequency =
      (1 - weight) * lowerFrequency + weight * upperFrequency

    // Store the direct frequency (events per frequencyUnit, e.g., per minute)
    frequencies[set] = baseFrequency

    // Scaled frequency: events per scheduleGranularity (e.g., events per second if scheduleGranularity is 1)
    // This is what's often used for Poisson distribution or direct event counts in a sub-block.
    const freqPerScheduleUnit =
      baseFrequency * (config.scheduleGranularity / config.frequencyUnit)
    scaledFrequencies[
      `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Frequency`
    ] = freqPerScheduleUnit

    if (layerData.variance === 0) {
      // For no variance, counts might not be strictly needed if scheduling is grid-based using scaledFrequency directly.
      // However, if it implies a fixed number of events derived from frequency, it would be calculated here.
      // For now, assuming variance=0 means grid-based, so counts might be less relevant or derived differently.
      counts[`${set}Events`] = 0 // Or calculate deterministic count based on freqPerScheduleUnit
    } else {
      // Variance is used to determine a range around the scaled frequency for event counts
      const stdDev = Math.sqrt(freqPerScheduleUnit) // Standard deviation for Poisson is sqrt(lambda)
      const minEvents = Math.max(
        0,
        Math.floor(freqPerScheduleUnit - layerData.variance * stdDev)
      )
      const maxEvents = Math.ceil(
        freqPerScheduleUnit + layerData.variance * stdDev
      )
      // Use Poisson distribution around the scaled frequency
      counts[`${set}Events`] = Math.min(
        maxEvents,
        Math.max(minEvents, poissonRandom(freqPerScheduleUnit))
      )
    }
  }

  return { frequencies, scaledFrequencies, counts }
}
