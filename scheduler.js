import { config } from './config.js'
import { weightedRandomFile } from './utils.js'
import path from 'path'

export function generateTimelineEvents(
  layerName,
  layerData,
  validFiles,
  playCounts,
  lastPlayedFiles,
  lastBreathWasIn,
  subBlockStartTime,
  intensity,
  volume,
  counts,
  chunkCounts
) {
  const events = []
  let breathToggled = false

  if (layerData.tightness === 0) {
    const sets =
      layerName === 'breath'
        ? [lastBreathWasIn ? 'out' : 'in']
        : Object.keys(layerData.sets)
    for (const set of sets) {
      const scaledChance =
        (layerData.intensity[
          Math.min(
            Object.keys(layerData.intensity)
              .map(Number)
              .sort((a, b) => a - b)
              .find((key) => key >= intensity) || intensity,
            2
          )
        ][`${set}_chance`] ||
          layerData.intensity[
            Math.min(
              Object.keys(layerData.intensity)
                .map(Number)
                .sort((a, b) => a - b)
                .find((key) => key >= intensity) || intensity,
              2
            )
          ].chance) *
        (config.scheduleGranularity / config.chanceUnit)
      const interval = 1 / (scaledChance / config.scheduleGranularity) // Seconds between events
      const eventTime = Math.round(subBlockStartTime / interval) * interval
      if (
        Math.abs(eventTime - subBlockStartTime) <
          config.scheduleGranularity / 2 &&
        eventTime <= config.duration
      ) {
        const randomFile = weightedRandomFile(
          validFiles[set],
          playCounts[set],
          lastPlayedFiles[set]
        )
        const fileIndex = validFiles[set].indexOf(randomFile)
        playCounts[set][fileIndex] = (playCounts[set][fileIndex] || 0) + 1
        lastPlayedFiles[set] = randomFile

        events.push({
          file: path.join(config.audioDir, layerData.category, randomFile),
          filename: randomFile,
          start: eventTime,
          volume,
          playCount: playCounts[set][fileIndex],
          set,
          layer: layerName,
        })

        const chunkIndex = Math.floor(eventTime / config.chunkDuration)
        if (chunkIndex < chunkCounts[layerName].length) {
          chunkCounts[layerName][chunkIndex]++
        }

        if (layerName === 'breath') {
          breathToggled = true
        }
      }
    }
  } else {
    const sets =
      layerName === 'breath'
        ? [lastBreathWasIn ? 'out' : 'in']
        : Object.keys(layerData.sets)
    for (const set of sets) {
      const N = counts[`${set}Events`]
      for (let j = 0; j < N; j++) {
        const eventTime =
          subBlockStartTime + Math.random() * config.scheduleGranularity
        const randomFile = weightedRandomFile(
          validFiles[set],
          playCounts[set],
          lastPlayedFiles[set]
        )
        const fileIndex = validFiles[set].indexOf(randomFile)
        playCounts[set][fileIndex] = (playCounts[set][fileIndex] || 0) + 1
        lastPlayedFiles[set] = randomFile

        events.push({
          file: path.join(config.audioDir, layerData.category, randomFile),
          filename: randomFile,
          start: eventTime,
          volume,
          playCount: playCounts[set][fileIndex],
          set,
          layer: layerName,
        })

        const chunkIndex = Math.floor(eventTime / config.chunkDuration)
        if (chunkIndex < chunkCounts[layerName].length) {
          chunkCounts[layerName][chunkIndex]++
        }
      }
      if (layerName === 'breath' && N > 0) {
        breathToggled = true
      }
    }
  }

  return { events, breathToggled }
}
