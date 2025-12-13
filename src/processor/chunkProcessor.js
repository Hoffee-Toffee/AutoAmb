import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { getAudioDuration, getAudioChannels } from '../utils/audio.js'
import { processAudioChunk as processAudioChunkCli } from '../utils/ffmpeg.js'
import { interpolateIntensity } from '../utils/intensity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(__dirname, '../../out')

export async function ensureOutputDir() {
  try {
    await fs.mkdir(outputDir, { recursive: true })
  } catch (err) {
    console.error(`Failed to create output directory: ${err.message}`)
    throw err
  }
}

export async function generateFilterComplex(
  allEvents,
  chunkStartTime,
  config,
  chunkIndex,
  actualChunkDuration,
  getIntensityAtTime
) {
  const eventTimes = []
  const timelineLogEntries = []

  const filters = await Promise.all(
    allEvents.map(async (event, index) => {
      const duration = event.duration ?? (await getAudioDuration(event.file))
      const processingStartTime = Date.now()
      const delay = event.isCarryOver ? 0 : (event.start - chunkStartTime)

      const t_start = event.isCarryOver ? 0 : delay
      const t_end = Math.min(t_start + duration, actualChunkDuration)
      const overall_t_start = chunkStartTime + t_start
      const overall_t_end = chunkStartTime + t_end

      const intensity_start = getIntensityAtTime(event.layer, overall_t_start)
      const intensity_end = getIntensityAtTime(event.layer, overall_t_end)
      const layerData = config.layers[event.layer]
      const { lowerKey, upperKey, weight } = interpolateIntensity(layerData, intensity_start)

      let volume_start = layerData.intensity[lowerKey][`${event.set}_volume`]
      if (typeof volume_start !== 'number' || isNaN(volume_start)) volume_start = layerData[`${event.set}_volume`]
      if (typeof volume_start !== 'number' || isNaN(volume_start)) volume_start = 1

      let volume_end = layerData.intensity[upperKey][`${event.set}_volume`]
      if (typeof volume_end !== 'number' || isNaN(volume_end)) volume_end = layerData[`${event.set}_volume`]
      if (typeof volume_end !== 'number' || isNaN(volume_end)) volume_end = 1

      eventTimes.push(t_start)
      timelineLogEntries.push({
        chunk: chunkIndex,
        startTime: event.start,
        volume: `${volume_start} to ${volume_end}`,
        filename: event.filename,
        playCount: event.playCount,
        delay: delay * 1000,
        set: event.set,
        layer: event.layer,
        pan: event.pan,
        dist: event.dist,
        offset: event.offset || 0,
        duration,
        processingTime: Date.now() - processingStartTime,
      })

      const channels = await getAudioChannels(event.file)
      const leftGain = event.pan !== undefined ? (1 - event.pan) / 2 : 0.5
      const rightGain = event.pan !== undefined ? (1 + event.pan) / 2 : 0.5
      let preprocessFilter = ''

      if (channels === 'quad') {
        preprocessFilter = `pan=stereo|c0=c0+c2|c1=c1+c3[a${index}_pre]`
      } else if (channels === 'mono') {
        preprocessFilter = `aformat=channel_layouts=stereo[a${index}_pre]`
      } else if (channels !== 'stereo') {
        preprocessFilter = `aformat=channel_layouts=stereo[a${index}_pre]`
      }

      const formatFilter = `aformat=channel_layouts=stereo[a${index}_fmt]`
      const panFilter =
        event.pan !== undefined
          ? `pan=stereo|c0=${leftGain.toFixed(3)}*c0|c1=${rightGain.toFixed(
              3
            )}*c1[a${index}_pan]`
          : ''
      const volumeFilter = `volume='if(between(t,${t_start.toFixed(3)},${t_end.toFixed(3)}),${volume_start.toFixed(3)} + (${volume_end.toFixed(3)} - ${volume_start.toFixed(3)})*(t - ${t_start.toFixed(3)})/(${t_end.toFixed(3)} - ${t_start.toFixed(3)}),1)'[a${index}]`
      const formattedDelay = (delay * 1000).toFixed(6)
      const delayFilter = `adelay=${formattedDelay}|${formattedDelay}[a${index}_delay]`
      const padFilter = `apad=whole_dur=${actualChunkDuration.toFixed(6)}[a${index}_pad]`

      let currentInputLabel
      const chainParts = []

      if (preprocessFilter) {
        chainParts.push(`[${index}:a]${preprocessFilter}`)
        currentInputLabel = `a${index}_pre`
      } else {
        currentInputLabel = `${index}:a`
      }

      chainParts.push(`[${currentInputLabel}]${formatFilter}`)
      currentInputLabel = `a${index}_fmt`

      chainParts.push(`[${currentInputLabel}]${delayFilter}`)
      currentInputLabel = `a${index}_delay`

      chainParts.push(`[${currentInputLabel}]${padFilter}`)
      currentInputLabel = `a${index}_pad`

      if (panFilter) {
        chainParts.push(`[${currentInputLabel}]${panFilter}`)
        currentInputLabel = `a${index}_pan`
      }

      if (event.pitchSpeedFactor && event.pitchSpeedFactor !== 1) {
        const pitchFactor = event.pitchSpeedFactor
        const sampleRate = 44100 * pitchFactor
        const pitchFilter = `asetrate=${sampleRate.toFixed(0)}[a${index}_pitch]`
        chainParts.push(`[${currentInputLabel}]${pitchFilter}`)
        currentInputLabel = `a${index}_pitch`

        const tempoFilter = `atempo=${(1 / pitchFactor).toFixed(3)}[a${index}_tempo]`
        chainParts.push(`[${currentInputLabel}]${tempoFilter}`)
        currentInputLabel = `a${index}_tempo`
      }

      chainParts.push(`[${currentInputLabel}]${volumeFilter}`)

      return chainParts.filter(Boolean).join(';')
    })
  )

  const filterChainString = filters.join(';')
  const mixInputs = eventTimes.map((_, index) => `[a${index}]`).join('')
  const mixFilter = `${mixInputs}amix=inputs=${eventTimes.length}:duration=longest[amixed]`
  const finalVolume = (typeof config.volume === 'number' && !isNaN(config.volume)) ? config.volume : 1;
  // Add loudnorm after final volume for consistent loudness per chunk
  const finalVolumeFilter = `[amixed]volume=${finalVolume},loudnorm=I=-16:TP=-1.5:LRA=11[a]`

  const fullFilterComplex = [filterChainString, mixFilter, finalVolumeFilter]
    .filter(Boolean)
    .join(';')
  return {
    filterComplexString: fullFilterComplex,
    eventTimes,
    timelineLogEntries,
  }
}

