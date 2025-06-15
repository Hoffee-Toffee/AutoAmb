import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mainConfig from './config.js'
import { loadAudioFiles, generatePosition } from './utils/audio.js'
import {
  getIntensityForLayer,
  interpolateIntensity,
  calculateFrequenciesAndCounts,
} from './utils/intensity.js'
import { generateTimelineEvents } from './scheduler/scheduler.js'
import { processChunk } from './processor/chunkProcessor.js'
import { concatenateChunks } from './processor/chunkJoiner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  await generateSoundscape(mainConfig.config, mainConfig.layers)
}

async function generateSoundscape(config, layers) {
  try {
    const filesData = {}
    const intensityLog = []
    let timeline = []
    const lastEventEndTimes = {}
    const chunkCounts = Object.keys(layers).reduce((acc, layer) => {
      acc[layer] = Array(
        Math.ceil(config.duration / config.chunkDuration)
      ).fill(0)
      return acc
    }, {})
    const sharedPositions = {}
    const setIndices = Object.keys(layers).reduce((acc, layer) => {
      acc[layer] = 0
      return acc
    }, {})
    const layerLastScheduledEventStartTimes = {};

    for (const [layerName, layerData] of Object.entries(layers)) {
      // Pass config to loadAudioFiles
      filesData[layerName] = await loadAudioFiles(layerName, layerData, config)
      if (layerData.directionality === 'shared')
        sharedPositions[layerName] = generatePosition()
      if (layerData.bufferBetweenSounds) {
        lastEventEndTimes[layerName] = {}
        // Note: lastEventEndTimes is populated with specific keys ('_layerCycle' or setName)
        // directly within generateTimelineEvents based on cycleThrough strategy.
        // No need to pre-populate with setName here.
      }
      // Initialize layerLastScheduledEventStartTimes for non-buffered layers
      if (!layerData.bufferBetweenSounds) {
        layerLastScheduledEventStartTimes[layerName] = {};
        for (const setName of Object.keys(layerData.sets)) {
            layerLastScheduledEventStartTimes[layerName][setName] = 0.0;
        }
      }
    }

    const subBlocks = Math.floor(config.duration / config.scheduleGranularity)
    for (let i = 0; i < subBlocks; i++) {
      const subBlockStartTime = i * config.scheduleGranularity
      const progress = subBlockStartTime / config.duration

      for (const [layerName, layerData] of Object.entries(layers)) {
        const intensity = getIntensityForLayer(layerName, progress) // No config needed
        const { lowerKey, upperKey, weight } = interpolateIntensity(
          layerData,
          intensity
        )
        const volume =
          (1 - weight) * layerData.intensity[lowerKey].volume +
          weight * layerData.intensity[upperKey].volume

        // Pass config to calculateFrequenciesAndCounts
        const { frequencies, scaledFrequencies, counts } =
          calculateFrequenciesAndCounts(
            layerName,
            layerData,
            intensity,
            lowerKey,
            upperKey,
            config
          )

        intensityLog.push({
          subBlock: i,
          time: subBlockStartTime,
          layer: layerName,
          intensity,
          ...frequencies,
          ...scaledFrequencies,
          ...counts,
        })

        // Pass config to generateTimelineEvents
        const { events, setToggled } = generateTimelineEvents(
          layerName,
          layerData,
          filesData[layerName].validFiles,
          filesData[layerName].playCounts,
          filesData[layerName].lastPlayedFiles,
          setIndices[layerName],
          subBlockStartTime,
          intensity,
          volume,
          counts,
          chunkCounts,
          filesData[layerName].durations,
          scaledFrequencies,
          sharedPositions[layerName],
          frequencies,
          lastEventEndTimes,
          layerLastScheduledEventStartTimes, // Added here
          config
        )

        timeline.push(...events)

        if (setToggled)
          switch (layerData.cycleThrough) {
            case 'sets':
              setIndices[layerName] =
                (setIndices[layerName] + 1) % Object.keys(layerData.sets).length
              break
            case 'files':
              const totalFiles = Object.values(
                filesData[layerName].validFiles
              ).reduce((sum, files) => sum + files.length, 0)
              if (totalFiles > 0) {
                setIndices[layerName] = (setIndices[layerName] + 1) % totalFiles
              }
              break
          }
      }
    }

    console.log('Event counts per chunk (before processing):', chunkCounts)
    timeline.sort((a, b) => a.start - b.start)

    const outDir = path.join(__dirname, '../out')
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(
      path.join(outDir, 'intensity_log.json'),
      JSON.stringify(intensityLog, null, 2)
    )

    const tempFiles = []
    const timelineLog = []
    const totalChunks = Math.ceil(config.duration / config.chunkDuration)
    let carryOverEvents = []

    for (let i = 0; i < totalChunks; i++) {
      const chunkStartTime = i * config.chunkDuration
      const chunkEndTime = Math.min(
        chunkStartTime + config.chunkDuration,
        config.duration
      )
      const chunkEventsInScope = timeline.filter(
        (event) =>
          event && event.start >= chunkStartTime && event.start < chunkEndTime
      )

      timeline = timeline.filter(
        (event) =>
          event && (event.start < chunkStartTime || event.start >= chunkEndTime)
      )

      console.log(
        `Processing chunk ${i} with ${chunkEventsInScope.length} events`
      )
      // Pass config to processChunk
      const {
        tempFile,
        timelineLog: chunkTimelineLog,
        nextChunkEvents,
      } = await processChunk(
        i,
        chunkEventsInScope,
        chunkStartTime,
        chunkEndTime,
        carryOverEvents,
        config // Pass config
      )
      if (tempFile) tempFiles.push(tempFile) // Only push if a tempFile was created
      timelineLog.push(...chunkTimelineLog)
      carryOverEvents = nextChunkEvents
    }

    await fs.writeFile(
      path.join(outDir, 'timeline_log.json'),
      JSON.stringify(timelineLog, null, 2)
    )
    console.log(`Concatenating ${tempFiles.length} chunks`)
    // Pass config to concatenateChunks
    if (tempFiles.length > 0) {
      await concatenateChunks(tempFiles, config)
    } else {
      console.warn('No temporary chunk files were generated to concatenate.')
    }

    for (const tempFile of tempFiles) {
      await fs
        .unlink(tempFile)
        .catch((err) =>
          console.warn(`Failed to delete ${tempFile}: ${err.message}`)
        )
    }

    console.log(`Soundscape audio generated: ${config.outputFile}`)
  } catch (error) {
    console.error(`Error generating soundscape: ${error.message}`)
    console.error(error.stack)
  }
}

main()
