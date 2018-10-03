
'use strct'

const events = require('events')
const os = require('os')
const { spawn } = require('child_process')
const path = require('path')
const joinTrace = require('node-trace-log-join')
const getLoggingPaths = require('./get-logging-paths')

class Tool extends events.EventEmitter {
  constructor ({
    name,
    customEnvHook
  }) {
    super()
    this.name = name
    this.customEnvHook = customEnvHook
  }

  collect (args, callback) {
    // Run program, but inject the sampler.
    const nodeOptions = [
      '-r', 'no-cluster.js',
      '--trace-events-enabled', '--trace-event-categories'
    ]

    const stdio = ['inherit', 'inherit', 'inherit']

    if (this.detectPort) {
      nodeOptions.push('-r', 'detect-port.js')
      stdio.push('pipe')
    }

    if (process.env.NODE_OPTIONS) {
      nodeOptions.push(process.env.NODE_OPTIONS)
    }

    const customEnv = {
      // Use NODE_PATH to work around issues with spaces in inject path.
      NODE_PATH: path.join(__dirname, 'injects'),
      NODE_OPTIONS: nodeOptions.join(' ')
    }

    if (this.customEnvHook) {
      this.customEnvHook(customEnv)
    }

    const proc = spawn(args[0], args.slice(1), {
      stdio,
      env: Object.assign({}, process.env, customEnv)
    })

    if (this.detectPort) {
      proc.stdio[3].once('data', data => this.emit('port', Number(data), proc, () => proc.stdio[3].destroy()))
    }

    // Get logging directory structure.
    const paths = getLoggingPaths(this.name)({ identifier: proc.pid, path: this.path })

    // Relay SIGINT to process
    process.once('SIGINT', function () {
      // We cannot kill(SIGINT) on windows but it seems
      // to relay the ctrl-c signal per default, so only do this
      // if not windows.
      /* istanbul ignore else: windows hack */
      if (os.platform() !== 'win32') proc.kill('SIGINT')
    })

    proc.once('exit', function (code, signal) {
      // Windows exit code STATUS_CONTROL_C_EXIT 0xC000013A returns 3221225786
      // if not caught. See https://msdn.microsoft.com/en-us/library/cc704588.aspx
      /* istanbul ignore next: windows hack */
      if (code === 3221225786 && os.platform() === 'win32') signal = 'SIGINT'

      // The process did not exit normally.
      if (code !== 0 && signal !== 'SIGINT') {
        if (code !== null) {
          return callback(
            new Error(`process exited with exit code ${code}`),
            paths['/']
          )
        } else {
          return callback(
            new Error(`process exited by signal ${signal}`),
            paths['/']
          )
        }
      }

      // Create directory and move files to that directory.
      joinTrace(
        'node_trace.*.log', paths['/traceevent'],
        function (err) {
          /* istanbul ignore if: the node_trace file should always exists */
          if (err) return callback(err, paths['/'])
          callback(null, paths['/'])
        }
      )
    })
  }
}

module.exports = Tool