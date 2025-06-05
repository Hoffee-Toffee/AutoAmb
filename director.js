import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config, layers } from './config.js'
import {
  loadAudioFiles,
  getIntensityForLayer,
  interpolateIntensity,
  calculateChancesAndCounts,
} from './utils.js'
import { generateTimelineEvents } from './scheduler.js'
import { processChunk, concatenateChunks } from './processor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function generateSoundscape() {
  try {
    const filesData = {}
    const intensityLog = []
    let timeline = []
    const chunkCounts = Object.keys(layers).reduce((acc, layer) => {
      acc[layer] = Array(
        Math.ceil(config.duration / config.chunkDuration)
      ).fill(0)
      return acc
    }, {})
    let lastBreathWasIn = false

    for (const [layerName, layerData] of Object.entries(layers)) {
      filesData[layerName] = await loadAudioFiles(layerName, layerData)
    }

    const subBlocks = Math.floor(config.duration / config.scheduleGranularity)
    for (let i = 0; i < subBlocks; i++) {
      const subBlockStartTime = i * config.scheduleGranularity
      const progress = subBlockStartTime / config.duration

      for (const [layerName, layerData] of Object.entries(layers)) {
        const intensity = getIntensityForLayer(layerName, progress)
        const { lowerKey, upperKey, weight } = interpolateIntensity(
          layerData,
          intensity
        )
        const volume =
          (1 - weight) * layerData.intensity[lowerKey].volume +
          weight * layerData.intensity[upperKey].volume
        const { chances, scaledChances, counts } = calculateChancesAndCounts(
          layerName,
          layerData,
          intensity,
          weight,
          lowerKey,
          upperKey
        )

        intensityLog.push({
          subBlock: i,
          time: subBlockStartTime,
          layer: layerName,
          intensity,
          ...chances,
          ...scaledChances,
          ...counts,
        })

        const { events, breathToggled } = generateTimelineEvents(
          layerName,
          layerData,
          filesData[layerName].validFiles,
          filesData[layerName].playCounts,
          filesData[layerName].lastPlayedFiles,
          lastBreathWasIn,
          subBlockStartTime,
          intensity,
          volume,
          counts,
          chunkCounts
        )

        timeline.push(...events)
        if (layerName === 'breath' && breathToggled) {
          lastBreathWasIn = !lastBreathWasIn
        }
      }
    }

    console.log('Event counts per chunk (before processing):', chunkCounts)
    timeline.sort((a, b) => a.start - b.start)
    await fs.writeFile(
      path.join(__dirname, 'intensity_log.json'),
      JSON.stringify(intensityLog, null, 2)
    )

    const tempFiles = []
    const timelineLog = []
    const totalChunks = Math.ceil(config.duration / config.chunkDuration)

    for (let i = 0; i < totalChunks; i++) {
      const chunkStartTime = i * config.chunkDuration
      const chunkEndTime = Math.min(
        chunkStartTime + config.chunkDuration,
        config.duration
      )
      const chunkEvents = timeline.filter(
        (event) =>
          event && event.start >= chunkStartTime && event.start < chunkEndTime
      )
      timeline = timeline.filter(
        (event) =>
          event && (event.start < chunkStartTime || event.start >= chunkEndTime)
      )

      console.log(`Processing chunk ${i} with ${chunkEvents.length} events`)
      const { tempFile, timelineLog: chunkTimelineLog } = await processChunk(
        i,
        chunkEvents,
        chunkStartTime,
        chunkEndTime
      )
      tempFiles.push(tempFile)
      timelineLog.push(...chunkTimelineLog)
    }

    await fs.writeFile(
      path.join(__dirname, 'timeline_log.json'),
      JSON.stringify(timelineLog, null, 2)
    )
    console.log(`Concatenating ${tempFiles.length} chunks`)
    await concatenateChunks(tempFiles)

    for (const tempFile of tempFiles) {
      await fs
        .unlink(path.join(__dirname, tempFile))
        .catch((err) =>
          console.warn(`Failed to delete ${tempFile}: ${err.message}`)
        )
    }

    console.log(`Soundscape audio generated: ${config.outputFile}`)
  } catch (error) {
    console.error(`Error generating soundscape: ${error.message}`)
  }
}

generateSoundscape()
