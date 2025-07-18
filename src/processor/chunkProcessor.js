import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAudioDuration, getAudioChannels } from '../utils/audio.js'
import { processAudioChunk as processAudioChunkCli } from '../utils/ffmpeg.js'

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
  actualChunkDuration
) {
  const eventTimes = []
  const timelineLogEntries = []

  const filters = await Promise.all(
    allEvents.map(async (event, index) => {
      const duration = event.duration ?? (await getAudioDuration(event.file))
      const processingStartTime = Date.now()
      const delay =
        event.start === chunkStartTime
          ? 0
          : Math.max(0, event.start - chunkStartTime + (event.offset || 0))

      eventTimes.push(delay)
      timelineLogEntries.push({
        chunk: chunkIndex,
        startTime: event.start,
        volume: event.volume * config.volume,
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
      const volumeFilter = `volume=${(
        event.volume *
        config.volume *
        (event.dist ?? 1)
      ).toFixed(3)}[a${index}]`
      const formattedDelay = (delay * 1000).toFixed(6)
      const delayFilter = `adelay=${formattedDelay}|${formattedDelay}[a${index}_delay]`
      const padFilter = `apad=whole_dur=${actualChunkDuration.toFixed(
        6
      )}[a${index}_pad]`

      let currentInputLabel
      const chainParts = []

      // Input stream is [index:a]
      // Preprocessing
      if (preprocessFilter) {
        chainParts.push(`[${index}:a]${preprocessFilter}`)
        currentInputLabel = `a${index}_pre`
      } else {
        currentInputLabel = `${index}:a`
      }

      // Format filter
      chainParts.push(`[${currentInputLabel}]${formatFilter}`)
      currentInputLabel = `a${index}_fmt`

      // Delay filter
      chainParts.push(`[${currentInputLabel}]${delayFilter}`)
      currentInputLabel = `a${index}_delay`

      // Pad filter to ensure the stream lasts for the whole chunk duration
      chainParts.push(`[${currentInputLabel}]${padFilter}`)
      currentInputLabel = `a${index}_pad`

      // Pan filter
      if (panFilter) {
        chainParts.push(`[${currentInputLabel}]${panFilter}`)
        currentInputLabel = `a${index}_pan`
      }

      // Pitch and speed adjustment
      if (event.pitchSpeedFactor && event.pitchSpeedFactor !== 1) {
        const pitchFactor = event.pitchSpeedFactor
        const sampleRate = 44100 * pitchFactor // Assuming base sample rate is 44100
        const pitchFilter = `asetrate=${sampleRate.toFixed(0)}[a${index}_pitch]`
        chainParts.push(`[${currentInputLabel}]${pitchFilter}`)
        currentInputLabel = `a${index}_pitch`

        const tempoFilter = `atempo=${(1 / pitchFactor).toFixed(
          3
        )}[a${index}_tempo]`
        chainParts.push(`[${currentInputLabel}]${tempoFilter}`)
        currentInputLabel = `a${index}_tempo`
      }

      // Volume filter
      chainParts.push(`[${currentInputLabel}]${volumeFilter}`)
      // Final output label for this event's chain is a${index}

      return chainParts.filter(Boolean).join(';')
    })
  )

  const filterChainString = filters.join(';')
  const mixInputs = eventTimes.map((_, index) => `[a${index}]`).join('')
  const mixFilter = `${mixInputs}amix=inputs=${eventTimes.length}:duration=longest[amixed]`
  const finalVolumeFilter = `[amixed]volume=${config.volume}[a]`

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
  config
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
          const durationInCurrentChunk =
            chunkEndTime - event.start + (event.offset || 0)
          nextChunkEvents.push({
            ...event,
            offset: (event.offset || 0) + durationInCurrentChunk,
            start: chunkEndTime,
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
          actualChunkDuration
        )
      finalTimelineLog = timelineLogEntries

      if (!filterComplexString || eventTimes.length === 0) {
        // Handle empty chunk (no valid filterable events)
        console.log(
          `Generating empty chunk ${chunkIndex} (no valid filterable events)`
        )
        // Use anullsrc for silent audio generation
        const silentInput = [
          { path: 'anullsrc=r=44100:cl=stereo', options: ['-f', 'lavfi'] },
        ]
        await processAudioChunkCli(
          silentInput,
          tempFile,
          null, // No complex filter needed for anullsrc
          actualChunkDuration,
          [], // No global input options for anullsrc
          ['-ar', '44100', '-ac', '2'] // Output options
        )
      } else {
        await processAudioChunkCli(
          inputs,
          tempFile,
          filterComplexString,
          actualChunkDuration,
          ['-guess_layout_max', '0'], // Global input options
          ['-map', '[a]', '-ar', '44100', '-ac', '2'] // Output options
        )
      }

      const stats = await fs.stat(tempFile)
      console.log(
        `Chunk ${chunkIndex} processed: ${tempFile}, size: ${stats.size} bytes`
      )
      return { tempFile, timelineLog: finalTimelineLog, nextChunkEvents }
    } else {
      // Handle empty chunk (no initial events)
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
