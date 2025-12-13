import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mainConfig from './config.js'
import {
  loadAudioFiles,
  generatePosition,
  normalizeSets,
} from './utils/audio.js'
import {
  calculateFrequenciesAndCounts,
  getInterpolatedLayerData,
} from './utils/intensity.js'
import { PerfLog, logPerformanceSummary } from './utils/logging.js'
import { generateTimelineEvents } from './scheduler/scheduler.js'
import { processChunk } from './processor/chunkProcessor.js' // Fixed import
import { concatenateChunks } from './processor/chunkJoiner.js'
import {
  initializeDirector,
  updateActiveLayers,
  getIntensity,
  getActiveLayers,
} from './director/director.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function sanitizePath(p) {
  if (/^[a-zA-Z]:\\/.test(p)) {
    return p.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/')
  }
  return p
}

async function main() {
  if (mainConfig.config && mainConfig.config.audioDir) {
    mainConfig.config.audioDir = sanitizePath(mainConfig.config.audioDir)
  }
  const isPlanOnly = process.argv.includes('--plan-only')
  const dashPad = '-'.repeat(5)
  const pad = ' '.repeat(2)

  const message = [
    dashPad,
    pad,
    `AutoAmb ${isPlanOnly ? '(PLAN ONLY MODE)' : ''}`,
    pad,
    dashPad,
    '\n',
  ].join('')

  console.log(message)
  await generateSoundscape(mainConfig, isPlanOnly)
}

async function generateSoundscape(mainConfig, isPlanOnly = false) {
  const { config, layers } = mainConfig
  const perfLog = new PerfLog()
  try {
    const filesData = {}
    const intensityLog = []
    let timeline = []
    const lastEventEndTimes = {}
    const layerNextEventTimes = {}
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
    const layerLastScheduledEventStartTimes = {}

    console.log(`Loading audio data...`)
    for (const [layerName, layerData] of Object.entries(layers)) {
      layerData.sets = normalizeSets(layerData.sets)
      filesData[layerName] = await loadAudioFiles(layerName, layerData, config)
      if (layerData.directionality === 'shared')
        sharedPositions[layerName] = generatePosition()
      if (layerData.bufferBetweenSounds) {
        lastEventEndTimes[layerName] = {}
      }
      if (!layerData.bufferBetweenSounds) {
        layerLastScheduledEventStartTimes[layerName] = {}
        for (const setName of Object.keys(layerData.sets)) {
          layerLastScheduledEventStartTimes[layerName][setName] = 0.0
        }
      }
    }
    console.log(`Cache loaded.\n\n`)

    perfLog.start('scheduler')
    const director = initializeDirector(layers, config)
    const { activeLayers, layerActivationQueue } = director
    const subBlocks = Math.floor(config.duration / config.scheduleGranularity)
    for (let i = 0; i < subBlocks; i++) {
      const subBlockStartTime = i * config.scheduleGranularity
      updateActiveLayers(
        layers,
        config,
        activeLayers,
        layerActivationQueue,
        subBlockStartTime
      )
      const activeLayerNames = getActiveLayers(activeLayers)

      for (const layerName of activeLayerNames) {
        const layerData = layers[layerName]
        const intensity = getIntensity(
          layers,
          activeLayers,
          layerName,
          subBlockStartTime
        )

        const { frequencies, scaledFrequencies, counts } =
          calculateFrequenciesAndCounts(layerData, intensity, config)

        const { volume } = getInterpolatedLayerData(layerData, intensity)

        intensityLog.push({
          subBlock: i,
          time: subBlockStartTime,
          layer: layerName,
          intensity,
          ...frequencies,
          ...scaledFrequencies,
          ...counts,
          volume,
        })

        const { events, setToggled } = generateTimelineEvents(
          layerName,
          layerData,
          filesData[layerName].validFiles,
          filesData[layerName].playCounts,
          filesData[layerName].lastPlayedFiles,
          setIndices[layerName],
          subBlockStartTime,
          intensity,
          chunkCounts,
          filesData[layerName].durations,
          sharedPositions[layerName],
          layerLastScheduledEventStartTimes,
          lastEventEndTimes,
          config,
          intensityLog
        )

        timeline.push(...events)

        if (setToggled)
          switch (layerData.cycleMode) {
            case 'sets':
              setIndices[layerName] =
                (setIndices[layerName] + 1) %
                Object.keys(layerData.sets).length
              break
            case 'files':
              const totalFiles = Object.values(
                filesData[layerName].validFiles
              ).reduce((sum, files) => sum + files.length, 0)
              if (totalFiles > 0) {
                setIndices[layerName] =
                  (setIndices[layerName] + 1) % totalFiles
              }
              break
          }
      }
    }
    perfLog.end('scheduler')

    console.log('Event counts per chunk (before processing):', chunkCounts)
    timeline.sort((a, b) => a.start - b.start)

    const outDir = path.join(__dirname, '../out')
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(
      path.join(outDir, 'intensity_log.json'),
      JSON.stringify(intensityLog, null, 2)
    )

    const getIntensityAtTime = (layerName, time) => {
      const relevantEntries = intensityLog.filter(
        (entry) => entry.layer === layerName && entry.time <= time
      )
      if (relevantEntries.length === 0) return 0
      const latestEntry = relevantEntries.reduce((prev, current) =>
        prev.time > current.time ? prev : current
      )
      return 0.5
    }

    if (isPlanOnly) {
      const timelineLog = timeline.map((event) => ({
        layer: event.layer,
        start: event.start,
        file: event.file,
        volume: event.volume,
        duration: event.duration,
      }))
      await fs.writeFile(
        path.join(outDir, 'timeline_log.json'),
        JSON.stringify(timelineLog, null, 2)
      )
      logPerformanceSummary(perfLog, isPlanOnly)
      return
    }

    const tempFiles = []
    const timelineLog = []
    const totalChunks = Math.ceil(config.duration / config.chunkDuration)
    let carryOverEvents = []

    for (let i = 0; i < totalChunks; i++) {
      perfLog.start('processor')
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
          event &&
          (event.start < chunkStartTime || event.start >= chunkEndTime)
      )

      console.log(
        `Processing chunk ${i} with ${chunkEventsInScope.length} events`
      )
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
        mainConfig,
        getIntensityAtTime
      )
      if (tempFile) tempFiles.push(tempFile)
      timelineLog.push(...chunkTimelineLog)
      carryOverEvents = nextChunkEvents
      perfLog.end('processor', chunkEventsInScope.length)
    }

    await fs.writeFile(
      path.join(outDir, 'timeline_log.json'),
      JSON.stringify(timelineLog, null, 2)
    )
    console.log(`Concatenating ${tempFiles.length} chunks`)
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

    logPerformanceSummary(perfLog, isPlanOnly)
    console.log(`Soundscape audio generated: ${config.outputFile}`)
  } catch (error) {
    console.error(`Error generating soundscape: ${error.message}`)
    console.error(error.stack)
  }
}

main()