import chalk from 'chalk'

export const log = {
  info: (message) => console.log(chalk.blue(message)),
  success: (message) => console.log(chalk.green(message)),
  warning: (message) => console.log(chalk.yellow(message)),
  error: (message) => console.error(chalk.red(message)),
  title: (message) => console.log(chalk.bold.green(message)),
  subtle: (message) => console.log(chalk.gray(message)),
  default: (message) => console.log(message),
}

function formatTime(ms) {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`
  }
  const s = ms / 1000
  if (s < 60) {
    return `${s.toFixed(2)}s`
  }
  const m = s / 60
  return `${m.toFixed(2)}m`
}

export class PerfLog {
  constructor() {
    this.entries = {}
    this.startTime = Date.now()
  }

  start(name) {
    if (!this.entries[name]) {
      this.entries[name] = {
        count: 0,
        totalTime: 0,
        averageTime: 0,
        startTime: 0,
        events: 0,
      }
    }
    this.entries[name].startTime = Date.now()
  }

  end(name, events = 0) {
    const entry = this.entries[name]
    if (entry && entry.startTime) {
      const elapsedTime = Date.now() - entry.startTime
      entry.count++
      entry.totalTime += elapsedTime
      entry.averageTime = entry.totalTime / entry.count
      entry.startTime = 0 // Reset start time
      entry.events += events
    }
  }

  getSummary() {
    const totalScriptTime = Date.now() - this.startTime
    const summary = {
      totalScriptTime: formatTime(totalScriptTime),
      ...Object.entries(this.entries).reduce((acc, [name, entry]) => {
        acc[name] = {
          count: entry.count,
          totalTime: formatTime(entry.totalTime),
          averageTime: formatTime(entry.averageTime),
          events: entry.events,
        }
        return acc
      }, {}),
    }
    return summary
  }
}

export function logPerformanceSummary(perfLog, isPlanOnly) {
  const summary = perfLog.getSummary()
  log.default('\n')
  log.title('--- Performance Summary ---')
  log.info(`Scheduler finished in: ${summary.scheduler.totalTime}`)
  if (!isPlanOnly) {
    log.info(`Processor finished in: ${summary.processor.totalTime}`)
    log.info(`Total chunks processed: ${summary.processor.count}`)
    log.info(`Average time per chunk: ${summary.processor.averageTime}`)
    log.info(`Total events processed: ${summary.processor.events}`)
  }
  log.title('---------------------------')
  log.default('\n')
}
