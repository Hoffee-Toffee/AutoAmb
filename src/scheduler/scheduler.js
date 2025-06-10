import { generatePosition, selectFile } from '../utils/audio.js'
import path from 'path'

function createAudioEvent(
  filePath,
  fileName,
  startTime,
  duration,
  volume,
  layerName,
  setName,
  position,
  pitchSpeedRange
) {
  const event = {
    file: filePath,
    filename: fileName,
    start: startTime,
    duration: duration,
    volume,
    set: setName,
    layer: layerName,
    ...position,
  }
  if (pitchSpeedRange) {
    event.pitchSpeedFactor =
      Math.random() * (pitchSpeedRange[1] - pitchSpeedRange[0]) +
      pitchSpeedRange[0]
  }
  return event
}

function selectAndPrepareFile(
  filesForSet,
  playCountsForSet,
  lastPlayedFileInSet,
  isFileCyclingMode,
  currentFileCycleIndex,
  durationsForSet,
  audioDir,
  categoryName
) {
  const selectedFileName = selectFile(
    filesForSet,
    playCountsForSet,
    lastPlayedFileInSet,
    isFileCyclingMode,
    isFileCyclingMode ? currentFileCycleIndex : 0
  )

  if (!selectedFileName) return null

  const fileIndexInSet = filesForSet.indexOf(selectedFileName)
  if (
    fileIndexInSet === -1 ||
    !durationsForSet ||
    durationsForSet[fileIndexInSet] === undefined
  ) {
    console.warn(
      `Selected file ${selectedFileName} not found in set's file list or duration missing for set ${setName}.`
    )
    return null
  }

  const eventDuration = durationsForSet[fileIndexInSet]

  // Update play counts
  playCountsForSet[fileIndexInSet] = (playCountsForSet[fileIndexInSet] || 0) + 1

  return {
    name: selectedFileName,
    path: path.join(audioDir, categoryName, selectedFileName),
    duration: eventDuration,
    indexInSet: fileIndexInSet,
  }
}

