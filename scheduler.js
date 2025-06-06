import { config } from './config.js'
import { generatePosition, weightedRandomFile } from './utils.js'
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
  chunkCounts,
  durations,
  scaledChances,
  sharedPosition
) {
  const events = []
  let breathToggled = false

  const sets =
    layerName === 'breath'
      ? [lastBreathWasIn ? 'out' : 'in', 'asphyx']
      : Object.keys(layerData.sets)

  if (layerData.tightness === 0) {
    const sets =
      layerName === 'breath'
        ? [lastBreathWasIn ? 'out' : 'in', 'asphyx']
        : Object.keys(layerData.sets)
    for (const set of sets) {
      const scaledChance =
        scaledChances[
          `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Chance`
        ]
      const interval = 1 / (scaledChance / config.scheduleGranularity) // Seconds between events
      const eventTime = Math.round(subBlockStartTime / interval) * interval
      const position =
        layerData.directionality === 'unique'
          ? generatePosition()
          : sharedPosition ?? {}
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
          duration: durations[set][fileIndex],
          volume,
          playCount: playCounts[set][fileIndex],
          set,
          layer: layerName,
          ...position,
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
    for (const set of sets) {
      const N = counts[`${set}Events`]
      for (let j = 0; j < N; j++) {
        let eventTime =
          subBlockStartTime + Math.random() * config.scheduleGranularity
        const position =
          layerData.directionality === 'unique'
            ? generatePosition()
            : sharedPosition ?? {}

        if (eventTime <= config.duration) {
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
            ...position,
          })

          const chunkIndex = Math.floor(eventTime / config.chunkDuration)
          if (chunkIndex < chunkCounts[layerName].length) {
            chunkCounts[layerName][chunkIndex]++
          }
        }
      }
      if (layerName === 'breath' && N > 0) {
        breathToggled = true
      }
    }
  }

  return { events, breathToggled }
}
