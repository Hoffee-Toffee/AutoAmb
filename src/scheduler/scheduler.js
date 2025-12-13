import { generatePosition, selectFile } from '../utils/audio.js'
import {
  getInterpolatedLayerData,
  getIntensityAtTime,
} from '../utils/intensity.js'
import path from 'path'

function createAudioEvent(
  filePath,
  fileName,
  startTime,
  duration,
  startVolume,
  endVolume,
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
    startVolume,
    endVolume,
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
      `Selected file ${selectedFileName} not found in set's file list or duration missing.`
    )
    return null
  }

  const eventDuration = durationsForSet[fileIndexInSet]

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
  if (!allSetKeys || allSetKeys.length === 0) return []

  if (
    layerData.cycleMode === 'sets' ||
    (layerData.bufferBetweenSounds && !layerData.cycleMode)
  ) {
    if (allSetKeys.length > 0) {
      return [allSetKeys[currentSetIndex % allSetKeys.length]]
    }
    return []
  }
  return allSetKeys
}

function calculateDynamicVolumes(
  startTime,
  duration,
  layerName,
  setName,
  layerData,
  config,
  intensityLog
) {
  const endTime = startTime + duration
  const startIntensity = getIntensityAtTime(
    layerName,
    startTime,
    intensityLog
  )
  const endIntensity = getIntensityAtTime(layerName, endTime, intensityLog)
  const { volume: startVolume } = getInterpolatedLayerData(
    layerData,
    startIntensity,
    setName
  )
  const { volume: endVolume } = getInterpolatedLayerData(
    layerData,
    endIntensity,
    setName
  )
  return { startVolume, endVolume }
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
  chunkCounts,
  durations,
  sharedPosition,
  layerLastScheduledEventStartTimes,
  lastEventEndTimes,
  config,
  intensityLog
) {
  const events = []
  let setToggled = false

  if (layerData.isConstant) {
    for (const setName of Object.keys(layerData.sets)) {
      if (!lastEventEndTimes[layerName]) {
        lastEventEndTimes[layerName] = {}
      }
      if (!lastEventEndTimes[layerName][setName]) {
        lastEventEndTimes[layerName][setName] = 0
      }

      if (subBlockStartTime >= lastEventEndTimes[layerName][setName]) {
        const { pitchSpeedRange, directionality } = getInterpolatedLayerData(
          layerData,
          intensity,
          setName
        )

        const selectedFileDetails = selectAndPrepareFile(
          validFiles[setName],
          playCounts[setName],
          lastPlayedFiles[setName],
          false,
          0,
          durations[setName],
          config.audioDir,
          layerData.category
        )

        if (selectedFileDetails) {
          const { startVolume, endVolume } = calculateDynamicVolumes(
            subBlockStartTime,
            selectedFileDetails.duration,
            layerName,
            setName,
            layerData,
            config,
            intensityLog
          )

          const position =
            directionality === 'unique'
              ? generatePosition()
              : sharedPosition ?? {}
          const event = createAudioEvent(
            selectedFileDetails.path,
            selectedFileDetails.name,
            subBlockStartTime,
            selectedFileDetails.duration,
            startVolume,
            endVolume,
            layerName,
            setName,
            position,
            pitchSpeedRange
          )
          events.push(event)
          lastEventEndTimes[layerName][setName] =
            subBlockStartTime + selectedFileDetails.duration

          const startChunk = Math.floor(subBlockStartTime / config.chunkDuration)
          const endChunk = Math.floor(
            (subBlockStartTime + selectedFileDetails.duration) /
              config.chunkDuration
          )
          for (let i = startChunk; i <= endChunk; i++) {
            if (
              chunkCounts &&
              chunkCounts[layerName] &&
              i < chunkCounts[layerName].length
            ) {
              chunkCounts[layerName][i]++
            }
          }
        }
      }
    }
    return { events, setToggled: false }
  }

  if (!layerLastScheduledEventStartTimes[layerName]) {
    layerLastScheduledEventStartTimes[layerName] = {}
  }
  if (!lastEventEndTimes[layerName]) {
    lastEventEndTimes[layerName] = {}
  }

  if (layerData.cycleMode === 'sets' && !layerData.bufferBetweenSounds) {
    const allSetKeys = Object.keys(layerData.sets)
    if (allSetKeys.length === 0) {
      console.warn(`No sets to process for layer ${layerName}`)
      return { events, setToggled }
    }

    let currentSet = lastEventEndTimes[layerName].nextSet || allSetKeys[0]
    let nextEventTime = lastEventEndTimes[layerName].nextEventTime || 0
    const subBlockEnd = subBlockStartTime + config.scheduleGranularity

    while (nextEventTime < subBlockEnd && nextEventTime < config.duration) {
      if (
        !validFiles[currentSet] ||
        validFiles[currentSet].length === 0 ||
        !durations[currentSet]
      ) {
        console.warn(`No valid files or duration data for set ${currentSet}`)
        break
      }

      const {
        variance: setVariance,
        pitchSpeedRange,
        directionality,
      } = getInterpolatedLayerData(layerData, intensity, currentSet)

      const selectedFileDetails = selectAndPrepareFile(
        validFiles[currentSet],
        playCounts[currentSet],
        lastPlayedFiles[currentSet],
        false,
        0,
        durations[currentSet],
        config.audioDir,
        layerData.category
      )

      if (
        !selectedFileDetails ||
        nextEventTime + selectedFileDetails.duration > config.duration
      ) {
        break
      }

      const { startVolume, endVolume } = calculateDynamicVolumes(
        nextEventTime,
        selectedFileDetails.duration,
        layerName,
        currentSet,
        layerData,
        config,
        intensityLog
      )

      const position =
        directionality === 'unique' ? generatePosition() : sharedPosition ?? {}

      const event = createAudioEvent(
        selectedFileDetails.path,
        selectedFileDetails.name,
        nextEventTime,
        selectedFileDetails.duration,
        startVolume,
            endVolume,
        layerName,
        currentSet,
        position,
        pitchSpeedRange
      )
      events.push(event)
      lastPlayedFiles[currentSet] = selectedFileDetails.name

      const chunkIndex = Math.floor(nextEventTime / config.chunkDuration)
      if (
        chunkCounts &&
        chunkCounts[layerName] &&
        chunkIndex < chunkCounts[layerName].length
      ) {
        chunkCounts[layerName][chunkIndex]++
      }

      layerLastScheduledEventStartTimes[layerName][currentSet] = nextEventTime

      const currentIndex = allSetKeys.indexOf(currentSet)
      const nextIndex = (currentIndex + 1) % allSetKeys.length
      const nextSet = allSetKeys[nextIndex]
      const { frequency: freqRate } = getInterpolatedLayerData(
        layerData,
        intensity,
        nextSet
      )
      let interval = freqRate > 0 ? config.frequencyUnit / freqRate : 0
      const jitter = Math.random() * setVariance
      interval = Math.max(0.001, interval + jitter)

      nextEventTime += interval
      currentSet = nextSet
      setToggled = true
    }

    lastEventEndTimes[layerName].nextEventTime = nextEventTime
    lastEventEndTimes[layerName].nextSet = currentSet
  } else {
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

      const {
        variance: setVariance,
        frequency: frequencyValue,
        pitchSpeedRange,
        directionality,
      } = getInterpolatedLayerData(layerData, intensity, setName)

      const position =
        directionality === 'unique' ? generatePosition() : sharedPosition ?? {}
      let currentFileCycleGlobalIndex = 0
      if (layerData.cycleMode === 'files') {
        currentFileCycleGlobalIndex = setIndex
      }

      let referenceTime
      let bufferTrackerKey = null

      if (layerData.bufferBetweenSounds) {
        bufferTrackerKey =
          layerData.cycleMode === 'sets' ||
          layerData.cycleMode === 'files' ||
          (layerData.bufferBetweenSounds && Object.keys(layerData.sets).length > 1)
            ? '_layerCycle'
            : setName
        if (!lastEventEndTimes[layerName][bufferTrackerKey]) {
          lastEventEndTimes[layerName][bufferTrackerKey] = 0
        }
        referenceTime = lastEventEndTimes[layerName][bufferTrackerKey]

        if (frequencyValue < 0) {
          console.warn(
            `Negative frequency rate (${frequencyValue}) for set ${setName} in layer ${layerName} (buffered mode). Skipping set.`
          )
          continue
        }

        let calculatedInterval
        if (frequencyValue === 0 && layerData.bufferBetweenSounds) {
          calculatedInterval = Math.random() * setVariance
        } else {
          calculatedInterval =
            1.0 / frequencyValue + Math.random() * setVariance
        }

        calculatedInterval = Math.max(0.001, calculatedInterval)

        let potentialNextEventStartTime = referenceTime + calculatedInterval

        const eventSchedulingCondition =
          potentialNextEventStartTime < config.duration &&
          potentialNextEventStartTime <
            subBlockStartTime + config.scheduleGranularity &&
          (layerData.bufferBetweenSounds ||
            potentialNextEventStartTime >= subBlockStartTime)

        if (eventSchedulingCondition) {
          const selectedFileDetails = selectAndPrepareFile(
            validFiles[setName],
            playCounts[setName],
            lastPlayedFiles[setName],
            layerData.cycleMode === 'files',
            currentFileCycleGlobalIndex,
            durations[setName],
            config.audioDir,
            layerData.category
          )

          if (
            selectedFileDetails &&
            potentialNextEventStartTime < config.duration
          ) {
            const { startVolume, endVolume } = calculateDynamicVolumes(
              potentialNextEventStartTime,
              selectedFileDetails.duration,
              layerName,
              setName,
              layerData,
              config,
              intensityLog
            )

            const event = createAudioEvent(
              selectedFileDetails.path,
              selectedFileDetails.name,
              potentialNextEventStartTime,
              selectedFileDetails.duration,
              startVolume,
              endVolume,
              layerName,
              setName,
              position,
              pitchSpeedRange
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

            if (layerData.bufferBetweenSounds && bufferTrackerKey) {
              lastEventEndTimes[layerName][bufferTrackerKey] =
                potentialNextEventStartTime + selectedFileDetails.duration
            }

            if (
              layerData.cycleMode === 'sets' ||
              layerData.cycleMode === 'files' ||
              (layerData.bufferBetweenSounds && !layerData.cycleMode)
            ) {
              setToggled = true
            }
          }
        }
      } else {
        let actualLastStartTime =
          layerLastScheduledEventStartTimes[layerName]?.[setName] ?? 0

        if (frequencyValue <= 0) {
          console.warn(
            `Invalid or zero base rate (${frequencyValue}) for set ${setName} in layer ${layerName} (non-buffered). Skipping set.`
          )
          continue
        }
        const currentInterval = config.frequencyUnit / frequencyValue
        const jitter = Math.random() * setVariance
        let effectiveInterval = currentInterval + jitter
        effectiveInterval = Math.max(0.001, effectiveInterval)

        let potentialEventStartTime = actualLastStartTime + effectiveInterval
        potentialEventStartTime = Math.max(0, potentialEventStartTime)

        const tolerance = Math.max(0.001, setVariance * 0.5)
        if (
          potentialEventStartTime >= subBlockStartTime - tolerance &&
          potentialEventStartTime <
            subBlockStartTime + config.scheduleGranularity + tolerance &&
          potentialEventStartTime < config.duration
        ) {
          const adjustedStartTime = Math.max(
            subBlockStartTime,
            Math.min(
              potentialEventStartTime,
              subBlockStartTime + config.scheduleGranularity
            )
          )

          const selectedFileDetails = selectAndPrepareFile(
            validFiles[setName],
            playCounts[setName],
            lastPlayedFiles[setName],
            layerData.cycleMode === 'files',
            currentFileCycleGlobalIndex,
            durations[setName],
            config.audioDir,
            layerData.category
          )

          if (
            selectedFileDetails &&
            adjustedStartTime + selectedFileDetails.duration <= config.duration
          ) {
            const { startVolume, endVolume } = calculateDynamicVolumes(
              adjustedStartTime,
              selectedFileDetails.duration,
              layerName,
              setName,
              layerData,
              config,
              intensityLog
            )
            const event = createAudioEvent(
              selectedFileDetails.path,
              selectedFileDetails.name,
              adjustedStartTime,
              selectedFileDetails.duration,
              startVolume,
              endVolume,
              layerName,
              setName,
              position,
              pitchSpeedRange
            )
            events.push(event)

            layerLastScheduledEventStartTimes[layerName][setName] =
              adjustedStartTime

            lastPlayedFiles[setName] = selectedFileDetails.name

            const chunkIndex = Math.floor(
              adjustedStartTime / config.chunkDuration
            )
            if (
              chunkCounts &&
              chunkCounts[layerName] &&
              chunkIndex < chunkCounts[layerName].length
            ) {
              chunkCounts[layerName][chunkIndex]++
            }

            if (
              layerData.cycleMode === 'sets' ||
              layerData.cycleMode === 'files' ||
              (layerData.bufferBetweenSounds && !layerData.cycleMode)
            ) {
              setToggled = true
            }
          }
        }

        if (
          potentialEventStartTime <=
          subBlockStartTime + config.scheduleGranularity
        ) {
          const intervalsToAdvance = Math.ceil(
            (subBlockStartTime +
              config.scheduleGranularity -
              actualLastStartTime) /
              effectiveInterval
          )
          layerLastScheduledEventStartTimes[layerName][setName] =
            actualLastStartTime + intervalsToAdvance * effectiveInterval
        }
      }
    }
  }
  return { events, setToggled }
}