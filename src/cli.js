import readline from 'readline'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(__dirname, '..', 'out')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan('AutoAmb> '),
})

const commands = {
  help: {
    aliases: ['h'],
    description: 'Show available commands',
    action: () => {
      console.log(chalk.yellow('Available commands:'))
      for (const [
        cmd,
        { aliases = [], flags = [], description },
      ] of Object.entries(commands)) {
        console.log(
          `  ${
            chalk.green(cmd) +
            flags
              .map((flag) =>
                chalk.gray(` <${flag.map((f) => chalk.blue(f)).join('|')}>`)
              )
              .join('')
          }\n    ${description}`
        )
        if (aliases.length > 0) {
          console.log(
            chalk.gray(
              `    alias${aliases.length > 1 ? 'es' : ''}: ${aliases
                .map((a) => chalk.green(a))
                .join(', ')}`
            )
          )
        }
        console.log()
      }
    },
  },
  run: {
    aliases: ['r'],
    flags: [
      ['--fresh', '-f'],
      ['--plan-only', '-p'],
      ['--open', '-o'],
    ],
    description: 'Run AutoAmb',
    action: async (args) => {
      const fresh = args.includes('--fresh') || args.includes('-f')
      const planOnly = args.includes('--plan-only') || args.includes('-p')
      const open = args.includes('--open') || args.includes('-o')
      const cmdArgs = []
      if (planOnly) cmdArgs.push('--plan-only')
      if (fresh) cmdArgs.push('--no-cache')

      try {
        await runAutoAmb(cmdArgs)
        console.log(chalk.green('\nOutput file generated successfully.\n'))

        if (open) {
          console.log(chalk.blue('Opening output.mp3 in Chrome...\n'))
          await openFile()
        }
      } catch (error) {
        console.error(chalk.red(`Error running AutoAmb: ${error.message}`))
      }
    },
  },
  open: {
    aliases: ['o'],
    description: 'Open output.mp3 in Chrome',
    action: async () => {
      try {
        console.log(chalk.blue('Opening output.mp3 in Chrome...'))
        await openFile()
        console.log(chalk.green('File opened successfully.'))
      } catch (error) {
        console.error(chalk.red(`Error opening output.mp3: ${error.message}`))
      }
    },
  },
  logs: {
    aliases: ['l'],
    description:
      'Parse timeline and intensity logs and create JSON files for each layer',
    action: async () => {
      try {
        const timelineLogFile = path.join(outputDir, 'timeline_log.json')
        const intensityLogFile = path.join(outputDir, 'intensity_log.json')

        // Process timeline log
        let timelineLogData = []
        try {
          await fs.access(timelineLogFile)
          timelineLogData = JSON.parse(
            await fs.readFile(timelineLogFile, 'utf8')
          )
        } catch (error) {
          console.warn(
            chalk.yellow(
              `Warning: Timeline log file ${timelineLogFile} not found`
            )
          )
        }

        // Process intensity log
        let intensityLogData = []
        try {
          await fs.access(intensityLogFile)
          intensityLogData = JSON.parse(
            await fs.readFile(intensityLogFile, 'utf8')
          )
        } catch (error) {
          console.warn(
            chalk.yellow(
              `Warning: Intensity log file ${intensityLogFile} not found`
            )
          )
        }

        // Get unique layers from both logs
        const layers = [
          ...new Set(
            [
              ...timelineLogData.map((entry) => entry.layer),
              ...intensityLogData.map((entry) => entry.layer),
            ].filter((layer) => layer)
          ),
        ]

        // Generate JSON files for each layer
        for (const layer of layers) {
          const timelineEntries = timelineLogData.filter(
            (entry) => entry.layer === layer
          )
          const intensityEntries = intensityLogData.filter(
            (entry) => entry.layer === layer
          )

          const timelineOutputFile = path.join(
            outputDir,
            `${layer}_timeline_log.json`
          )
          const intensityOutputFile = path.join(
            outputDir,
            `${layer}_intensity_log.json`
          )

          if (timelineEntries.length > 0) {
            await fs.writeFile(
              timelineOutputFile,
              JSON.stringify(timelineEntries, null, 2)
            )
            console.log(
              chalk.green(
                `Generated ${timelineOutputFile} with ${timelineEntries.length} entries`
              )
            )
          } else {
            console.warn(chalk.yellow(`No timeline entries for layer ${layer}`))
          }

          if (intensityEntries.length > 0) {
            await fs.writeFile(
              intensityOutputFile,
              JSON.stringify(intensityEntries, null, 2)
            )
            console.log(
              chalk.green(
                `Generated ${intensityOutputFile} with ${intensityEntries.length} entries`
              )
            )
          } else {
            console.warn(
              chalk.yellow(`No intensity entries for layer ${layer}`)
            )
          }
        }

        if (layers.length === 0) {
          console.warn(chalk.yellow('No valid layers found in logs'))
        } else {
          console.log(chalk.green('\nLog files processed successfully.\n'))
        }
      } catch (error) {
        console.error(chalk.red(`Error processing logs: ${error.message}`))
      }
    },
  },
  clear: {
    aliases: ['c'],
    description: 'Clear the terminal',
    action: () => {
      console.clear()
      console.log(chalk.yellow('\nTerminal cleared.\n'))
    },
  },
  exit: {
    description: 'Exit the AutoAmb CLI',
    action: () => {
      rl.close()
    },
  },
}