export async function processChunk(
  chunkIndex,
  chunkEvents,
  chunkStartTime,
  chunkEndTime,
  carryOverEvents = [],
  config,
  getIntensityAtTime
) {
  await ensureOutputDir()
  const tempFile = path.join(outputDir, `temp_chunk_${chunkIndex}.mp3`)
  const actualChunkDuration = chunkEndTime - chunkStartTime
  const nextChunkEvents = []
  const allEvents = [...carryOverEvents, ...chunkEvents]

  try {
    if (allEvents.length > 0) {
      const inputs = []
      let finalTimelineLog = []


      for (const event of allEvents) {
        const duration = event.duration ?? (await getAudioDuration(event.file))
        const eventEndTime = event.start + duration - (event.offset || 0)

        if (eventEndTime > chunkEndTime) {
          const durationInCurrentChunk = chunkEndTime - event.start + (event.offset || 0)
          const carryOverOffset = (event.offset || 0) + durationInCurrentChunk;
          // Debug log for carry-over event
          console.log(
            `[CarryOver] chunk ${chunkIndex} | file: ${event.file} | origStart: ${event.start} | origOffset: ${event.offset || 0} | duration: ${duration} | eventEndTime: ${eventEndTime} | chunkEnd: ${chunkEndTime} | durationInChunk: ${durationInCurrentChunk} | nextOffset: ${carryOverOffset}`
          );
          nextChunkEvents.push({
            ...event,
            offset: carryOverOffset,
            start: chunkEndTime,
            isCarryOver: true,
          })
        }

        const inputEntry = { path: event.file, options: [] }
        if (event.offset) {
          inputEntry.options.push('-ss', event.offset.toFixed(3))
        }
        inputs.push(inputEntry)
      }

      const { filterComplexString, eventTimes, timelineLogEntries } =
        await generateFilterComplex(
          allEvents,
          chunkStartTime,
          config,
          chunkIndex,
          actualChunkDuration,
          getIntensityAtTime
        )
      finalTimelineLog = timelineLogEntries

      if (!filterComplexString || eventTimes.length === 0) {
        console.log(`Chunk ${chunkIndex}: empty`)
        const silentInput = [
          { path: 'anullsrc=r=44100:cl=stereo', options: ['-f', 'lavfi'] },
        ]
        await processAudioChunkCli(
          silentInput,
          tempFile,
          null,
          actualChunkDuration,
          [],
          ['-ar', '44100', '-ac', '2']
        )
      } else {
        await processAudioChunkCli(
          inputs,
          tempFile,
          filterComplexString,
          actualChunkDuration,
          ['-guess_layout_max', '0'],
          ['-map', '[a]', '-ar', '44100', '-ac', '2']
        )
      }

      const stats = await fs.stat(tempFile)
      console.log(`Chunk ${chunkIndex}: ${eventTimes.length} events, ${stats.size} bytes`)
      return { tempFile, timelineLog: finalTimelineLog, nextChunkEvents }
    } else {
      console.log(`Generating empty chunk ${chunkIndex} (no initial events)`)
      const silentInput = [
        { path: 'anullsrc=r=44100:cl=stereo', options: ['-f', 'lavfi'] },
      ]
      await processAudioChunkCli(
        silentInput,
        tempFile,
        null,
        actualChunkDuration,
        [],
        ['-ar', '44100', '-ac', '2']
      )
      const stats = await fs.stat(tempFile)
      console.log(
        `Empty chunk ${chunkIndex} generated: ${tempFile}, size: ${stats.size} bytes`
      )
      return { tempFile, timelineLog: [], nextChunkEvents: [] }
    }
  } catch (error) {
    console.error(`Error processing chunk ${chunkIndex}: ${error.message}`)
    throw error
  }
}