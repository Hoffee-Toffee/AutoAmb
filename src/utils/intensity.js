import { poissonRandom } from './math.js'

export function getIntensityAtTime(layerName, time) {
  const totalDuration = 15 * 4 * 5; // Match config.js duration
  const progress = Math.min(1, Math.max(0, time / totalDuration));
  // Constant intensity for debugging
  return 2; // Fixed at max intensity for maximum volume
}

export function getIntensityForLayer(layerName, progress) {
  return 2;
}

export function interpolateIntensity(layerData, intensity) {
  const intensityKeys = Object.keys(layerData.intensity)
    .map(Number)
    .sort((a, b) => a - b)

  let lowerKey = intensityKeys.findLast((key) => key <= intensity)
  if (lowerKey === undefined) lowerKey = intensityKeys[0]

  let upperKey = intensityKeys.find((key) => key > intensity)
  if (upperKey === undefined) upperKey = lowerKey

  const weight =
    lowerKey === upperKey ? 0 : (intensity - lowerKey) / (upperKey - lowerKey)

  return { lowerKey, upperKey, weight }
}

export function getLayerProperty(
  layerData,
  intensityKey,
  setName,
  propertyName
) {
  const intensityLevel = layerData.intensity[intensityKey]
  if (!intensityLevel) return layerData[propertyName]

  const setSpecificProperty = `${setName}_${propertyName}`
  if (intensityLevel[setSpecificProperty] !== undefined) {
    return intensityLevel[setSpecificProperty]
  }
  if (intensityLevel[propertyName] !== undefined) {
    return intensityLevel[propertyName]
  }
  if (layerData[setSpecificProperty] !== undefined) {
    return layerData[setSpecificProperty]
  }
  return layerData[propertyName]
}

export function getInterpolatedValue(
  layerData,
  setName,
  propertyName,
  { lowerKey, upperKey, weight }
) {
  const lowerValue = getLayerProperty(
    layerData,
    lowerKey,
    setName,
    propertyName
  )
  const upperValue = getLayerProperty(
    layerData,
    upperKey,
    setName,
    propertyName
  )

  if (typeof lowerValue === 'number' && typeof upperValue === 'number') {
    return (1 - weight) * lowerValue + weight * upperValue
  }
  return lowerValue ?? upperValue
}

export function getInterpolatedLayerData(layerData, intensity, setName) {
  const { lowerKey, upperKey, weight } = interpolateIntensity(
    layerData,
    intensity
  )
  const interpolationArgs = { lowerKey, upperKey, weight }

  const volume = getInterpolatedValue(
    layerData,
    setName,
    'volume',
    interpolationArgs
  )
  const frequency = getInterpolatedValue(
    layerData,
    setName,
    'frequency',
    interpolationArgs
  )
  const variance = getInterpolatedValue(
    layerData,
    setName,
    'variance',
    interpolationArgs
  )
  const directionality = getInterpolatedValue(
    layerData,
    setName,
    'directionality',
    interpolationArgs
  )
  const pitchSpeedRange = getInterpolatedValue(
    layerData,
    setName,
    'pitchSpeedRange',
    interpolationArgs
  )

  return {
    volume,
    frequency,
    variance,
    directionality,
    pitchSpeedRange,
  }
}

export function calculateFrequenciesAndCounts(
  layerData,
  intensity,
  config
) {
  const sets = Object.keys(layerData.sets)
  const frequencies = {}
  const scaledFrequencies = {}
  const counts = {}

  for (const set of sets) {
    const data = getInterpolatedLayerData(layerData, intensity, set)
    const baseFrequency = data.frequency || layerData.frequency || 0
    const variance = data.variance

    frequencies[set] = baseFrequency

    const freqPerScheduleUnit =
      baseFrequency * (config.scheduleGranularity / config.frequencyUnit)
    scaledFrequencies[
      `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Frequency`
    ] = freqPerScheduleUnit

    const safeFreqPerScheduleUnit = Math.max(0, freqPerScheduleUnit)
    const stdDev = Math.sqrt(safeFreqPerScheduleUnit)
    const rangeDelta = (variance || 0) * stdDev

    const minN = Math.max(0, Math.floor(safeFreqPerScheduleUnit - rangeDelta))
    const maxN = Math.ceil(safeFreqPerScheduleUnit + rangeDelta)

    counts[`${set}Events`] = Math.min(
      maxN,
      Math.max(minN, poissonRandom(safeFreqPerScheduleUnit))
    )
  }

  return { frequencies, scaledFrequencies, counts }
}