const aliases = Object.entries(commands).reduce(
  (acc, [cmd, { aliases = [] }]) => {
    aliases.map((alias) => (acc[alias] = cmd))
    return acc
  },
  {}
)

async function runAutoAmb(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, 'index.js'), ...args], {
      stdio: ['ignore', process.stdout, process.stderr],
      detached: false,
    })

    child.on('error', (error) => {
      rl.resume()
      rl.prompt()
      reject(error)
    })

    rl.resume()
    rl.prompt()
    child.on('exit', (code, signal) => {
      if (code === 0 || signal) resolve()
      else reject(new Error(`Child process exited with code ${code}`))
    })
  })
}

async function openFile() {
  return new Promise((resolve, reject) => {
    rl.pause()
    const filePath = path.join(outputDir, 'output.mp3')
    const fileUrl = `file://${path.resolve(filePath).replace(/\\/g, '/')}`

    fs.access(filePath)
      .catch(() => {
        rl.resume()
        rl.prompt()
        reject(new Error(`File ${filePath} does not exist`))
      })
      .then(() => {
        let cmd, args
        if (process.platform === 'win32') {
          cmd = 'start'
          args = ['chrome', fileUrl]
        } else if (process.platform === 'darwin') {
          cmd = 'open'
          args = ['-a', 'Google Chrome', fileUrl]
        } else {
          cmd = 'google-chrome'
          args = [fileUrl]
        }

        const child = spawn(cmd, args, {
          stdio: ['ignore', process.stdout, process.stderr],
          shell: true,
        })

        child.on('error', (error) => {
          rl.resume()
          rl.prompt()
          reject(error)
        })

        child.on('close', (code, signal) => {
          rl.resume()
          rl.prompt()
          if (code === 0 || signal) resolve()
          else reject(new Error(`Process exited with code ${code}`))
        })
      })
  })
}

process.on('SIGINT', () => {
  console.log(chalk.green('\nExiting AutoAmb CLI'))
  rl.close()
})

console.log(
  chalk.bold.green(
    '\nWelcome to AutoAmb CLI. Type "help" for available commands.\n'
  )
)
rl.prompt()

rl.on('line', async (line) => {
  const input = line.trim()
  const [cmd, ...args] = input.split(/\s+/)
  const resolvedCmd = aliases[cmd.toLowerCase()] || cmd.toLowerCase()
  const command = commands[resolvedCmd]

  if (command) {
    console.log()
    await command.action(args)
  } else {
    console.log(
      chalk.red(
        `Unknown command or alias: ${cmd}. Type "help" for available commands.`
      )
    )
  }

  rl.prompt()
}).on('close', () => {
  console.log(chalk.yellow('\nExiting AutoAmb CLI'))
  process.exit(0)
})