function determineSetsToProcess(layerData, currentSetIndex) {
  const allSetKeys = Object.keys(layerData.sets)
  if (!allSetKeys || allSetKeys.length === 0) return [] // No sets defined

  if (layerData.cycleThrough === 'sets') {
    if (allSetKeys.length > 0) {
      return [allSetKeys[currentSetIndex % allSetKeys.length]]
    }
    return [] // No sets to process
  }
  // For 'files' cycling or no cycling ('concurrent' or undefined), process all sets.
  // The file selection within 'files' cycling mode is handled by setIndex passed to selectFile.
  return allSetKeys
}

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
  lastEventEndTimes,
  config
) {
  const events = []
  let setToggled = false

  const setsToProcess = determineSetsToProcess(layerData, setIndex)

  for (const setName of setsToProcess) {
    if (
      !validFiles[setName] ||
      validFiles[setName].length === 0 ||
      !durations[setName]
    ) {
      console.warn(
        `No valid files or duration data for set ${setName} in layer ${layerName}. Skipping.`
      )
      continue
    }

    const position =
      layerData.directionality === 'unique'
        ? generatePosition()
        : sharedPosition ?? {}
    let currentFileCycleGlobalIndex = 0
    if (layerData.cycleThrough === 'files') {
      currentFileCycleGlobalIndex = setIndex
    }

    if (layerData.bufferBetweenSounds) {
      const bufferTrackerKey =
        layerData.cycleThrough === 'sets' || layerData.cycleThrough === 'files'
          ? '_layerCycle'
          : setName

      if (!lastEventEndTimes[layerName]) lastEventEndTimes[layerName] = {}
      if (lastEventEndTimes[layerName][bufferTrackerKey] === undefined) {
        lastEventEndTimes[layerName][bufferTrackerKey] = 0.0
      }

      let currentLastEventEndTime =
        lastEventEndTimes[layerName][bufferTrackerKey]
      const frequencyForSet = directSetFrequencies
        ? directSetFrequencies[setName]
        : 0

      if (frequencyForSet === undefined) {
        console.warn(
          `Frequency data missing for set ${setName} in layer ${layerName} (buffered mode). Skipping set.`
        )
        continue
      }

      let potentialNextEventStartTime = currentLastEventEndTime
      if (frequencyForSet > 0) {
        const baseInterval = 1.0 / frequencyForSet
        const varianceFactor = layerData.variance * (Math.random() * 2 - 1)
        let actualInterval = baseInterval * (1 + varianceFactor)
        if (actualInterval <= 0) actualInterval = baseInterval
        potentialNextEventStartTime += actualInterval
      }

      if (
        potentialNextEventStartTime < config.duration &&
        potentialNextEventStartTime >= subBlockStartTime &&
        potentialNextEventStartTime <
          subBlockStartTime + config.scheduleGranularity
      ) {
        const selectedFileDetails = selectAndPrepareFile(
          validFiles[setName],
          playCounts[setName],
          lastPlayedFiles[setName],
          layerData.cycleThrough === 'files',
          currentFileCycleGlobalIndex,
          durations[setName],
          config.audioDir,
          layerData.category,
          setName
        )

        if (
          selectedFileDetails &&
          potentialNextEventStartTime + selectedFileDetails.duration <=
            config.duration
        ) {
          const event = createAudioEvent(
            selectedFileDetails.path,
            selectedFileDetails.name,
            potentialNextEventStartTime,
            selectedFileDetails.duration,
            volume,
            layerName,
            setName,
            position,
            layerData.pitchSpeedRange
          )
          events.push(event)

          lastPlayedFiles[setName] = selectedFileDetails.name
          const chunkIndex = Math.floor(
            potentialNextEventStartTime / config.chunkDuration
          )
          if (
            chunkCounts &&
            chunkCounts[layerName] &&
            chunkIndex < chunkCounts[layerName].length
          ) {
            chunkCounts[layerName][chunkIndex]++
          }

          lastEventEndTimes[layerName][bufferTrackerKey] =
            potentialNextEventStartTime + selectedFileDetails.duration
          if (
            layerData.cycleThrough === 'sets' ||
            layerData.cycleThrough === 'files'
          ) {
            setToggled = true
          }
        }
      }
    } else {
      if (layerData.variance === 0) {
        const scaledFreqKey = `scaled${
          setName.charAt(0).toUpperCase() + setName.slice(1)
        }Frequency`
        const scaledFrequency = scaledFrequencies
          ? scaledFrequencies[scaledFreqKey]
          : 0

        if (scaledFrequency === undefined || scaledFrequency <= 0) continue

        const interval = 1 / (scaledFrequency / config.scheduleGranularity)
        if (interval <= 0) continue

        const eventTime = Math.round(subBlockStartTime / interval) * interval

        if (
          Math.abs(eventTime - subBlockStartTime) <
            config.scheduleGranularity / 2 &&
          eventTime < config.duration
        ) {
          const selectedFileDetails = selectAndPrepareFile(
            validFiles[setName],
            playCounts[setName],
            lastPlayedFiles[setName],
            layerData.cycleThrough === 'files',
            currentFileCycleGlobalIndex,
            durations[setName],
            config.audioDir,
            layerData.category,
            setName
          )

          if (
            selectedFileDetails &&
            eventTime + selectedFileDetails.duration <= config.duration
          ) {
            const event = createAudioEvent(
              selectedFileDetails.path,
              selectedFileDetails.name,
              eventTime,
              selectedFileDetails.duration,
              volume,
              layerName,
              setName,
              position,
              layerData.pitchSpeedRange
            )
            events.push(event)
            lastPlayedFiles[setName] = selectedFileDetails.name
            const chunkIndex = Math.floor(eventTime / config.chunkDuration)
            if (
              chunkCounts &&
              chunkCounts[layerName] &&
              chunkIndex < chunkCounts[layerName].length
            ) {
              chunkCounts[layerName][chunkIndex]++
            }
            if (
              layerData.cycleThrough === 'sets' ||
              layerData.cycleThrough === 'files'
            ) {
              setToggled = true
            }
          }
        }
      } else {
        const numEventsKey = `${setName}Events`
        const N = counts ? counts[numEventsKey] : 0
        if (N === undefined || N <= 0) continue

        for (let j = 0; j < N; j++) {
          const eventTime =
            subBlockStartTime + Math.random() * config.scheduleGranularity
          if (eventTime >= config.duration) continue

          const selectedFileDetails = selectAndPrepareFile(
            validFiles[setName],
            playCounts[setName],
            lastPlayedFiles[setName],
            layerData.cycleThrough === 'files',
            currentFileCycleGlobalIndex,
            durations[setName],
            config.audioDir,
            layerData.category,
            setName
          )

          if (
            selectedFileDetails &&
            eventTime + selectedFileDetails.duration <= config.duration
          ) {
            const event = createAudioEvent(
              selectedFileDetails.path,
              selectedFileDetails.name,
              eventTime,
              selectedFileDetails.duration,
              volume,
              layerName,
              setName,
              position,
              layerData.pitchSpeedRange
            )
            events.push(event)
            lastPlayedFiles[setName] = selectedFileDetails.name
            const chunkIndex = Math.floor(eventTime / config.chunkDuration)
            if (
              chunkCounts &&
              chunkCounts[layerName] &&
              chunkIndex < chunkCounts[layerName].length
            ) {
              chunkCounts[layerName][chunkIndex]++
            }
            // Corrected typo from layerData.cycle_through to layerData.cycleThrough
            if (
              (layerData.cycleThrough === 'sets' ||
                layerData.cycleThrough === 'files') &&
              N > 0
            ) {
              setToggled = true
            }
          }
        }
      }
    }
  }
  return { events, setToggled }
}
