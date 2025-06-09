import { config } from '../config.js'
import { generatePosition, selectFile } from '../utils.js'
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
  sharedPosition,
  directSetFrequencies,
  lastEventEndTimes
) {
  const events = []
  let setToggled = false

  if (layerData.bufferBetweenSounds) {
    let setsToProcessForCycling // Used if cycling logic needs a specific single set determined by setIndex

    // Determine the set(s) to process based on cycleThrough mode
    if (layerData.cycleThrough === 'sets') {
      setsToProcessForCycling = [Object.keys(layerData.sets)[setIndex]]
    } else if (layerData.cycleThrough === 'files') {
      let currentSetKeyForFileCycling
      if (Object.keys(layerData.sets).length === 1) {
        currentSetKeyForFileCycling = Object.keys(layerData.sets)[0]
      } else {
        currentSetKeyForFileCycling = Object.keys(layerData.sets)[0]
      }
      setsToProcessForCycling = [currentSetKeyForFileCycling]
    }

    if (
      layerData.cycleThrough === 'sets' ||
      layerData.cycleThrough === 'files'
    ) {
      const cycleTrackerKey = '_layerCycle' // Shared timer for the whole layer when cycling
      if (!lastEventEndTimes[layerName]) {
        lastEventEndTimes[layerName] = {}
      }
      if (lastEventEndTimes[layerName][cycleTrackerKey] === undefined) {
        lastEventEndTimes[layerName][cycleTrackerKey] = 0.0
      }

      const currentGlobalLastEventEndTime =
        lastEventEndTimes[layerName][cycleTrackerKey]
      const currentSetForScheduling = setsToProcessForCycling[0] // The single set active due to cycling

      if (
        !validFiles[currentSetForScheduling] ||
        !directSetFrequencies ||
        directSetFrequencies[currentSetForScheduling] === undefined
      ) {
        // console.warn(`Data missing or invalid frequency for set ${currentSetForScheduling} in layer ${layerName} (cycling mode ${layerData.cycleThrough}). Skipping.`);
      } else {
        const frequencyForCurrentSet =
          directSetFrequencies[currentSetForScheduling]
        if (frequencyForCurrentSet <= 0) {
          // console.warn(`Frequency for ${layerName} set ${currentSetForScheduling} (cycling) is zero or negative. Skipping.`);
        } else {
          const baseInterval = 1.0 / frequencyForCurrentSet
          const varianceFactor = layerData.variance * (Math.random() * 2 - 1)
          let actualInterval = baseInterval * (1 + varianceFactor)
          if (actualInterval <= 0) actualInterval = baseInterval // Ensure positive interval

          const potentialNextEventStartTime =
            currentGlobalLastEventEndTime + actualInterval

          if (
            potentialNextEventStartTime < config.duration &&
            potentialNextEventStartTime >= subBlockStartTime &&
            potentialNextEventStartTime <
              subBlockStartTime + config.scheduleGranularity
          ) {
            const selectedFile = selectFile(
              validFiles[currentSetForScheduling],
              playCounts[currentSetForScheduling],
              lastPlayedFiles[currentSetForScheduling],
              layerData.cycleThrough === 'files',
              layerData.cycleThrough === 'files' ? setIndex : 0 // Pass global setIndex for file cycling, 0 for set cycling (as file is chosen from the single active set)
            )

            if (selectedFile) {
              const fileIndexInItsSet =
                validFiles[currentSetForScheduling].indexOf(selectedFile)
              const eventDuration =
                durations[currentSetForScheduling][fileIndexInItsSet]

              if (
                potentialNextEventStartTime + eventDuration <=
                config.duration
              ) {
                const position =
                  layerData.directionality === 'unique'
                    ? generatePosition()
                    : sharedPosition ?? {}
                events.push({
                  file: path.join(
                    config.audioDir,
                    layerData.category,
                    selectedFile
                  ),
                  filename: selectedFile,
                  start: potentialNextEventStartTime,
                  duration: eventDuration,
                  volume,
                  playCount: (playCounts[currentSetForScheduling][
                    fileIndexInItsSet
                  ] =
                    (playCounts[currentSetForScheduling][fileIndexInItsSet] ||
                      0) + 1),
                  set: currentSetForScheduling, // Log the actual set the file came from
                  layer: layerName,
                  ...position,
                })
                lastPlayedFiles[currentSetForScheduling] = selectedFile // Update last played for the specific set

                const chunkIndex = Math.floor(
                  potentialNextEventStartTime / config.chunkDuration
                )
                if (chunkIndex < chunkCounts[layerName].length)
                  chunkCounts[layerName][chunkIndex]++

                setToggled = true // Event scheduled
                lastEventEndTimes[layerName][cycleTrackerKey] =
                  potentialNextEventStartTime + eventDuration // Update global timer
              }
            }
          }
        }
      }
    } else {
      // No layer-level cycling (e.g. cycleThrough 'none'), but bufferBetweenSounds is true (per-set buffering)
      const setsForPerSetBuffering = Object.keys(layerData.sets)
      for (const set of setsForPerSetBuffering) {
        if (!lastEventEndTimes[layerName]) lastEventEndTimes[layerName] = {}
        if (lastEventEndTimes[layerName][set] === undefined) {
          lastEventEndTimes[layerName][set] = 0.0
        }
        const currentSetLastEventEndTime = lastEventEndTimes[layerName][set]

        if (!directSetFrequencies || directSetFrequencies[set] === undefined) {
          // console.warn(`Frequency data missing for set ${set} in layer ${layerName} (per-set buffering). Skipping.`);
          continue
        }
        const setFrequency = directSetFrequencies[set]

        if (setFrequency <= 0) continue

        const baseInterval = 1.0 / setFrequency
        const varianceFactor = layerData.variance * (Math.random() * 2 - 1)
        let actualInterval = baseInterval * (1 + varianceFactor)
        if (actualInterval <= 0) actualInterval = baseInterval

        const potentialNextEventStartTime =
          currentSetLastEventEndTime + actualInterval

        if (
          potentialNextEventStartTime < config.duration &&
          potentialNextEventStartTime >= subBlockStartTime &&
          potentialNextEventStartTime <
            subBlockStartTime + config.scheduleGranularity
        ) {
          const selectedFile = selectFile(
            validFiles[set],
            playCounts[set],
            lastPlayedFiles[set],
            false, // isFileCycling is false here, as this branch is not layer-level file cycling
            0 // setIndex for file selection within this set (usually 0, selectFile handles its own logic if not file cycling)
          )

          if (selectedFile) {
            const fileIndex = validFiles[set].indexOf(selectedFile)
            const eventDuration = durations[set][fileIndex]

            if (
              potentialNextEventStartTime + eventDuration <=
              config.duration
            ) {
              const position =
                layerData.directionality === 'unique'
                  ? generatePosition()
                  : sharedPosition ?? {}
              events.push({
                file: path.join(
                  config.audioDir,
                  layerData.category,
                  selectedFile
                ),
                filename: selectedFile,
                start: potentialNextEventStartTime,
                duration: eventDuration,
                volume,
                playCount: (playCounts[set][fileIndex] =
                  (playCounts[set][fileIndex] || 0) + 1),
                set,
                layer: layerName,
                ...position,
              })
              lastPlayedFiles[set] = selectedFile
              const chunkIndex = Math.floor(
                potentialNextEventStartTime / config.chunkDuration
              )
              if (chunkIndex < chunkCounts[layerName].length)
                chunkCounts[layerName][chunkIndex]++

              setToggled = true // Event scheduled
              lastEventEndTimes[layerName][set] =
                potentialNextEventStartTime + eventDuration // Update this set's timer
            }
          }
        }
      }
    }
  } else {
    // bufferBetweenSounds is false - existing logic (copied from previous state, ensure it's what we want)
    const setsToProcessNonBuffered =
      layerData.cycleThrough === 'sets'
        ? [Object.keys(layerData.sets)[setIndex]]
        : Object.keys(layerData.sets)

    if (layerData.variance === 0) {
      // Non-buffered, no variance
      for (const set of setsToProcessNonBuffered) {
        if (
          !scaledFrequencies ||
          !validFiles[set] ||
          !scaledFrequencies[
            `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Frequency`
          ]
        ) {
          // console.warn(`Missing data for non-buffered, no variance scheduling: layer ${layerName}, set ${set}`);
          continue
        }
        const scaledFrequency =
          scaledFrequencies[
            `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Frequency`
          ]
        if (scaledFrequency <= 0) continue

        const interval = 1 / (scaledFrequency / config.scheduleGranularity)
        if (interval <= 0) continue

        const eventTime = Math.round(subBlockStartTime / interval) * interval

        if (
          Math.abs(eventTime - subBlockStartTime) <
            config.scheduleGranularity / 2 &&
          eventTime < config.duration
        ) {
          const selectedFile = selectFile(
            validFiles[set],
            playCounts[set],
            lastPlayedFiles[set],
            layerData.cycleThrough === 'files',
            setIndex
          )
          if (!selectedFile) continue

          const fileIndex = validFiles[set].indexOf(selectedFile)
          if (!durations[set] || durations[set][fileIndex] === undefined)
            continue
          const eventDuration = durations[set][fileIndex]
          if (eventTime + eventDuration > config.duration) continue

          const position =
            layerData.directionality === 'unique'
              ? generatePosition()
              : sharedPosition ?? {}
          events.push({
            file: path.join(config.audioDir, layerData.category, selectedFile),
            filename: selectedFile,
            start: eventTime,
            duration: eventDuration,
            volume,
            playCount: (playCounts[set][fileIndex] =
              (playCounts[set][fileIndex] || 0) + 1),
            set,
            layer: layerName,
            ...position,
          })
          lastPlayedFiles[set] = selectedFile
          const chunkIndex = Math.floor(eventTime / config.chunkDuration)
          if (chunkIndex < chunkCounts[layerName].length)
            chunkCounts[layerName][chunkIndex]++

          if (['sets', 'files'].includes(layerData.cycleThrough)) {
            setToggled = true
          }
        }
      }
    } else {
      // Non-buffered, with variance
      for (const set of setsToProcessNonBuffered) {
        if (
          !counts ||
          counts[`${set}Events`] === undefined ||
          !validFiles[set]
        ) {
          // console.warn(`Missing data for non-buffered, variance scheduling: layer ${layerName}, set ${set}`);
          continue
        }
        const N = counts[`${set}Events`]
        for (let j = 0; j < N; j++) {
          let eventTime =
            subBlockStartTime + Math.random() * config.scheduleGranularity
          if (eventTime >= config.duration) continue

          const selectedFile = selectFile(
            validFiles[set],
            playCounts[set],
            lastPlayedFiles[set],
            layerData.cycleThrough === 'files',
            setIndex
          )
          if (!selectedFile) continue

          const fileIndex = validFiles[set].indexOf(selectedFile)
          if (!durations[set] || durations[set][fileIndex] === undefined)
            continue
          const eventDuration = durations[set][fileIndex] // Get duration
          if (eventTime + eventDuration > config.duration) continue // Check if event exceeds total duration

          const position =
            layerData.directionality === 'unique'
              ? generatePosition()
              : sharedPosition ?? {}
          events.push({
            file: path.join(config.audioDir, layerData.category, selectedFile),
            filename: selectedFile,
            start: eventTime,
            duration: eventDuration, // Include duration in the event
            volume,
            playCount: (playCounts[set][fileIndex] =
              (playCounts[set][fileIndex] || 0) + 1),
            set,
            layer: layerName,
            ...position,
          })
          lastPlayedFiles[set] = selectedFile
          const chunkIndex = Math.floor(eventTime / config.chunkDuration)
          if (chunkIndex < chunkCounts[layerName].length)
            chunkCounts[layerName][chunkIndex]++

          if (['sets', 'files'].includes(layerData.cycleThrough) && N > 0) {
            setToggled = true
          }
        }
      }
    }
  }
  return { events, setToggled }
}
