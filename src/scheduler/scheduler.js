import { generatePosition, selectFile } from '../utils/audio.js'
import { randomNormal } from '../utils/math.js'
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
  layerLastScheduledEventStartTimes, // Added
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

    // Refactored scheduling logic starts here
    let referenceTime
    let frequencyValue
    const varianceValue = layerData.variance || 0
    let bufferTrackerKey = null // Used only if bufferBetweenSounds is true

    if (layerData.bufferBetweenSounds) {
      bufferTrackerKey =
        layerData.cycleThrough === 'sets' || layerData.cycleThrough === 'files'
          ? '_layerCycle'
          : setName
      if (!lastEventEndTimes[layerName]) lastEventEndTimes[layerName] = {}
      if (lastEventEndTimes[layerName][bufferTrackerKey] === undefined) {
        lastEventEndTimes[layerName][bufferTrackerKey] = 0.0 // Initialize if not present
      }
      referenceTime = lastEventEndTimes[layerName][bufferTrackerKey]

      const freqRate = directSetFrequencies
        ? directSetFrequencies[setName]
        : 0

      if (freqRate < 0) {
        console.warn(
          `Negative frequency rate (${freqRate}) for set ${setName} in layer ${layerName} (buffered mode). Skipping set.`
        )
        continue
      } else if (freqRate === 0) {
        frequencyValue = 0 // Play immediately after referenceTime (plus variance)
      } else { // freqRate > 0
        frequencyValue = 1.0 / freqRate
      }

      // This is the buffered sound path - event creation happens below this 'if/else'
      let calculatedInterval
      if (frequencyValue === 0 && layerData.bufferBetweenSounds) { // This check is specific to buffered sounds with freqRate = 0
          calculatedInterval = 0;
      } else {
          calculatedInterval = frequencyValue + randomNormal() * varianceValue;
          if (calculatedInterval <= 0 && frequencyValue > 0) {
              calculatedInterval = frequencyValue;
          } else if (calculatedInterval <= 0) {
              calculatedInterval = 0.001; // Small positive interval
          }
      }
      
      let potentialNextEventStartTime = referenceTime + calculatedInterval;

      const eventSchedulingCondition =
        potentialNextEventStartTime < config.duration &&
        potentialNextEventStartTime < subBlockStartTime + config.scheduleGranularity &&
        (layerData.bufferBetweenSounds || potentialNextEventStartTime >= subBlockStartTime); // Second part of OR is always true if !bufferBetweenSounds

      if (eventSchedulingCondition) {
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
          );

          if (selectedFileDetails && (potentialNextEventStartTime + selectedFileDetails.duration <= config.duration)) {
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
              );
              events.push(event);
              lastPlayedFiles[setName] = selectedFileDetails.name;
              
              const chunkIndex = Math.floor(potentialNextEventStartTime / config.chunkDuration);
              if (chunkCounts && chunkCounts[layerName] && chunkIndex < chunkCounts[layerName].length) {
                  chunkCounts[layerName][chunkIndex]++;
              }

              if (layerData.bufferBetweenSounds && bufferTrackerKey) { // This was correctly here
                  lastEventEndTimes[layerName][bufferTrackerKey] = potentialNextEventStartTime + selectedFileDetails.duration;
              }
              
              if (layerData.cycleThrough === 'sets' || layerData.cycleThrough === 'files') {
                  setToggled = true;
              }
          }
      }
    } else { // Non-buffered sounds (Option A: previousEventStartTime + Interval + TimeJitter)
            // This block is executed for each setName if !layerData.bufferBetweenSounds
            
            let actualLastStartTime = (layerLastScheduledEventStartTimes[layerName] && 
                                   layerLastScheduledEventStartTimes[layerName][setName] !== undefined)
                                  ? layerLastScheduledEventStartTimes[layerName][setName]
                                  : 0.0; // Should be found due to initialization in index.js

            const baseRate = directSetFrequencies ? directSetFrequencies[setName] : 0;
            if (baseRate === undefined || baseRate <= 0) {
                // console.warn(`Invalid or zero base rate (${baseRate}) for set ${setName} in layer ${layerName} (non-buffered). Skipping set.`);
                continue; 
            }
            const currentInterval = config.frequencyUnit / baseRate; // Assuming config.frequencyUnit is in seconds
            const timeJitter = randomNormal() * (layerData.variance || 0);

            let potentialEventStartTime = actualLastStartTime + currentInterval + timeJitter;
            potentialEventStartTime = Math.max(0, potentialEventStartTime); // Ensure not negative

            if (potentialEventStartTime >= subBlockStartTime &&
                potentialEventStartTime < (subBlockStartTime + config.scheduleGranularity) &&
                potentialEventStartTime < config.duration) {

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
                );

                if (selectedFileDetails && (potentialEventStartTime + selectedFileDetails.duration <= config.duration)) {
                    const event = createAudioEvent(
                        selectedFileDetails.path,
                        selectedFileDetails.name,
                        potentialEventStartTime,
                        selectedFileDetails.duration,
                        volume, 
                        layerName,
                        setName,
                        position, 
                        layerData.pitchSpeedRange
                    );
                    events.push(event);
                    
                    if (!layerLastScheduledEventStartTimes[layerName]) layerLastScheduledEventStartTimes[layerName] = {};
                    layerLastScheduledEventStartTimes[layerName][setName] = potentialEventStartTime;
                    
                    lastPlayedFiles[setName] = selectedFileDetails.name; 

                    const chunkIndex = Math.floor(potentialEventStartTime / config.chunkDuration);
                    if (chunkCounts && chunkCounts[layerName] && chunkIndex < chunkCounts[layerName].length) {
                        chunkCounts[layerName][chunkIndex]++;
                    }

                    if (layerData.cycleThrough === 'sets' || layerData.cycleThrough === 'files') {
                        setToggled = true;
                    }
                }
            }
        // The main loop `for (const setName of setsToProcess)` continues, so no `continue` here.
    }
  }
  return { events, setToggled }
}
