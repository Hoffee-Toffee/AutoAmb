import { config } from './config.js'
import { generatePosition, selectFile } from './utils.js'
import path from 'path'

export function generateTimelineEvents(
  layerName,
  layerData,
  validFiles,
  playCounts,
  lastPlayedFiles,
  setIndex,
  subBlockStartTime,
  intensity,
  volume,
  counts,
  chunkCounts,
  durations,
  scaledFrequencies,
  sharedPosition
) {
  const events = []
  let setToggled = false

  const sets =
    layerData.cycleThrough === 'sets'
      ? [Object.keys(layerData.sets)[setIndex]]
      : Object.keys(layerData.sets)

  if (layerData.variance === 0) {
    for (const set of sets) {
      const scaledFrequency =
        scaledFrequencies[
          `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Frequency`
        ]
      const interval = 1 / (scaledFrequency / config.scheduleGranularity) // Seconds between events
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
        const selectedFile = selectFile(
          validFiles[set],
          playCounts[set],
          lastPlayedFiles[set],
          layerData.cycleThrough === 'files',
          setIndex
        )
        if (!selectedFile) {
          console.warn(`No file selected for ${layerName} set ${set}`)
          continue
        }
        const fileIndex = validFiles[set].indexOf(selectedFile)
        playCounts[set][fileIndex] = (playCounts[set][fileIndex] || 0) + 1
        lastPlayedFiles[set] = selectedFile

        events.push({
          file: path.join(config.audioDir, layerData.category, selectedFile),
          filename: selectedFile,
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

        if (['sets', 'files'].includes(layerData.cycleThrough)) {
          setToggled = true
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
          const selectedFile = selectFile(
            validFiles[set],
            playCounts[set],
            lastPlayedFiles[set],
            layerData.cycleThrough === 'files',
            setIndex
          )
          if (!selectedFile) {
            console.warn(`No file selected for ${layerName} set ${set}`)
            continue
          }
          const fileIndex = validFiles[set].indexOf(selectedFile)
          playCounts[set][fileIndex] = (playCounts[set][fileIndex] || 0) + 1
          lastPlayedFiles[set] = selectedFile

          events.push({
            file: path.join(config.audioDir, layerData.category, selectedFile),
            filename: selectedFile,
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
      if (['sets', 'files'].includes(layerData.cycleThrough) && N > 0) {
        setToggled = true
      }
    }
  }

  return { events, setToggled }
}
