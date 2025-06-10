import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureOutputDir } from './chunkProcessor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(__dirname, '../../out')

export async function concatenateChunks(tempFiles, config) {
  await ensureOutputDir()

  if (!tempFiles || tempFiles.length === 0) {
    console.warn('No temporary files to concatenate.')
  }

  const outputFile = path.join(outputDir, config.outputFile)

  for (const file of tempFiles) {
    try {
      await fs.access(file)
    } catch (err) {
      // Log the problematic file path
      console.error(`Error accessing temporary file: ${file}`, err)
      throw new Error(
        `Temporary file not found: ${file}. Concatenation cannot proceed.`
      )
    }
  }

  if (tempFiles.length === 0) {
    console.log(
      'No chunks to concatenate. Output file will not be created by concatenation process.'
    )
    return
  }

  await new Promise((resolve, reject) => {
    const command = ffmpeg()

    // Check if tempFiles are valid before adding to command
    const validTempFiles = tempFiles.filter((f) => f && typeof f === 'string')
    if (validTempFiles.length === 0) {
      console.error('No valid temporary files to concatenate after filtering.')
      return reject(new Error('No valid temporary files to concatenate.'))
    }

    command
      .input(`concat:${validTempFiles.join('|')}`)
      .outputOptions(['-c copy', '-ar 44100', '-ac 2'])
      .output(outputFile)
      .on('end', async () => {
        try {
          const stats = await fs.stat(outputFile)
          console.log(
            `Concatenation complete: ${outputFile}, size: ${stats.size} bytes`
          )
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`FFmpeg error during concatenation: ${err.message}`)
        console.error(`FFmpeg input files: concat:${validTempFiles.join('|')}`)
        console.error(`FFmpeg stdout: ${stdout}`)
        console.error(`FFmpeg stderr: ${stderr}`)
        reject(err)
      })
      .run()
  })
}
