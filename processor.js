import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function processChunk(
  chunkIndex,
  chunkEvents,
  chunkStartTime,
  chunkEndTime
) {
  const tempFile = path.join(__dirname, `temp_chunk_${chunkIndex}.mp3`)
  const actualChunkDuration = chunkEndTime - chunkStartTime

  if (chunkEvents.length > 0) {
    const ff = ffmpeg()
    const eventTimes = []
    const timelineLog = []

    chunkEvents.forEach((event, index) => {
      ff.input(event.file)
      const delay = Math.max(0, event.start - chunkStartTime)
      eventTimes.push(delay)
      timelineLog.push({
        chunk: chunkIndex,
        startTime: event.start,
        volume: event.volume,
        filename: event.filename,
        playCount: event.playCount,
        delay: delay * 1000,
        set: event.set,
        layer: event.layer,
        pan: event.pan,
        dist: event.dist,
      })
    })

    const filters = eventTimes
      .map((time, index) => {
        const event = chunkEvents[index]
        const leftGain = event.pan !== undefined ? (1 - event.pan) / 2 : 0.5
        const rightGain = event.pan !== undefined ? (1 + event.pan) / 2 : 0.5
        const panFilter =
          event.pan !== undefined
            ? `pan=stereo|c0=${leftGain.toFixed(3)}*c0|c1=${rightGain.toFixed(
                3
              )}*c0`
            : ''
        const volumeFilter = `volume=${(
          event.volume * (event.dist ?? 1)
        ).toFixed(3)}`
        const delayFilter = `adelay=${Math.round(time * 1000)}|${Math.round(
          time * 1000
        )}`
        return `[${index}:a]${delayFilter}${
          panFilter ? ',' + panFilter : ''
        },${volumeFilter}[a${index}]`
      })
      .join(';')

    const mix =
      eventTimes.map((_, index) => `[a${index}]`).join('') +
      `amix=inputs=${eventTimes.length}:duration=longest[amixed]`
    const finalVolume = `[amixed]volume=1[a]`
    const filterComplex = [filters, mix, finalVolume].join(';')

    await new Promise((resolve, reject) => {
      ff.inputOptions('-guess_layout_max 0')
        .complexFilter(filterComplex)
        .outputOptions(['-map [a]', '-ar 44100', '-ac 2'])
        .duration(actualChunkDuration)
        .output(tempFile)
        .on('end', async () => {
          try {
            const stats = await fs.stat(tempFile)
            console.log(
              `Chunk ${chunkIndex} generated: ${tempFile}, size: ${stats.size} bytes`
            )
            resolve(timelineLog)
          } catch (err) {
            reject(err)
          }
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`FFmpeg error for chunk ${chunkIndex}: ${err.message}`)
          console.error(`FFmpeg stderr: ${stderr}`)
          reject(err)
        })
        .run()
    })

    return { tempFile: path.relative(__dirname, tempFile), timelineLog }
  } else {
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input('anullsrc=r=44100:cl=stereo')
        .inputFormat('lavfi')
        .outputOptions(['-ar 44100', '-ac 2'])
        .duration(actualChunkDuration)
        .output(tempFile)
        .on('end', async () => {
          try {
            const stats = await fs.stat(tempFile)
            console.log(
              `Empty chunk ${chunkIndex} generated: ${tempFile}, size: ${stats.size} bytes`
            )
            resolve([])
          } catch (err) {
            reject(err)
          }
        })
        .on('error', (err, stdout, stderr) => {
          console.error(
            `FFmpeg error for empty chunk ${chunkIndex}: ${err.message}`
          )
          console.error(`FFmpeg stderr: ${stderr}`)
          reject(err)
        })
        .run()
    })

    return { tempFile: path.relative(__dirname, tempFile), timelineLog: [] }
  }
}

export async function concatenateChunks(tempFiles) {
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(`concat:${tempFiles.join('|')}`)
      .outputOptions(['-c copy', '-ar 44100', '-ac 2'])
      .output(path.join(__dirname, config.outputFile))
      .on('end', async () => {
        try {
          const stats = await fs.stat(path.join(__dirname, config.outputFile))
          console.log(
            `Concatenation complete: ${config.outputFile}, size: ${stats.size} bytes`
          )
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`FFmpeg error during concatenation: ${err.message}`)
        console.error(`FFmpeg stderr: ${stderr}`)
        reject(err)
      })
      .run()
  })
}
